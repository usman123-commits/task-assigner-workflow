# Phase 1 — Booking → Internal Job Creation: Full Functional Audit

**Workflow:** `newBookingFinder.json`  
**Audit date:** 2025-02-25  
**Stance:** No assumption of correctness; logic verified against code and connections.

---

## 1. Booking Trigger Validation

### 1.1 Entry conditions

**Requirement:** A booking enters the system ONLY when:
- `type === "BOOKING"`
- `status === "BOOKED"`
- `createdUtcDateTime > storedTimestamp`

**Implementation (Filter New Bookings):**
```javascript
const created = lead?.metadata?.createdUtcDateTime;
if (created && created > storedTimestamp && lead?.type === 'BOOKING' && lead?.status === 'BOOKED') {
  filtered.push(item);
}
```

**Verdict:** Conditions are enforced. Booking is included only when all four checks pass.

---

### 1.2 Stored timestamp source

- **Filter** uses: `$('Accumulate Leads').last().json?.storedTimestamp`.
- **Accumulate Leads** gets `storedTimestamp` from:
  - Run 0: **Initialize Cursor** (which reads **Read Last Timestamp** → sheet `timeStamps`).
  - Run > 0: previous **Accumulate Leads** (unchanged during pagination).
- So the same `storedTimestamp` (last value from sheet at run start) is used for the whole run.

**Verdict:** Comparison uses the stored timestamp correctly (read once at start, not mid-run).

---

### 1.3 Equal timestamps and permanent skip risk

- Filter uses **strict `>`**: `created > storedTimestamp`.
- If `created === storedTimestamp`, the booking is **excluded**.
- **Compute Max After Loop** sets the new stored value to `max(updatedUtcDateTime)` over **all** accumulated leads (not only processed ones).
- So a booking with `createdUtcDateTime === storedTimestamp` is never processed; and if the new `storedTimestamp` ends up ≥ that booking’s `updatedUtcDateTime` (e.g. other leads have later updates), that booking will never be re-fetched (API uses `updatedSince`).

**Verdict:** Equal timestamps **can** cause **permanent skip** of that booking. This is a real bug.

**Recommendation:** Change filter to `created >= storedTimestamp` **only if** you also ensure idempotency (e.g. reservation lookup by `bookingUid` already makes creation idempotent). Then bookings with `created === storedTimestamp` are processed once and not skipped forever.

---

### 1.4 `updatedUtcDateTime` vs `createdUtcDateTime`

- **Filter:** uses `createdUtcDateTime` only (for “new” bookings).
- **Compute Max After Loop:** uses `updatedUtcDateTime` only:  
  `lead?.metadata?.updatedUtcDateTime` → `newStoredTimestamp`.
- **API:** `updatedSince={{ $json.storedTimestamp }}` (cursor uses `updatedUtcDateTime` semantics).

**Verdict:** `updatedUtcDateTime` is used only for cursor advancement and stored timestamp; `createdUtcDateTime` only for inclusion. Correct.

---

### 1.5 When does `storedTimestamp` advance?

- **Update Stored Timestamp** is connected from **Compute Max After Loop**.
- **Compute Max After Loop** is connected from **Split In Batches** (first output = “Done”).
- So the timestamp is written only when the batch loop has finished (Split In Batches “Done” branch).

**Verdict:** Stored timestamp advances only after full batch completion. No mid-loop update.

---

### 1.6 Race between loop and timestamp update

- There is a single execution path: loop runs to completion → “Done” → Compute Max → Update Stored Timestamp.
- No parallel branches that write the timestamp.

**Verdict:** No race between loop completion and timestamp update.

---

### 1.7 Duplicate processing / missed bookings / infinite loop / premature update

| Risk | Assessment |
|------|------------|
| **Duplicate processing** | Same booking can appear in one run (e.g. same lead twice in API). Reservation is protected by Lookup + Create only when `_noMatch`; second time reservation exists, so we only run “Cleaning Job Needed?” and do not create a second reservation. Cleaning job is created only when `cleaningJobId` is empty; after first pass it’s set, so no second cleaning job. **Controlled.** |
| **Missed bookings** | Possible when `createdUtcDateTime === storedTimestamp` (see 1.3). Otherwise, all new bookings in the fetched set are considered. **Risk only at equality.** |
| **Infinite loop** | Pagination uses `Has More Pages?1` (cursor null = no more). Split In Batches runs over a finite filtered list and then exits on “Done”. **No infinite loop.** |
| **Premature timestamp update** | Timestamp is updated only on the “Done” branch of Split In Batches. **None.** |

---

## 2. Reservation Record Creation Validation

### 2.1 One reservation per qualifying booking

- Flow: **Lookup Reservation** (by `bookingUid` = `$json.uid`) → **Ensure One Item** → **Merge** → **Reservation Exists?**.
- **Reservation Exists?** uses `_noMatch !== true`:
  - **True (output 0):** reservation exists → **Cleaning Job Needed?** (no append).
  - **False (output 1):** no reservation → **Create Reservation Record** (append).
- So we append only when lookup did not find a real row (Ensure One Item set `_noMatch: true`).

**Verdict:** A Reservation row is created only when the booking was not already in the sheet (by `bookingUid`). Exactly once per new booking in normal conditions.

---

### 2.2 Duplicate prevention and key

- Lookup uses **Reservations** sheet, **lookupColumn:** `bookingUid`, **lookupValue:** `$json.uid`.
- **Ensure One Item** treats “no match” when: 0 rows, or first row has no valid `bookingUid`.
- Create is **append**; we never “re-create” the same row because we only append when `_noMatch === true`.

**Verdict:** Duplicate reservation creation is prevented by bookingUid lookup. bookingUid is the unique key for lookup and for the update node (below).

---

### 2.3 When reservation already exists

- We do **not** append; we go to **Cleaning Job Needed?**.
- If `cleaningJobId` is empty we create a cleaning job and then **Update Reservation with Cleaning Job ID** (repair path).

**Verdict:** Existing reservation is not recreated; repair (cleaning job + update) is supported.

---

### 2.4 Google Sheets: Lookup and update

- **Lookup:** Sheet = **Reservations**, filtersUI = `lookupColumn: bookingUid`, `lookupValue: $json.uid`. **Correct.**
- **Update Reservation with Cleaning Job ID:** operation = update, **matchingColumns:** `["bookingUid"]`, value = `bookingUid`, `cleaningJobId`, `row_number: 0`. So one row is matched by `bookingUid` and updated. **Single-row update.**  
  Note: `row_number: 0` is sent; confirm this does not break sheet behavior (e.g. if column is read-only or used for something else).

---

### 2.5 Merge and “exactly one item”

- **Merge Lead and Lookup** runs after **Ensure One Item**, which always outputs a single item (`_noMatch` object or one reservation row).
- So Merge always receives one item from the Lookup path; the other input is **Split In Batches** (one item per iteration). So we have one lead and one lookup result.

**Verdict:** Merge logic receives exactly one item from each side in practice.

---

### 2.6 Fields in Reservations sheet (Create Reservation Record)

**Stored on create:**

| Required (plan) | In workflow | Notes |
|-----------------|-------------|--------|
| bookingUid | ✅ `$json.uid` | OK |
| propertyUid | ✅ | OK |
| checkIn | ✅ `checkInLocalDateTime` | OK |
| checkOut | ✅ `checkOutLocalDateTime` | OK |
| guestName | ✅ first + last | OK |
| adultCount | ✅ `guestInformation?.adultCount` | OK |
| source | ✅ `$json.channel` | OK |
| createdUtcDateTime | ✅ as `createdUtc` from `metadata?.createdUtcDateTime` | OK (column name difference only) |
| cleaningStatus = "PENDING" | ✅ | OK |
| maintenanceStatus = "NONE" | ❌ **Missing** | Not set on create |
| payrollStatus = "NOT_STARTED" | ❌ **Missing** | Not set on create |
| cleaningJobId | Set later by **Update Reservation with Cleaning Job ID** | OK |
| createdAtSystem | ✅ `$now.toISO()` | OK |

**Verdict:** **maintenanceStatus** and **payrollStatus** are not set on reservation creation. Add them (e.g. "NONE" and "NOT_STARTED") in the Create Reservation Record node if the plan is authoritative.

---

## 3. Cleaning Job Derivation Validation

### 3.1 cleaningDate and cleaningTime

**Prepare Cleaning Job Data:**
```javascript
const dateTime = j?.checkOutLocalDateTime || j?.checkOut || '';
return [{ json: { ..., cleaningDate: dateTime, cleaningTime: dateTime, ... } }];
```

- **cleaningDate** and **cleaningTime** are both set to the full checkout date-time string, not “date only” vs “time only”.
- Plan: “Cleaning date = checkOut date” and optional “checkout time or fixed window”. Current logic is “same value for both”; if downstream expects separate date and time columns, you may need to split (e.g. date substring vs time substring).

**Verdict:** Derivation from checkOut is consistent; clarify whether sheet/downstream expect separate date and time formats.

---

### 3.2 cleaningJobId and one job per reservation

- `cleaningJobId = bookingUid + '_CLEAN'` (with `bookingUid = j?.uid || j?.bookingUid`). **Correct.**
- Cleaning job is created in two paths only:
  1. Right after **Create Reservation Record** (new reservation).
  2. From **Cleaning Job Needed?** when reservation exists but `cleaningJobId` is empty (repair).
- There is **no lookup** before **Create Cleaning Job Record**; it’s **append** only. Duplicate prevention is implicit: we only create when we just created the reservation (and then set `cleaningJobId` on it) or when we detected empty `cleaningJobId`. So we do not create a second job for the same reservation in the same run. If the workflow were run twice with no timestamp advance, the second run would see the reservation with `cleaningJobId` set and skip job creation.

**Verdict:** Only one cleaning job per reservation in normal and repair flows. No explicit dedupe (e.g. by cleaningJobId) in CleaningJobs; reliance is on reservation state and single-threaded run.

---

### 3.3 Repair on next run

- If the run crashes after reservation create but before cleaning job create, the reservation row has no `cleaningJobId`.
- Next run: same lead can be re-fetched (if timestamp was not advanced) or we rely on “updated” fetch; we lookup by `bookingUid`, find the row, `cleaningJobId` is empty → **Cleaning Job Needed?** true → create job and update reservation.

**Verdict:** Repair on next run works.

---

### 3.4 CleaningJobs sheet fields

**Stored:** cleaningJobId, bookingUid, propertyUid, cleaningDate, cleaningTime, status, assignedCleaner, clockIn, clockOut, workedHours, createdAtSystem.

All are present in the append mapping. Plan mentioned status = "ASSIGNED"; workflow uses **status = 'PENDING'**. If the plan is the source of truth, change to "ASSIGNED"; otherwise document that PENDING is intentional.

**Verdict:** All listed fields are stored. Only status value (PENDING vs ASSIGNED) may need alignment.

---

## 4. Loop & Batch Integrity

### 4.1 Split In Batches and coverage

- **Filter New Bookings** returns an array of items (each a qualifying lead).
- **Split In Batches** receives that array; with default options it processes items one by one and outputs “Done” when finished.
- Each item goes to **Lookup Reservation** → … → eventually back to **Split In Batches** (via Update Reservation or Cleaning Job Needed? → Split In Batches).

**Verdict:** Every filtered booking is processed in the loop; loop exits when no items remain.

---

### 4.2 Timestamp only after loop

- **Compute Max After Loop** and **Update Stored Timestamp** are triggered only from **Split In Batches** “Done” (first connection).
- No other path writes the timestamp.

**Verdict:** Timestamp computation and write run only after loop completion.

---

### 4.3 What the timestamp is based on

**Compute Max After Loop:**
```javascript
const data = $('Accumulate Leads').last().json;
const leads = data?.accumulatedLeads || [];
// ...
for (const lead of leads) {
  const t = lead?.metadata?.updatedUtcDateTime;
  if (t && (!maxUpdated || t > maxUpdated)) maxUpdated = t;
}
```

- It uses **all** accumulated leads from the last **Accumulate Leads** output (full fetch for the run), not only the ones that passed the filter or were processed.

**Verdict:** Timestamp is computed from all accumulated leads (correct for “don’t re-fetch these again”); it is not limited to “processed” bookings.

---

### 4.4 No parallel timestamp update

- Only one path leads to **Update Stored Timestamp**: Split In Batches (Done) → Compute Max After Loop → Update Stored Timestamp.

**Verdict:** No parallel path updates the timestamp prematurely.

---

## 5. Edge Case Simulation

### A. Two bookings created in the same second

- Same `createdUtcDateTime`; both either pass or fail the filter together (depending on `storedTimestamp`).
- If both pass: two items in the batch; two iterations. Lookup by `bookingUid` separates them; no duplicate reservation. Two cleaning jobs (different `bookingUid` + `_CLEAN`).  
- If both fail (e.g. `created === storedTimestamp`): both skipped; risk of permanent skip (see 1.3).

**Verdict:** Same-second bookings are handled correctly when `created > storedTimestamp`. At equality, both can be permanently skipped.

---

### B. Booking updated after creation

- API uses `updatedSince`, so we re-fetch the lead.
- Filter still uses `createdUtcDateTime > storedTimestamp`. If we already advanced `storedTimestamp` past that creation time, we will not include it again (correct: already processed). If we haven’t advanced yet (e.g. same run), we process once. Updates don’t create a second reservation because lookup finds the existing row.

**Verdict:** Behavior is correct; no duplicate reservation from updates.

---

### C. Workflow crashes after reservation creation, before cleaning job creation

- Reservation row exists with empty `cleaningJobId`.
- Next run: we may re-fetch the lead (if timestamp not advanced because crash was before Compute Max / Update). Lookup finds reservation, **Cleaning Job Needed?** true → create cleaning job and update reservation.

**Verdict:** Repair works on next run.

---

### D. Duplicate bookingUid rows already in Reservations sheet

- **Lookup** can return multiple rows; **Ensure One Item** takes the first. So we only use one row for the branch (exists vs create).
- **Update Reservation with Cleaning Job ID** updates by `bookingUid`; Google Sheets update typically affects one matched row (often the first). So one duplicate row may keep an empty `cleaningJobId`, and we might create a second cleaning job for the same booking if that “empty” row is the one we see in a later run or context.

**Verdict:** Duplicate rows in the sheet are a risk: inconsistent state and possible duplicate cleaning jobs. Prefer enforcing unique `bookingUid` (e.g. data validation or app-side checks) and/or cleaning duplicates.

---

### E. No new bookings in run

- Filter returns empty array → Split In Batches gets 0 items → “Done” fires immediately (no item iterations).
- Compute Max After Loop runs with `accumulatedLeads` from Accumulate Leads; we set `newStoredTimestamp = max(updatedUtcDateTime)` or fallback to previous `storedTimestamp`.
- We still write the new timestamp, so we don’t re-fetch the same set again.

**Verdict:** Correct; no special failure.

---

## 6. Additional Risks

### 6.1 Read Last Timestamp and config row

- **Read Last Timestamp** reads the whole **timeStamps** sheet (no filter in the node).
- **Initialize Cursor** uses `$('Read Last Timestamp').first().json`, i.e. the **first row**.
- If the sheet has multiple rows (e.g. several keys), the “config” row must be the first row, or the wrong timestamp is used.

**Recommendation:** Add a filter (e.g. key = "config") in Read Last Timestamp, or a dedicated “Get config row” step so the workflow is robust to row order.

---

### 6.2 Prepare Cleaning Job Data input from Create Reservation Record

- After **Create Reservation Record**, the next node is **Prepare Cleaning Job Data**; its input is the **output of the Append** (Sheets response), not the merged lead.
- The code uses `j?.uid || j?.bookingUid`, `j?.propertyUid`, `j?.checkOutLocalDateTime || j?.checkOut`. Append typically returns the written row with column names (e.g. `bookingUid`, `checkOut`), so this is likely fine, but it depends on Google Sheets node behavior.

**Recommendation:** Confirm in testing that Append returns a row that includes `bookingUid`, `propertyUid`, and `checkOut` (or equivalent) so cleaning job data is correct. If not, pass the lead through (e.g. from Merge) instead of relying only on Append output.

---

## 7. Final Verdict

### Is Phase 1 production-safe?

**Not fully**, without addressing the following.

- **Critical:** Bookings with `createdUtcDateTime === storedTimestamp` can be permanently skipped. Fix by using `>=` and relying on idempotent reservation creation, or by a different advancement rule that doesn’t exclude equality.
- **Important:** Reservations created in Phase 1 do not set **maintenanceStatus** or **payrollStatus**; add them if the plan is required.
- **Important:** **Read Last Timestamp** assumes the first row of **timeStamps** is the config row; add an explicit filter by key (e.g. "config") for safety.
- **Moderate:** Duplicate **bookingUid** rows in Reservations can cause inconsistent state and possible duplicate cleaning jobs; keep **bookingUid** unique and fix duplicates.
- **Minor:** cleaningDate/cleaningTime are the same full string; status is PENDING (not ASSIGNED); Update Reservation sends `row_number: 0`. Align with plan and downstream if needed.

### Remaining hidden risks

1. **Google Sheets API:** Rate limits or transient errors can leave partial state (e.g. reservation without cleaning job); repair path mitigates this.
2. **Clock skew / string comparison:** If `createdUtcDateTime` or `storedTimestamp` are not always ISO 8601 or have mixed formats, string comparison may be wrong. Initialize Cursor normalizes a space in the timestamp to "T"; other formats are not normalized.
3. **Merge / Ensure One Item:** They assume a single item from upstream; if n8n or a future change ever produces multiple items, the merge and branch logic would need review.

### Exact improvements before Phase 2

1. **Filter New Bookings:** Consider `created >= storedTimestamp` and rely on reservation lookup to avoid duplicate rows (and document that equality is “process once”).
2. **Create Reservation Record:** Set **maintenanceStatus = "NONE"** and **payrollStatus = "NOT_STARTED"** (if your plan requires them).
3. **Read Last Timestamp:** Filter by key = "config" (or equivalent) so the correct row is used regardless of order.
4. **Reservations sheet:** Enforce or verify unique **bookingUid**; fix any duplicate rows.
5. **Document/align:** cleaningDate vs cleaningTime format, status PENDING vs ASSIGNED, and `row_number` in Update Reservation.
6. **Test:** Run with created === storedTimestamp; with duplicate bookingUids in sheet; and with crash after reservation create to validate repair and no duplicate jobs.

After these, Phase 1 is in a good state to consider production and to build Phase 2 on top.
