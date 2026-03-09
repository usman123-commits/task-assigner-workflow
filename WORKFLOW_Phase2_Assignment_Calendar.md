# Phase 2 – Cleaner Assignment + Calendar Dispatch

**Workflow file:** `phase2CleanerAssignmentCalendar.json`  
**n8n workflow name:** PHASE 2 – Cleaner Assignment + Calendar Dispatch  
**Purpose:** Assign cleaners to PENDING cleaning jobs, generate clock-in form links, create admin + cleaner calendar events, send assignment email, and finalize job and reservation state.

---

## 1. Trigger

| Type | Configuration |
|------|---------------|
| **Manual Trigger** | For testing. Replace with **Schedule Trigger** (e.g. every 5 min) for production. |

**Flow start:** Manual Trigger → Read CleanersProfile.

---

## 2. Execution flow (node order)

| # | Node name | Type | Role |
|---|-----------|------|------|
| 1 | Manual Trigger | Manual Trigger | Start (use Schedule in production) |
| 2 | Read CleanersProfile | Google Sheets (read) | Read all **CleanersProfile** rows |
| 3 | Single Item for Read Jobs | Code | Emit one item so Read Pending Cleaning Jobs runs once |
| 4 | Read Pending Cleaning Jobs | Google Sheets (read) | Read all **CleaningJobs** rows |
| 5 | Filter Pending Only | Code | Keep: status=PENDING, no cleanerId, no calendarEventId, no processingFlag |
| 6 | Attach CleanersProfile | Code | Attach CleanersProfile rows to each job as `_cleanersProfile` |
| 7 | Split In Batches | Split In Batches | Process one job per batch |
| 8 | Lock Cleaning Job | Google Sheets (update) | Set **CleaningJobs** processingFlag=LOCKED by bookingUid |
| 9 | Lookup Reservation | Google Sheets (read) | Lookup **Reservations** by bookingUid |
| 10 | Ensure One Item (Job or Reservation) | Code | One item: job + reservation or job-only with propertyName/address fallbacks |
| 11 | Merge Job and Reservation | Code | Merge job and reservation for downstream nodes |
| 12 | Assign Cleaner | Code | Resolve cleaner from CleanersProfile by propertyUid; set cleanerId, email, calendarId, etc. |
| 13 | Generate ClockIn Form Link | Code | Build prefilled Google Form URL (bookingUid, cleanerId) → clockInLink |
| 14 | Update Job Assigned | Google Sheets (update) | Update **CleaningJobs** by bookingUid: cleanerId, assignedAt (and any other early fields) |
| 15 | Calculate Cleaning Time | Code | startTime = scheduledCleaningTimeUTC, endTime = startTime + 3h UTC |
| 16 | Already Has Calendar Event? | IF | calendarEventId non-empty? TRUE → Skip / FALSE → Create events |
| 17 | Skip (Already Has Event) | No Op | Rejoin loop (Split In Batches) |
| 18 | Create Admin Calendar Event | Google Calendar | Create event on admin calendar (start/end from Calculate Cleaning Time) |
| 19 | Create Cleaner Calendar Event | Google Calendar | Create event on cleaner calendar; description includes clock-in link |
| 20 | Prepare Event Id for Sheet | Code | Extract event ID from cleaner calendar create response |
| 21 | Update Job With Event Id | Google Sheets (update) | Update **CleaningJobs** by bookingUid: calendarEventId |
| 22 | Send Gmail to Cleaner | Gmail | Send assignment email with property, date, time, calendar link, clock-in link |
| 23 | Finalize Assignment | Google Sheets (update) | Update **CleaningJobs**: status=ASSIGNED, calendarStatus=CREATED, calendarEventId, processingFlag cleared, etc. |
| 24 | Mark jab as assigned in reservation | Google Sheets (update) | Update **Reservations** by bookingUid: cleaningStatus=ASSIGNED |
| (loop) | Split In Batches | — | Next batch or Done |

---

## 3. Google Sheets usage

| Sheet (tab) | Operation | Key columns / notes |
|-------------|-----------|----------------------|
| **CleanersProfile** | Read | property UID, cleaner ID, calendar ID, email, name, contact (and propertyName if used) |
| **CleaningJobs** | Read | All rows; filtered in code to PENDING, no cleanerId, no calendarEventId, no processingFlag |
| **CleaningJobs** | Update (Lock) | bookingUid → processingFlag=LOCKED |
| **CleaningJobs** | Update (Update Job Assigned) | bookingUid → cleanerId, assignedAt |
| **CleaningJobs** | Update (Update Job With Event Id) | bookingUid → calendarEventId |
| **CleaningJobs** | Update (Finalize Assignment) | bookingUid → status=ASSIGNED, calendarStatus=CREATED, calendarEventId, processingFlag=" ", calendarId, cleanerId, assignedAt |
| **Reservations** | Read (lookup) | Lookup by bookingUid |
| **Reservations** | Update (Mark jab as assigned) | bookingUid → cleaningStatus=ASSIGNED |

---

## 4. Clock-in form link (Generate ClockIn Form Link)

- **Constants in node:** FORM_ID, ENTRY_BOOKING_UID_HERE, ENTRY_CLEANER_ID_HERE (set from your Clock-In Form).
- **Output:** `clockInLink` = prefilled form URL with bookingUid and cleanerId.
- **Used in:** Create Cleaner Calendar Event (description), Send Gmail to Cleaner (body).

---

## 5. Key logic

### 5.1 Filter Pending Only

- Keep items where:
  - `status === 'PENDING'`
  - `cleanerId` empty
  - `calendarEventId` empty
  - `processingFlag` empty

### 5.2 Assign Cleaner

- Lookup **CleanersProfile** by `propertyUid` (column "property UID" or propertyUid).
- Throws if no row or no cleaner ID.
- Output: cleanerId, cleanerEmail, cleanerCalendarId, cleanerName, cleanerContact, assignedAt, status=ASSIGNED, propertyName. Removes `_cleanersProfile`.

### 5.3 Calculate Cleaning Time

- Uses `scheduledCleaningTimeUTC` from the job (from Split In Batches).
- startTime = scheduledCleaningTimeUTC, endTime = startTime + 3 hours (UTC).
- No 11:00 or other fallbacks.

### 5.4 Already Has Calendar Event?

- TRUE: `calendarEventId` non-empty → Skip (no duplicate event/email), rejoin loop.
- FALSE: Create admin + cleaner events, update sheet, send email, finalize.

### 5.5 Finalize Assignment (columns written)

- bookingUid, cleanerId, assignedAt, **status=ASSIGNED**, **calendarStatus=CREATED**, calendarEventId, **processingFlag=" "** (cleared), calendarId.
- Match by bookingUid.

---

## 6. Error / rejection paths

- **Assign Cleaner:** Throws if no CleanersProfile row for propertyUid or cleaner ID missing → execution fails for that job.
- **Calculate Cleaning Time:** Throws if scheduledCleaningTimeUTC missing or invalid.
- Calendar or Gmail errors → execution fails for that job; processingFlag may remain LOCKED for that row.

---

## 7. Dependencies

- **CleanersProfile:** property UID, cleaner ID, calendar ID, email, name, contact.
- **CleaningJobs:** status, cleanerId, calendarEventId, processingFlag, scheduledCleaningTimeUTC, bookingUid, etc.
- **Reservations:** bookingUid, cleaningStatus.
- Google Calendar credentials (admin + cleaner calendars).
- Gmail credentials.
- Clock-In Form ID and entry IDs in Generate ClockIn Form Link node.

---

## 8. Known gaps / notes

- **processingFlag:** Finalize Assignment sets processingFlag to a space (`" "`) to clear it. If Finalize never runs (e.g. error after Lock), the row stays LOCKED; consider a separate cleanup or retry strategy.
- **Manual trigger:** Replace with Schedule Trigger for production.
- Admin/cleaner calendar IDs and Gmail sender are configured in the respective nodes.
- Workflow is **inactive** by default (`active: false` in JSON).
