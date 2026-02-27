# PHASE 2 — Modifications Summary

**Workflow:** `phase2CleanerAssignmentCalendar.json`  
**Date:** 2025-02-25

All changes were applied to the existing workflow. No full rebuild.

---

## CHANGE 1 — TRUE Hybrid Calendar

**Admin Calendar (unchanged):**
- **Create Admin Calendar Event** still uses calendar ID: `usman2acountf@gmail.com` (admin account).
- No change to calendar parameter.

**Cleaner Calendar (modified):**
- **Create Cleaner Calendar Event** now uses a **dynamic** calendar:
  - `calendar.value`: `={{ $json.cleanerCalendarId }}`
  - `calendar.mode`: `"id"` (so the value is used as the calendar ID).
- `cleanerCalendarId` is set in **Assign Cleaner** from CleanersProfile:
  - Column: **"calendar ID"** or **"calendarId"** (via `get(mapping, 'calendar ID', 'calendarId')`).
- **Assign Cleaner** now throws if the CleanersProfile row has no calendar ID:
  - `CleanersProfile row for ${propertyUid} has no calendar ID (calendarId). Cleaner calendar events require it.`

**Result:** Admin event stays on admin calendar; cleaner event is created on that cleaner’s calendar from the sheet. CleanersProfile must have a **calendarId** (or "calendar ID") column populated per cleaner.

---

## CHANGE 2 — Move Status Update (Finalize Assignment)

**Update Job Assigned (modified):**
- **Removed** `status` from the update.
- It now updates only: **bookingUid**, **cleanerId**, **assignedAt**.
- Notes updated to state that status is set later by Finalize Assignment.

**New node: Finalize Assignment**
- **Type:** Google Sheets (update).
- **Sheet:** CleaningJobs.
- **Match:** bookingUid.
- **Updates:** `bookingUid`, `status` = `"ASSIGNED"`, `processingFlag` = `""`.
- **Position in flow:** After **Update Job With Event Id**, before **Validate Email Data** (and thus before Send Gmail).
- **Connections:** Update Job With Event Id → Finalize Assignment → Validate Email Data → Send Gmail to Cleaner.

**Result:** `status = "ASSIGNED"` is written only after both calendar events exist and `calendarEventId` has been stored. If the run fails after creating events but before Update Job With Event Id, the row never gets ASSIGNED and can be retried (row remains LOCKED until success or Unlock When Skipped).

---

## CHANGE 3 — Event Title & Description

**Create Admin Calendar Event** and **Create Cleaner Calendar Event** (both modified):

- **additionalFields.summary** (title):
  - `Cleaning – {{ $json.propertyName || $json.propertyUid }} – {{ $json.guestName || 'Guest' }}`

- **additionalFields.description**:
  - Property: {{ propertyName }}
  - Address: {{ address }}
  - Guest Count: {{ adultCount }}
  - Booking UID: {{ bookingUid }}
  - Assigned Cleaner: {{ cleanerName }}
  - Assigned At (UTC): {{ assignedAt }}

Same title and description on both events. Fallbacks (e.g. `|| ''`) avoid blank fields.

---

## CHANGE 4 — Concurrency Protection (processingFlag)

**Filter Pending Only (modified):**
- Added condition: **processingFlag** must be empty.
  - `const processingFlag = (j.processingFlag ?? '').toString().trim();`
  - Filter now requires: `status === 'PENDING' && cleanerId === '' && !hasEvent && processingFlag === ''`.
- Rows with `processingFlag = 'LOCKED'` are no longer selected, so they are not reprocessed by another run.

**New node: Lock Row**
- **Position:** First node inside the loop, right after **Split In Batches** (before Lookup Reservation).
- **Action:** Update CleaningJobs: set **processingFlag** = `"LOCKED"` for the current item’s **bookingUid**.
- **Purpose:** Claim the row so other runs (or the same run’s next iteration) do not pick it. If the workflow fails mid-run, the row stays LOCKED and is excluded by the filter on the next run (no duplicate events/assignments).

**New node: Unlock When Skipped**
- **Position:** On the “Already has calendar event” branch. Replaces the previous connection from **Already Has Calendar Event?** (TRUE) to **Split In Batches**.
- **Action:** Update CleaningJobs: set **processingFlag** = `""` for the current **bookingUid**.
- **Purpose:** When we skip event creation (job already has calendarEventId), we clear the lock so the row is not stuck as LOCKED.

**Finalize Assignment (see Change 2):**
- Also sets **processingFlag** = `""` when assignment is finalized, so successful runs clear the lock.

**Result:**
- Only rows with empty processingFlag are considered.
- Each selected row is locked at the start of processing.
- Lock is cleared on success (Finalize Assignment) or when we skip (Unlock When Skipped).
- Failed runs leave the row LOCKED; it will not be reprocessed until the lock is cleared manually or by a future “Unlock When Skipped”/finalize path.

**Sheet requirement:** CleaningJobs must have a **processingFlag** column (can be empty for existing rows).

---

## CHANGE 5 — Email Robustness (Validate Email Data)

**New node: Validate Email Data**
- **Type:** Code.
- **Position:** Between **Finalize Assignment** and **Send Gmail to Cleaner**.
- **Logic:** Checks that the current item has:
  - **cleanerEmail** (non-empty after trim)
  - **propertyName** or **propertyUid**
  - **bookingUid**
  - **calendarEventId**
- If any are missing, throws:  
  `Cannot send email: missing required field(s): ${missing.join(', ')}. Check Assign Cleaner and calendar event flow.`
- If all present, passes the item through to Gmail.

**Result:** Gmail is only sent when all required fields are present; otherwise the run fails with a clear error instead of sending an incomplete or wrong email.

---

## Connection Changes

| From | To (before) | To (after) |
|------|-------------|------------|
| Split In Batches (batch output) | Lookup Reservation | **Lock Row** → Lookup Reservation |
| Update Job With Event Id | Send Gmail to Cleaner | **Finalize Assignment** → **Validate Email Data** → Send Gmail to Cleaner |
| Already Has Calendar Event? (TRUE) | Skip (Already Has Event) → Split In Batches | **Unlock When Skipped** → Split In Batches |

**Note:** The **Skip (Already Has Event)** node is still in the workflow but is no longer connected. You can delete it in the editor if you want to tidy the canvas.

---

## Constraints Respected

- **bookingUid** remains the unique key for all CleaningJobs updates (Lock Row, Update Job Assigned, Update Job With Event Id, Finalize Assignment, Unlock When Skipped).
- No unrelated columns are overwritten; each node updates only the listed fields.
- **Filter Pending Only** idempotency logic is preserved and extended (processingFlag).
- **Split In Batches** structure is unchanged; Lock Row is the first step inside the loop, then the rest of the chain as before (with Finalize and Validate inserted before Gmail).

---

## Sheet Requirements

- **CleanersProfile:** Column **calendar ID** (or **calendarId**) must exist and be set per cleaner so the cleaner event is created on the correct calendar.
- **CleaningJobs:** Column **processingFlag** must exist (used for LOCKED / empty).

---

## Node List (new or changed)

| Node | Change |
|------|--------|
| Filter Pending Only | Added `processingFlag === ''` to filter. |
| Assign Cleaner | Throws if CleanersProfile row has no calendar ID. |
| Update Job Assigned | Only updates cleanerId, assignedAt (status removed). |
| Create Admin Calendar Event | Added summary + description. |
| Create Cleaner Calendar Event | Dynamic calendar from `cleanerCalendarId`; added summary + description. |
| **Lock Row** | **New.** Sets processingFlag = LOCKED. |
| **Finalize Assignment** | **New.** Sets status = ASSIGNED and processingFlag = ''. |
| **Validate Email Data** | **New.** Validates required fields before Gmail; throws if missing. |
| **Unlock When Skipped** | **New.** Clears processingFlag when skipping (already has event). |

All other nodes and their logic are unchanged.
