# Phase 1 – New Booking Finder (Hostfully to Operto Reservation Cleaning Sync)

**Workflow file:** `newBookingFinder.json`  
**n8n workflow name:** Hostfully to Operto Reservation Cleaning Sync  
**Purpose:** Sync new Hostfully bookings into the Operto spreadsheet: create or skip Reservation rows, create CleaningJobs for new bookings, and link them via `cleaningJobId`.

---

## 1. Trigger

| Type | Configuration |
|------|---------------|
| **Schedule Trigger** | Interval-based (e.g. every N minutes). No webhook. |

**Flow start:** Schedule Trigger → Read Last Timestamp.

---

## 2. Execution flow (node order)

| # | Node name | Type | Role |
|---|-----------|------|------|
| 1 | Schedule Trigger | Schedule Trigger | Start on interval |
| 2 | Read Last Timestamp | Google Sheets (read) | Read `storedTimestamp` from config sheet |
| 3 | Initialize Cursor | Code | Set cursor = null, accumulatedLeads = [], storedTimestamp from sheet (or `1970-01-01`) |
| 4 | Fetch Hostfully Leads | HTTP Request | GET Hostfully API v3 leads with `updatedSince` and optional `_cursor` |
| 5 | Accumulate Leads | Code | Append API leads to accumulated list; set next cursor |
| 6 | Has More Pages?1 | IF | cursor empty? → Done (output 0). Else → next page (output 1) |
| 7 | Output Leads Individually | Split Out | Emit one item per lead from `accumulatedLeads` |
| 8 | Filter New Bookings | Code | Keep only: `metadata.createdUtcDateTime > storedTimestamp`, type BOOKING, status BOOKED |
| 9 | Split In Batches | Split In Batches | Process one booking per batch; output 0 = Done, output 1 = next item |
| 10 | Lookup Reservation | Google Sheets (read) | Lookup **Reservations** by `bookingUid` |
| 11 | Ensure One Item | Code | One item: either lookup row or job-only with fallbacks |
| 12 | Merge Lead and Lookup | Code | Merge Hostfully lead with lookup result |
| 13 | Reservation Exists? | IF | Reservation row exists? TRUE → Cleaning Job Needed? / FALSE → Create Reservation Record |
| 14 | Create Reservation Record | Google Sheets (append) | Append row to **Reservations** from Hostfully + set cleaningStatus=PENDING, etc. |
| 15 | Cleaning Job Needed? | IF | `cleaningJobId` empty? TRUE → Prepare Cleaning Job Data / FALSE → back to Split In Batches |
| 16 | Prepare Cleaning Job Data | Code | Build cleaning job from lead: checkoutTimeUTC, scheduledCleaningTimeUTC, status PENDING |
| 17 | Create Cleaning Job Record | Google Sheets (append) | Append row to **CleaningJobs** |
| 18 | Update Reservation with Cleaning Job ID | Google Sheets (update) | Update **Reservations** row by bookingUid: set cleaningJobId |
| 19 | Compute Max After Loop | Code | After loop Done: compute new storedTimestamp from max updatedUtcDateTime (+1 ms) |
| 20 | Update Stored Timestamp | Google Sheets (update) | Update config row (key=config) with new storedTimestamp |

---

## 3. Google Sheets usage

| Sheet (tab) | Operation | Key columns / notes |
|-------------|-----------|----------------------|
| **timeStamps** | Read | Columns: `key`, `storedTimestamp`. Row with key=config. |
| **timeStamps** | Update | Same row: set `storedTimestamp` to latest processed time. |
| **Reservations** | Read (lookup) | Lookup by `bookingUid`. |
| **Reservations** | Append | New row: bookingUid, propertyUid, guestName, checkIn, checkOut, adultCount, source, createdUtc, cleaningStatus=PENDING, maintenanceStatus, payrollStatus, createdAtSystem, childrenCount. |
| **Reservations** | Update | Match `bookingUid`; set `cleaningJobId`. |
| **CleaningJobs** | Append | cleaningJobId, bookingUid, propertyUid, cleaningDate, cleaningTime, checkoutTimeUTC, scheduledCleaningTimeUTC, status=PENDING, createdAtSystem. |

**Spreadsheet:** Same document ID as other workflows (hostfully spreadsheet).

---

## 4. External API

- **Hostfully API v3** – Leads endpoint: `https://platform.hostfully.com/api/v3/leads`
  - Query: `updatedSince={{ storedTimestamp }}`, optional `_cursor` for pagination.
  - Headers: `X-HOSTFULLY-APIKEY`, `agencyUid` (query).
  - Response: `leads[]`, `_paging._nextCursor`.

---

## 5. Key logic

### 5.1 New booking filter (Filter New Bookings)

- Uses `storedTimestamp` from **timeStamps** (last run).
- Keeps items where:
  - `metadata.createdUtcDateTime > storedTimestamp`
  - `type === 'BOOKING'`
  - `status === 'BOOKED'`
- **Note:** “New” is based on **creation** date only. Extended checkout / rebookings that only change `updatedUtcDateTime` are not treated as “new” by this filter.

### 5.2 Cleaning job data (Prepare Cleaning Job Data)

- Reads lead from **Merge Lead and Lookup** (Hostfully payload).
- `cleaningJobId` = `bookingUid + '_CLEAN'` (or empty if no bookingUid).
- `checkoutTimeUTC` and `scheduledCleaningTimeUTC` from `checkOutZonedDateTime` (must have Z or ±offset).
- Throws if checkout time missing or invalid.
- Output: cleaningJobId, bookingUid, propertyUid, cleaningDate, cleaningTime, checkoutTimeUTC, scheduledCleaningTimeUTC, status PENDING, createdAtSystem.

### 5.3 Cleaning Job Needed? (IF)

- TRUE when `cleaningJobId` is empty → create cleaning job and update reservation.
- FALSE when reservation already has cleaningJobId → skip job creation, continue loop.

---

## 6. Error / rejection paths

- **Prepare Cleaning Job Data:** Throws if `checkOutZonedDateTime` missing, not zoned, or unparseable → execution fails for that item.
- **Create Reservation Record / Create Cleaning Job Record / Update:** Sheet or credential errors → execution fails for that item.
- No explicit “rejection” branch; filtering is done in **Filter New Bookings** and **Reservation Exists?** / **Cleaning Job Needed?**.

---

## 7. Dependencies

- **Reservations** sheet: columns as above; must have `bookingUid` for lookup and update.
- **CleaningJobs** sheet: columns as above.
- **timeStamps** sheet: `key`, `storedTimestamp` (e.g. key=config, storedTimestamp=ISO date).
- Hostfully credentials and agency UID in HTTP Request node.

---

## 8. Known gaps / notes

- **Extended checkout:** Only bookings with `metadata.createdUtcDateTime > storedTimestamp` are processed. Changes that only update `updatedUtcDateTime` (e.g. extended checkout) do not trigger a new reservation or cleaning job.
- **Timestamp advance:** After each run, storedTimestamp is set to max `updatedUtcDateTime` in the batch + 1 ms to avoid re-processing the same booking.
- Workflow is **inactive** by default (`active: false` in JSON).
