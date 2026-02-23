# Problems and Solutions — Hostfully to Operto Reservation Cleaning Sync

This document tracks **problems** identified in the workflow (or its docs) and the **solutions** implemented. Use it to fix issues step by step and to hand off context to others.

Workflow file: `newBookingFinder.json.json`.

---

## Solved

### 1. IF condition documentation (Reservation Exists?)

**Problem**  
The **Reservation Exists?** IF node uses the condition `$json._noMatch === true`. In the docs it was easy to misread as:
- TRUE → skip (wrong)
- FALSE → create (wrong)

That would invert the logic: we would skip new reservations and try to create duplicates for existing ones.

**Root cause**  
`_noMatch === true` means “no reservation was found.” So:
- **TRUE** = no reservation → must **create**
- **FALSE** = reservation exists → must **skip**

The workflow **wiring** was already correct (TRUE → Create, FALSE → Split In Batches / skip). Only the **written description** was ambiguous or contradictory.

**Solution**  
- **README.md** and **today'sTasks.md** were updated so that:
  - The condition is clearly stated as “no reservation found.”
  - **TRUE (output 1)** is explicitly “no reservation → create.”
  - **FALSE (output 0)** is “exists → skip.”
- A short “Correct logic” note was added in the README node description so the meaning of TRUE/FALSE is unambiguous.

**References**  
- README: Flow summary, §13 Reservation Exists?
- today'sTasks.md: §4 Reservation and cleaning job creation, §6 README updates

---

### 2. Timestamp race condition (Compute Max / Update Stored Timestamp)

**Problem**  
**Compute Max Updated Timestamp** was connected from **Has More Pages?** (No) **together with** **Output Leads Individually**. So when “No more pages” fired:
- Branch A: Output Leads → Filter New Bookings → **Split In Batches** → (long loop: lookup → merge → IF → create/skip) → back to Split In Batches.
- Branch B: **Compute Max Updated Timestamp** → **Update Stored Timestamp**.

Both branches ran from the same trigger. Branch B did not wait for Branch A. So:
- The stored timestamp could be updated **while** the Split In Batches loop was still running.
- If the run crashed, was stopped, or timed out mid-loop, some bookings would never get reservation/cleaning rows.
- The next run would use the **new** timestamp, so those leads might never be fetched again.

So the design was **not transaction-safe**: “advance timestamp” was not tied to “all reservations/cleaning jobs for this run are done.”

**Root cause**  
- **Has More Pages?** (output 0) had two connections: Output Leads Individually and Compute Max Updated Timestamp.
- Compute Max only needed `$input.first().json` (the Accumulate Leads payload), so it could run immediately and did not depend on the loop.

**Solution**  
1. **Remove** the direct connection from **Has More Pages?** to **Compute Max Updated Timestamp**.  
   - **Has More Pages?** (No) now connects **only** to **Output Leads Individually**.

2. **Use Split In Batches’ Done output** so timestamp runs only after the loop finishes:  
   - **Split In Batches** has two outputs: output 0 = each batch (loop), output 1 = **Done** (after all batches).  
   - **Split In Batches (Done)** is now connected to a new node **Compute Max After Loop**.

3. **New node: Compute Max After Loop** (Code)  
   - Triggered only when Split In Batches emits **Done**.  
   - Reads `$('Accumulate Leads').last().json` to get `accumulatedLeads` and `storedTimestamp`.  
   - Computes `max(metadata.updatedUtcDateTime)` over all accumulated leads.  
   - Outputs `{ key: 'config', storedTimestamp: newStoredTimestamp }` in the same shape as before.  
   - Connects to **Update Stored Timestamp** (unchanged).

4. **Remove** the old **Compute Max Updated Timestamp** node (no longer used).

**Result**  
- Timestamp is advanced **only after** the entire reservation/cleaning loop has finished.  
- If the run fails mid-loop, the timestamp is not updated, so the next run will re-fetch the same leads and process them.  
- When Filter New Bookings returns 0 items, Split In Batches still emits **Done** once, so Compute Max After Loop and Update Stored Timestamp still run and the timestamp is updated as usual.

**References**  
- Workflow: `Has More Pages?1` connections; `Split In Batches` main[1] → Compute Max After Loop; node `Compute Max After Loop`.  
- README: Flow summary, §8 Has More Pages?, §18 Compute Max After Loop, Rules (“No new bookings”).  
- today'sTasks.md: §2 Timestamp-driven “new bookings”, §5 Idempotency and behavior, §8 Timestamp race condition fix.

---

### 3. Merge by position / multi-row lookup (Risk #3)

**Problem**  
The **Merge** node uses **combine by position** (`mergeByPosition`). That only works when **exactly one item** comes from each input and order is synchronized.  
- **Input 1:** Split In Batches always sends one lead → OK.  
- **Input 2:** **Ensure One Item** turned 0 lookup rows into one item (`_noMatch: true`), but when **Lookup Reservation** returned **multiple rows** (e.g. duplicate `bookingUid` in the Reservations sheet), it passed all of them through. So Merge got 1 item from input 1 and N items from input 2 → position merge breaks (wrong pairing, duplicate or missing data downstream).

**Root cause**  
Ensure One Item only normalized “0 rows → 1 item”; it did not enforce “at most one item” when the sheet returned 2+ rows.

**Solution**  
1. **Harden Ensure One Item** so it **always** outputs exactly one item:  
   - 0 rows → `[{ json: { _noMatch: true } }]` (unchanged).  
   - 1 or more rows → return only the **first** row: `[items[0]]`. So even if the sheet has duplicate `bookingUid` or Lookup returns multiple rows, the Merge always sees one item from input 2 and position merge remains valid.
2. **Document the assumption:** The Reservations sheet should have **at most one row per `bookingUid`**. If duplicates exist, we now tolerate them (first row wins) without breaking the workflow; for consistency and clarity, uniqueness is still the intended design.
3. **Merge node** left as **merge by position**; no need to switch to merge-by-key for correctness once Ensure One Item guarantees a single item. (An alternative would be Merge by Key / Merge by Fields on `bookingUid` if both inputs shared a common key; current approach keeps the same behavior with minimal change.)

**Result**  
- Merge by position is safe: both inputs always contribute exactly one item.  
- Duplicate or multi-row lookup results no longer break the loop or downstream nodes.  
- Assumption (one row per `bookingUid` in Reservations) is documented; duplicates are handled by taking the first row.

**References**  
- Workflow: **Ensure One Item** node (`return [items[0]]` when items.length > 0); **Merge** node (`combinationMode: mergeByPosition`).  
- README: §2 Reservations, §12 Ensure One Item (optional one-line note).  
- problems-and-solutions.md: this section.

---

### 4. Missing duplicate protection on CleaningJobs (Risk #4)

**Problem**  
Only **Reservations** were protected by lookup (no duplicate reservation rows). **CleaningJobs** were not: when a reservation row existed, the workflow skipped entirely and never ran Create Cleaning Job. So if a reservation existed but its cleaning job was missing (e.g. **cleaningJobId** blank, or someone deleted the CleaningJobs row), the system would not recreate the cleaning job.

**Root cause**  
**Reservation Exists?** FALSE (reservation exists) was connected directly to **Split In Batches** (skip). There was no check for “reservation exists but cleaning job missing.”

**Solution**  
1. **New node: Cleaning Job Needed?** (IF), placed after **Reservation Exists?** on the “reservation exists” branch.  
   - **Condition:** `($json.cleaningJobId ?? '').toString().trim() === ''` (i.e. reservation has no cleaning job ID).  
   - **TRUE (output 1):** cleaning job needed → **Prepare Cleaning Job Data** → **Create Cleaning Job Record** → **Update Reservation with Cleaning Job ID** → **Split In Batches**.  
   - **FALSE (output 0):** already has cleaning job → **Split In Batches**.

2. **Wiring:**  
   - **Reservation Exists?** output 0 (FALSE, reservation exists) → **Cleaning Job Needed?** (instead of directly to Split In Batches).  
   - **Cleaning Job Needed?** output 1 (TRUE) → **Prepare Cleaning Job Data** (same chain as new reservation path; no new reservation row is created).  
   - **Cleaning Job Needed?** output 0 (FALSE) → **Split In Batches**.

**Result**  
- When a reservation exists and **cleaningJobId** is empty (or missing), the workflow creates the cleaning job and updates the reservation.  
- When a reservation already has a **cleaningJobId**, the workflow skips (no duplicate cleaning job).  
- Duplicate protection: we still do not create a second reservation row; we only add or repair the cleaning job when the reservation row exists but has no cleaning job link.

**References**  
- Workflow: node **Cleaning Job Needed?**; **Reservation Exists?** → **Cleaning Job Needed?**; **Cleaning Job Needed?** → Prepare Cleaning Job Data (TRUE) or Split In Batches (FALSE).

---

### 5. Wrong date API in Create Reservation Record (`createdAtSystem`)

**Problem**  
The **Create Reservation Record** (Google Sheets Append) node set `createdAtSystem` using the expression `={{ $now.toISOString() }}`. In n8n expression fields, `$now` is a **Luxon DateTime** object (see n8n docs: built-in date/time), not a JavaScript `Date`. Luxon’s method for an ISO string is **`.toISO()`**; **`.toISOString()`** is a method on native `Date` only. Using `$now.toISOString()` could throw (e.g. “toISOString is not a function”) or behave incorrectly depending on n8n version.

**Root cause**  
The expression assumed `$now` was a JavaScript `Date`. n8n exposes `$now` as a Luxon object for timezone-aware workflows, so the correct Luxon API is `.toISO()`, not `.toISOString()`.

**Solution**  
In **Create Reservation Record**, the column mapping for `createdAtSystem` was changed from:
- **Before:** `"createdAtSystem": "={{ $now.toISOString() }}"`
- **After:** `"createdAtSystem": "={{ $now.toISO() }}"`

No change was needed in **Prepare Cleaning Job Data** (Code node), which already correctly uses `new Date().toISOString()` in JavaScript.

**Result**  
`createdAtSystem` is now set using the correct Luxon API. The expression evaluates without error and writes a valid ISO timestamp to the Reservations sheet.

**References**  
- Workflow: **Create Reservation Record** (Google Sheets Append), `columns.value.createdAtSystem`.
- n8n docs: [Date and time | Built-in](https://docs.n8n.io/code/builtin/date-time/) — `$now` is a Luxon object; use `.toISO()` for ISO string.

---

## Structural verifications (checked, correct)

### Split In Batches loop wiring

**Concern**  
Only the **loop/continue** output of Split In Batches should be used for the processing loop; the **done / no items left** output should go forward (e.g. to timestamp). Miswiring could cause infinite loops, skipped items, or timestamp logic running multiple times.

**Verification**  
In n8n’s **Split In Batches** (Loop Over Items):

- **Output 0 (loop):** emits each batch for processing; downstream must connect back to Split In Batches so it can emit the next batch.
- **Output 1 (done):** fires **once** when all batches are done; should go to “forward” logic only (e.g. Compute Max After Loop).

**Current workflow wiring (correct):**

| From Split In Batches | Output index | Connects to | Role |
|------------------------|--------------|-------------|------|
| main[0]                | Loop         | Merge, Lookup Reservation | Process current batch; these paths eventually loop back to Split In Batches. |
| main[1]                | Done         | Compute Max After Loop    | Run once when loop is finished; timestamp only after all items processed. |

**Loop-back (into Split In Batches input):**

- **Filter New Bookings** → Split In Batches (initial input: items to batch).
- **Reservation Exists?** (output 0, reservation exists) → **Cleaning Job Needed?**; then **Cleaning Job Needed?** (output 0 or 1) → Split In Batches or via Prepare Cleaning Job → … → Split In Batches.
- **Update Reservation with Cleaning Job ID** → Split In Batches (next batch).

So: the **loop** output (main[0]) is used only for batch processing; the **done** output (main[1]) goes only forward to Compute Max After Loop. Loop-backs go to the node’s **input**, not to the done output. No change needed.

---

## To do / known limitations

(Add new problems here as you identify them; move to **Solved** when fixed.)

### INQUIRY promoted to BOOKING (documented limitation)

**Problem**  
“New” is based on `createdUtcDateTime` (creation time), not when the lead became BOOKED. If a lead starts as INQUIRY and is later promoted to BOOKING + BOOKED, it can be missed once `storedTimestamp` has moved past its creation time.

**Possible solution**  
Change **Filter New Bookings** to use `metadata.updatedUtcDateTime` (or combine with `createdUtcDateTime`) for the “is it new?” check, so leads updated (e.g. promoted to BOOKED) after `storedTimestamp` are included. See README “Limitation: INQUIRY promoted to BOOKING.”

---

## How to use this file

- **When you find a new problem:** Add it under **To do / known limitations** with a short title, description, and optional “Possible solution.”
- **When you implement a fix:** Move the entry to **Solved**, add **Problem**, **Root cause**, **Solution**, **Result**, and **References** (workflow nodes, README/today’sTasks sections).
- **Step by step:** Tackle one problem at a time and update this file so others (or another AI) can continue from here.
