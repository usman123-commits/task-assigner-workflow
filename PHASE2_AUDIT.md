# PHASE 2 – Cleaner Assignment + Calendar Dispatch — Audit Report

**Workflow file:** `phase2CleanerAssignmentCalendar.json`  
**Audit date:** 2025-02-25  
**Scope:** Inspection and validation only. No modifications.

---

## SECTION 1 — Workflow Overview

### 1. Trigger type used

**Manual Trigger** (`n8n-nodes-base.manualTrigger`, typeVersion 1).

Node note: *"Replace with Schedule Trigger (e.g. every 5 min) for production. Kept Manual for testing."*

### 2. Trigger condition logic

There is no conditional logic on the trigger. The workflow runs when:
- Manual Trigger is executed (current setup), or
- Would run on schedule if replaced (e.g. every 5 minutes).

No filter on time-of-day or other conditions at trigger level.

### 3. Whether trigger prevents duplicate processing

The trigger itself does **not** prevent duplicate processing. Duplicate prevention is done **downstream** by:
- **Filter Pending Only:** keeps only rows with `status === 'PENDING'`, `cleanerId === ''`, and no `calendarEventId`.
- **Already Has Calendar Event?:** if `calendarEventId` is set, the workflow skips calendar creation and Gmail and rejoins the loop.

So the same row can be “processed” again on a later run only if it still matches PENDING + empty cleanerId + no event; once assigned and event stored, it will not be selected again.

### 4. How often it runs (if polling)

Currently **never** automatically (manual only). Notes indicate intent to use a **Schedule Trigger (e.g. every 5 min)** for production. No schedule is configured in the JSON.

### 5. What prevents reprocessing the same row twice

- **Read:** Reads **all** rows from the CleaningJobs sheet (no server-side filter).
- **Filter Pending Only (Code):** Keeps only items where:
  - `status === 'PENDING'`
  - `cleanerId === ''`
  - `(calendarEventId ?? '').toString().trim() === ''` (no event yet)
- After a row is updated with `cleanerId`, `assignedAt`, `status = 'ASSIGNED'`, and later `calendarEventId`, it will no longer satisfy this filter on subsequent runs, so it is not reprocessed.

**Conclusion:** Reprocessing is prevented by the filter condition, not by the trigger.

---

## SECTION 2 — Google Sheets Logic

### CleaningJobs sheet

#### 1. How rows are selected (filter condition)

- **Read Pending Cleaning Jobs:** No filters. Operation is full read of sheet **CleaningJobs** (documentId: hostfully spreadsheet).
- **Filter Pending Only (Code):** Client-side filter on the read result:
  - `status === 'PENDING'`
  - `cleanerId === ''`
  - `!hasEvent` where `hasEvent = (calendarEventId ?? '').toString().trim() !== ''`

So “selection” is: read entire sheet, then filter in code.

#### 2. Exact condition used to detect PENDING and empty cleanerId

From **Filter Pending Only** (Code node):

```javascript
const status = (j.status ?? '').toString().trim();
const cleanerId = (j.cleanerId ?? '').toString().trim();
const hasEvent = (j.calendarEventId ?? '').toString().trim() !== '';
return status === 'PENDING' && cleanerId === '' && !hasEvent;
```

- **cleaningStatus:** The workflow uses **`status`**, not `cleaningStatus`. Plan says “cleaningStatus = PENDING”; sheet column in use is **status**.
- **cleanerId empty:** `cleanerId === ''` after trim (null/undefined coerced to '').

#### 3. Lookup-before-update

- There is **no** separate “lookup CleaningJobs by key” before update.
- Filter ensures only unassigned rows are processed; then **Update Job Assigned** and **Update Job With Event Id** are executed in sequence for the same item. So the “lookup” is effectively the initial read + filter; no second read of CleaningJobs before writing.

#### 4. Unique key

- **Update Job Assigned:** `matchingColumns: ["bookingUid"]`.  
- **Update Job With Event Id:** `matchingColumns: ["bookingUid"]`.

**Unique key used for both updates: `bookingUid`.**

#### 5. How update-row is performed

- **Update Job Assigned:**  
  - Operation: `update`.  
  - Match: `bookingUid` from `$json.bookingUid`.  
  - Columns written: `bookingUid`, `cleanerId`, `assignedAt`, `status` (all from `$json`).

- **Update Job With Event Id:**  
  - Operation: `update`.  
  - Match: `bookingUid` from `$json.bookingUid`.  
  - Columns written: `bookingUid`, `calendarEventId`.

Same spreadsheet and sheet as above; update is by row matching `bookingUid`.

#### 6. Whether partial updates can overwrite existing data

- **Update Job Assigned** sends only: `bookingUid`, `cleanerId`, `assignedAt`, `status`. Other columns (e.g. `cleaningDate`, `propertyUid`) are not in the mapping, so they are **not** sent. n8n Google Sheets update typically updates only the provided columns; other columns are left as-is. So partial update does **not** overwrite other fields.
- **Update Job With Event Id** sends only `bookingUid` and `calendarEventId`; same idea.

So: no evidence of blindly overwriting the whole row; only the listed fields are updated.

#### 7. What happens if row not found

If no row in CleaningJobs has the given `bookingUid`, the Google Sheets update node may either:
- Update 0 rows and succeed, or
- Throw (behavior is implementation-dependent).

The workflow does **not** check the update response or handle “row not found” explicitly. So if `bookingUid` is wrong or the row was deleted, the run may still succeed with no visible error, or may error depending on the node’s behavior.

---

## SECTION 3 — Cleaner Assignment Logic

### 1. propertyUid → cleanerId mapping structure

Mapping is **one-to-one by property**: one row in CleanersProfile per property UID, with columns used for:
- **property UID** (or `propertyUid`) — key
- **cleaner ID** (or `cleanerId`) — assigned cleaner
- **calendar ID** (or `calendarId`) — cleaner’s calendar (currently not used for a different calendar; see Section 5)
- **email**, **name**, **contact** — for notification and display

### 2. Where mapping is stored

- **Sheet:** **CleanersProfile** in the same hostfully spreadsheet.
- **Read:** **Read CleanersProfile** reads the whole sheet (no filter).
- **Usage:** **Attach CleanersProfile** attaches the array of profile rows to each job as `_cleanersProfile`. **Assign Cleaner** (Code) receives the current item (with `_cleanersProfile`) and looks up by `propertyUid` in that array. So mapping is **stored in Google Sheets**, **loaded once per run**, and **used in a Code node** from the in-memory array.

### 3. What happens if propertyUid has no mapping

**Assign Cleaner** throws:

```javascript
if (!mapping) {
  throw new Error(`No cleaner for propertyUid: ${propertyUid}. Add a row in CleanersProfile with property UID = ${propertyUid}.`);
}
```

Execution stops; no fallback assignment.

### 4. Fallback logic

**None.** Missing mapping or missing cleaner ID in the row both throw. No default cleaner, no “unassigned” path.

### 5. Is assignedAt timestamp UTC?

Yes. **Assign Cleaner** sets:

```javascript
const assignedAt = new Date().toISOString();
```

`toISOString()` is UTC.

### 6. Timezone explicitly handled?

- **assignedAt:** UTC only; no timezone field or conversion.
- **Cleaning time (Section 4):** Uses `new Date(cleaningDateRaw)` then `setHours(11, 0, 0, 0)` and `toISOString()`. So 11:00 is applied in the **local timezone of the n8n server**, then converted to ISO (UTC). Timezone is **not** explicitly set (e.g. no property timezone or user timezone); it depends on server locale.

---

## SECTION 4 — Cleaning Time Calculation

### 1. How startTime is calculated

**Calculate Cleaning Time** (Code):

- Takes `cleaningDateRaw = item.cleaningDate || item.checkOut || ''`.
- `d = new Date(cleaningDateRaw)` then `d.setHours(11, 0, 0, 0)`.
- `startTime = d.toISOString()`.

So start is **the cleaning date at 11:00** in the **server’s local timezone**, then expressed in UTC (ISO).

### 2. Checkout time vs fixed 11:00 AM

**Fixed 11:00 AM** is used. Checkout time is **not** used; only the **date** part of `cleaningDate` / `checkOut` is used, and the time is forced to 11:00.

### 3. How duration is defined

In code: `const DURATION_HOURS = 3;` (hardcoded). Note says “Change DURATION_HOURS to make configurable.”

### 4. How endTime is calculated

```javascript
const endDate = new Date(startTime);
endDate.setHours(endDate.getHours() + DURATION_HOURS);
const endTime = endDate.toISOString();
```

So **endTime = startTime + 3 hours** (in UTC).

### 5. Timezone in calendar event

- Calendar nodes receive **start** and **end** as `$json.startTime` and `$json.endTime` (ISO strings).
- Google Calendar API accepts ISO; it will store the event in UTC and show it in the calendar’s/user’s timezone. The workflow does **not** set a timezone property on the event; it only passes ISO start/end. So timezone is implicit (UTC from the workflow, display by Calendar).

---

## SECTION 5 — Google Calendar Events

### Both Admin and Cleaner calendars

#### 1. Calendar IDs used

- **Create Admin Calendar Event:** `calendar: { value: "usman2acountf@gmail.com", ... }`
- **Create Cleaner Calendar Event:** `calendar: { value: "usman2acountf@gmail.com", ... }`

**Both nodes use the same calendar ID:** `usman2acountf@gmail.com`. So both events are created on the **same** calendar. The plan’s “Master Admin Calendar” and “Cleaner-specific calendar” are not implemented as two different calendars.

#### 2. Event title format

No **title** (or **summary**) is set in the node parameters. Only `start`, `end`, and `additionalFields: {}` are present. So the event title is **empty** or default. Plan expected something like: “Cleaning – [Property Name] – [Guest Name]”.

#### 3. Event description structure

**additionalFields** is `{}`. No description is set. Plan expected Property, Full Address, Guest Count, Booking Reference ID, Internal Notes.

#### 4. Start/end time format

- **start:** `={{ $json.startTime }}` (ISO string from Calculate Cleaning Time).
- **end:** `={{ $json.endTime }}` (ISO string).

So format is **ISO (UTC)**.

#### 5. Whether eventId is captured

Yes. **Prepare Event Id for Sheet** reads the **Create Cleaner Calendar Event** response:

```javascript
const eventResult = $input.first().json;
const eventId = eventResult?.id ?? eventResult?.data?.id ?? '';
```

So it uses `id` or `data.id` from the Calendar node output.

#### 6. Which eventId is stored in sheet

The **cleaner** calendar event’s ID is stored. **Prepare Event Id for Sheet** takes the output of **Create Cleaner Calendar Event** (not Admin). That value is written to the sheet as `calendarEventId` by **Update Job With Event Id**. So the sheet holds the **cleaner calendar event ID** (which in the current config is on the same calendar as the admin event).

#### 7. Duplicate event prevention

- **Filter Pending Only** excludes rows that already have `calendarEventId` set.
- **Already Has Calendar Event?** branch: if `($json.calendarEventId ?? '').toString().trim() !== ''`, the workflow goes to **Skip (Already Has Event)** (noOp) and does **not** create events or send email.

So duplicate event creation is prevented by **not** processing rows that already have `calendarEventId`, and by skipping event creation when the current item already has an event ID.

#### 8. Condition that prevents recreating events if already assigned

Same as above: **Filter Pending Only** ensures we only process rows with `cleanerId === ''` and no `calendarEventId`. Once a job is assigned and has an event, it fails the filter and is never selected again. Inside the loop, **Already Has Calendar Event?** adds a second guard so that even if an item with an event reached this node, it would skip creation.

---

## SECTION 6 — Gmail Notification

### 1. Email recipient source

**Send Gmail to Cleaner:** `sendTo: "={{ $json.cleanerEmail }}"`.

So the recipient is **cleanerEmail** on the current `$json`. That comes from **Assign Cleaner**, which sets `cleanerEmail` from the CleanersProfile row (column **email**). The same item (with `cleanerEmail`) is passed through Update Job Assigned → Calculate Cleaning Time → … → Update Job With Event Id. If the Sheets update node **passes through** the input item, `$json` in Gmail still has `cleanerEmail`. If the node replaces `$json` with the sheet response, `cleanerEmail` might be missing unless the sheet has an email column. So **recipient is intended to be the CleanersProfile email**; correctness depends on data still being on `$json` at the Gmail node.

### 2. Subject template

`=New Cleaning Assigned – {{ $('Calculate Cleaning Time').last().json.propertyName || $('Calculate Cleaning Time').last().json.propertyUid }}`

So: **“New Cleaning Assigned – [Property Name or propertyUid]”.**

### 3. Body template

Plain text, including:
- “You have been assigned a new cleaning job.”
- Property: propertyName or propertyUid
- Address: address or “See assignment”
- Date: cleaningDate or checkOut
- Time: 11:00 AM
- Guest Count: adultCount
- Booking Reference: bookingUid
- Calendar Event: link built from `$json.calendarEventId` (see below)
- “This email serves as official assignment confirmation.”

### 4. Calendar link included

Yes. Body includes:

`{{ $json.calendarEventId ? 'https://calendar.google.com/calendar/event?eid=' + encodeURIComponent($json.calendarEventId) : 'Event created – check your calendar' }}`

So if `calendarEventId` is set, a link with `eid=` + encoded event ID is included. Google’s public event URL format may differ (e.g. base64); this format may need verification.

### 5. bookingUid in message

Yes. “Booking Reference: {{ $('Calculate Cleaning Time').last().json.bookingUid }}”.

### 6. If Gmail send fails

There is no error handling, retry, or fallback. If **Send Gmail to Cleaner** throws, the execution fails. The sheet and calendar updates for that job have already been committed (Update Job Assigned, Create Admin/Cleaner events, Update Job With Event Id). So the job is marked assigned and has an event, but the cleaner may not receive the email; there is no retry or “email failed” path.

---

## SECTION 7 — Idempotency & Safety

### 1. Can this workflow create duplicate calendar events?

- **For the same job in one run:** No. Each job is processed once per run (Split In Batches, one item at a time), and event creation runs once per item.
- **For the same job across runs:** No. Rows with `calendarEventId` set are filtered out and, if they ever reached the IF, would take “Already Has Calendar Event?” → Skip. So duplicate events for the same booking are prevented.

### 2. Can it assign the same job twice?

No. After **Update Job Assigned**, the row has `cleanerId` and `status = 'ASSIGNED'`. **Filter Pending Only** requires `cleanerId === ''`, so that row will not be selected in future runs. So the same job is not assigned again.

### 3. What prevents race conditions?

- **Single execution:** One trigger run processes a fixed snapshot of the sheet (read once at start). No concurrent runs are coordinated in the workflow.
- **Sequential updates:** For each job, Assign → Update Job Assigned → … → Update Job With Event Id → Gmail run in sequence. So there is no in-workflow parallel write to the same row.
- **Race between runs:** If two schedule runs overlap (e.g. every 5 min), both could read the same row before either writes. Then both could assign and create events, leading to duplicate assignments/events. So **concurrent runs are not protected** (no locking, no “claim row” pattern).

### 4. What prevents overwriting cleanerId?

- Only rows with **empty** `cleanerId` are selected (Filter Pending Only). So we never process an already-assigned job.
- Update Job Assigned **sets** cleanerId; it does not read-then-merge. So within a run we do not overwrite another run’s assignment; we only write to rows we just selected as unassigned.

### 5. Failure halfway (after calendar created, before sheet updated)

- If the run fails **after** Create Admin + Create Cleaner Calendar Event but **before** Update Job With Event Id:
  - The sheet still has no `calendarEventId` (and possibly no `cleanerId`/`status` if failure was before Update Job Assigned).
  - Next run: the row still matches PENDING + empty cleanerId + no calendarEventId, so it is **selected again**. Assign Cleaner and calendar creation run again → **duplicate calendar events** for the same job. The sheet is then updated with the new event ID (and assignment if it hadn’t been written).
- If failure is **after** Update Job Assigned but **before** Update Job With Event Id:
  - Row has cleanerId and status ASSIGNED but no calendarEventId. Next run: filter requires `!hasEvent`; the row has no event, so it is **selected again** → duplicate events and possibly duplicate email.
- So **mid-run failure can cause duplicate calendar events and duplicate emails**; only Filter Pending Only’s `calendarEventId` check prevents re-processing once the event ID is stored.

---

## SECTION 8 — Error Handling

### 1. Try/catch or error nodes

- **Assign Cleaner** uses `throw new Error(...)` when mapping is missing or cleaner ID is empty; no try/catch.
- No dedicated error-handling or catch nodes in the flow. Errors propagate and fail the run.

### 2. Are errors logged?

Only n8n’s default execution log. No explicit logging node or external logging.

### 3. Retry logic

None. No retry on Google Sheets, Calendar, or Gmail nodes.

### 4. Failure recovery plan

Not defined in the workflow. Manual: re-run (which can cause duplicates if the row was partially updated, as in Section 7.5). No “resume from failure” or idempotent retry design.

---

## SECTION 9 — Data Integrity

### bookingUid as unique key

- **Update Job Assigned** and **Update Job With Event Id** both match on `bookingUid`. So **bookingUid is the unique key** for CleaningJobs updates. Confirmed.

### calendarEventId stored after creation

- **Prepare Event Id for Sheet** takes the cleaner calendar event ID from the create response and sets `calendarEventId` on the item.
- **Update Job With Event Id** writes `calendarEventId` to the sheet by `bookingUid`. So **calendarEventId is stored after creation**. Confirmed.

### cleaningStatus updated only after successful assignment

- **Update Job Assigned** sets `status: 'ASSIGNED'` and runs **after** Assign Cleaner and **before** calendar creation. So the sheet is updated to ASSIGNED **before** events exist or email is sent. If the run fails after Update Job Assigned but before Update Job With Event Id, the row is ASSIGNED but has no event and can be re-processed (see Section 7.5). So status is updated on “successful assignment” (cleaner chosen and written), not on “full success” (event + email). Plan may intend “only after successful assignment” to mean “after everything”; current behavior is “after Assign Cleaner + sheet update”.

### No field blindly overwritten

- Updates send only the listed columns (`bookingUid`, `cleanerId`, `assignedAt`, `status` and then `bookingUid`, `calendarEventId`). Other columns are not in the mapping. So we do **not** blindly overwrite the whole row; only specified fields are updated. Confirmed.

---

## Risk Assessment

### Level: **Medium–High**

**Why:**

1. **Duplicate events/emails on partial failure:** If execution fails after calendar creation (or after Update Job Assigned) but before Update Job With Event Id (or Gmail), the next run can process the same row again and create duplicate events and send duplicate email. Only storing `calendarEventId` (and filter on it) prevents this once the full path has run.
2. **No concurrent-run protection:** Overlapping schedule runs can both pick the same row and double-assign / double-event.
3. **Same calendar for “Admin” and “Cleaner”:** Both events go to `usman2acountf@gmail.com`; plan expected two calendars. Functional but does not match design.
4. **No error handling or retry:** Any node failure fails the run; no retry or structured recovery.
5. **Gmail recipient robustness:** Depends on `cleanerEmail` still being on `$json` after the Sheets update node; if the node strips it, email may fail or go to wrong recipient.
6. **Column naming:** Phase 1 uses **assignedCleaner** in CleaningJobs; Phase 2 uses **cleanerId**. If the sheet has only one of these, the other logic (filter or update) may be wrong. Needs confirmation.
7. **Calendar event title/description:** Empty; plan expected meaningful title and description.
8. **Timezone:** 11:00 AM is in server local time; no property or user timezone.

### Improvements (no implementation; recommendations only)

- Add **Update Job With Event Id** (or a single “commit” step) only after **both** calendar events and sheet update for event ID succeed, and consider moving “ASSIGNED” and event ID write to one step after events, to reduce “assigned but no event” state.
- Ensure **Filter Pending Only** also excludes rows that already have `cleanerId` set (already enforced) and that sheet columns align (cleanerId vs assignedCleaner).
- Use **two different calendar IDs** for Admin vs Cleaner if the plan is to be followed; populate Cleaner calendar from CleanersProfile **calendar ID** column.
- Set **event title** (e.g. “Cleaning – [Property] – [Guest]”) and **description** from reservation/job data.
- Add **error handling** (e.g. catch node) and optional **retry** for Sheets/Calendar/Gmail; log failures.
- Consider **locking** or “claim” (e.g. set a “processing” flag) to avoid two runs processing the same row; or run the workflow sequentially (e.g. one run at a time).
- Verify **Gmail** receives `$json.cleanerEmail` after the update node; if not, pass email explicitly (e.g. from a node that has the full item).
- Make **duration** and **fixed time** (11:00) configurable (e.g. from sheet or env) and document timezone (server vs property).

---

**End of audit. No changes were made to the workflow.**
