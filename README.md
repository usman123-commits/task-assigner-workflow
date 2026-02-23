# Hostfully to Operto Reservation Cleaning Sync

n8n workflow that fetches leads from the Hostfully API using a stored **last-processed timestamp** (in Google Sheets), accumulates them with pagination, filters to **new confirmed bookings only** (`type === "BOOKING"`, `status === "BOOKED"`, `createdUtcDateTime > storedTimestamp`), **creates reservation and cleaning job records** in Google Sheets (Reservations and CleaningJobs tabs) for each new booking (with duplicate check), and advances the stored timestamp from the max **updatedUtcDateTime** so the next run only fetches newer leads.

---

## Overview

| Property | Value |
|----------|--------|
| **Workflow name** | Hostfully to Operto Reservation Cleaning Sync |
| **Trigger** | Manual (“Execute workflow”) |
| **Purpose** | Fetch leads updated after last stored timestamp, detect new confirmed bookings, create/update reservation and cleaning job rows in Google Sheets (no duplicates), and advance the stored timestamp. |

---

## Flow Summary

```
Manual trigger
    → Read Last Timestamp (Google Sheets)
    → Initialize Cursor (cursor, accumulatedLeads, storedTimestamp; normalizes timestamp format)
    → Fetch Hostfully Leads (updatedSince = storedTimestamp)
    → Accumulate Leads
    → Has More Pages?
        → No (no more pages):
            → Output Leads Individually
            → Filter New Bookings (createdUtcDateTime > storedTimestamp; type BOOKING, status BOOKED)
            → Split In Batches (one lead per batch)
            → [per lead] Lookup Reservation (sheet: Reservations, by bookingUid)
            → Ensure One Item (0 rows → { _noMatch: true })
            → Merge (lead + lookup result)
            → Reservation Exists?
                → output 0 (exists, skip): loop back to Split In Batches
                → output 1 (new): Create Reservation Record → Prepare Cleaning Job Data
                    → Create Cleaning Job Record → Update Reservation with Cleaning Job ID
                    → loop back to Split In Batches
        → and → Compute Max Updated Timestamp
            → Update Stored Timestamp (Google Sheets)
        → Yes (more pages): loop back to Fetch Hostfully Leads
```

---

## Google Sheets Setup

Use **one spreadsheet** with **three areas** (tabs/sheets):

### 1. Timestamp config (e.g. sheet “hostfully” or first tab)

- **Columns:** `key`, `storedTimestamp`.
- **Row 1:** Headers. **Row 2:** `key` = `config`, `storedTimestamp` = ISO date (e.g. `2026-02-19T00:00:00.000Z`).

**Read Last Timestamp** and **Update Stored Timestamp** use this sheet. If empty or no rows, the workflow uses `1970-01-01T00:00:00.000Z`. **Initialize Cursor** normalizes the value (space → `T`) for the API.

### 2. Tab “Reservations”

- **Purpose:** One row per booking; used to avoid duplicate reservation/cleaning creation.
- **Required column:** `bookingUid` (for lookup and update). Other columns used by the workflow: `propertyUid`, `guestName`, `checkIn`, `checkOut`, `adultCount`, `source`, `createdUtc`, `cleaningStatus`, `cleaningJobId`, `createdAtSystem`.
- **Lookup Reservation** reads rows where `bookingUid` = lead’s `uid`. **Create Reservation Record** appends a new row. **Update Reservation with Cleaning Job ID** updates `cleaningJobId` for the row matching `bookingUid`.

### 3. Tab “CleaningJobs”

- **Purpose:** One row per cleaning job linked to a reservation.
- **Columns:** `cleaningJobId`, `bookingUid`, `propertyUid`, `cleaningDate`, `cleaningTime`, `status`, `assignedCleaner`, `clockIn`, `clockOut`, `workedHours`, `createdAtSystem`.
- **Create Cleaning Job Record** appends rows; `cleaningJobId` = `bookingUid` + `_CLEAN`.

---

## Nodes

### 1. When clicking ‘Execute workflow’

- **Type:** Manual Trigger  
- **Role:** Starts the workflow on demand.

---

### 2. Read Last Timestamp

- **Type:** Google Sheets (Read)  
- **Role:** Reads the stored last-processed timestamp from the sheet.
- **Output:** One or more rows; the workflow uses the first row and expects a field `storedTimestamp` or `lastProcessedTimestamp` (mapped to `storedTimestamp` in **Initialize Cursor**).
- **Configure:** Document (spreadsheet), Sheet name, and Google Sheets credentials.

---

### 3. Initialize Cursor

- **Type:** Code  
- **Role:** Sets initial state for pagination and passes through the stored timestamp. Normalizes the timestamp from the sheet: if it contains a space (e.g. Google Sheets date format), replaces it with `T` so the value is valid for the Hostfully API (`updatedSince`).
- **Output:** One item:
  - `cursor`: `null`
  - `accumulatedLeads`: `[]`
  - `storedTimestamp`: from **Read Last Timestamp** (or `1970-01-01T00:00:00.000Z` if missing/empty), normalized for API use.

---

### 4. Fetch Hostfully Leads

- **Type:** HTTP Request  
- **Role:** Fetches a page of leads updated **after** `storedTimestamp`. Receives `storedTimestamp` and optional `cursor` from the previous node (Initialize Cursor on first run, or Has More Pages? / Accumulate Leads on loop).
- **URL:**  
  `https://platform.hostfully.com/api/v3/leads?updatedSince={{ $json.storedTimestamp }}{{ $json.cursor ? '&_cursor=' + $json.cursor : '' }}`
- **Query:** `agencyUid` (unchanged).
- **Headers:** `X-HOSTFULLY-APIKEY` (Hostfully API key).

Only leads with `updatedUtcDateTime` after the stored timestamp are requested.

---

### 5. Accumulate Leads

- **Type:** Code  
- **Role:** Same pagination logic as before; also passes through `storedTimestamp` so the loop and **Filter New Bookings** can use it.
- **Output:** One item with `cursor`, `accumulatedLeads`, and `storedTimestamp` (from previous run or **Initialize Cursor**).

---

### 6. Has More Pages?1

- **Type:** IF  
- **Role:** Same as before: no more pages → **Output Leads Individually** and **Compute Max Updated Timestamp**; more pages → loop back to **Fetch Hostfully Leads**.

---

### 7. Output Leads Individually

- **Type:** Split Out  
- **Role:** Splits `accumulatedLeads` into one item per lead (unchanged).

---

### 8. Filter New Bookings

- **Type:** Code  
- **Role:** Keeps only **newly created, confirmed bookings** (so downstream runs only for real bookings, not inquiries).
- **Logic:** For each lead, return the lead only if **all** are true:
  - `lead.metadata?.createdUtcDateTime` exists
  - `createdUtcDateTime > storedTimestamp` (uses `storedTimestamp` from **Accumulate Leads** last run)
  - `lead.type === "BOOKING"`
  - `lead.status === "BOOKED"`
- **Output:** Only confirmed new bookings; then passed to **Split In Batches** for reservation/cleaning job creation. INQUIRY (NEW/CLOSED) and non-BOOKED leads are filtered out.
- **Note:** “New” is based on **creation** time (`createdUtcDateTime`), not when the lead became BOOKED. See [Limitation: INQUIRY promoted to BOOKING](#limitation-inquiry-promoted-to-booking) if leads can start as INQUIRY and later become BOOKING.

---

### 9. Split In Batches

- **Type:** Split In Batches  
- **Role:** Processes each new booking one at a time (batch size 1). Sends each lead to **Lookup Reservation** and **Merge**; both “skip” and “create” branches connect back to this node to continue the loop.

---

### 10. Lookup Reservation

- **Type:** Google Sheets (Read)  
- **Role:** Checks if this booking already has a row in **Reservations** (idempotency).
- **Sheet:** Reservations. **Filter:** column `bookingUid`, value `{{ $json.uid }}`.
- **Output:** Matching rows, or none. **Ensure One Item** turns “no rows” into one item `{ _noMatch: true }` so the IF can branch.

---

### 11. Ensure One Item

- **Type:** Code  
- **Role:** If Lookup returned 0 items → output one item `{ _noMatch: true }`. Otherwise pass through the lookup result. Ensures **Merge** (combine by position) always has one item from the lookup side.

---

### 12. Merge

- **Type:** Merge (combine by position)  
- **Role:** Combines the current lead (from Split In Batches) with the lookup result or `_noMatch` (from Ensure One Item). The merged item is used by **Reservation Exists?** and, on the create path, by **Create Reservation Record**.

---

### 13. Reservation Exists?

- **Type:** IF  
- **Role:** Branch by whether the reservation already exists.
- **Condition:** `$json._noMatch === true` (i.e. Lookup found no row).
  - **FALSE (output 0):** reservation exists (row found; `_noMatch` not true) → connect back to **Split In Batches** (skip creation).
  - **TRUE (output 1):** `_noMatch` is true (no row found) → new booking → **Create Reservation Record**.

---

### 14. Create Reservation Record

- **Type:** Google Sheets (Append)  
- **Role:** Appends one row to **Reservations** for the new booking. Does not overwrite existing rows.
- **Sheet:** Reservations. **Mapped fields:** `bookingUid` (lead `uid`), `propertyUid`, `guestName` (firstName + lastName), `checkIn` / `checkOut` (local date/time), `adultCount`, `source` (channel), `createdUtc`, `cleaningStatus` = `"PENDING"`, `cleaningJobId` = `""`, `createdAtSystem` = `$now`. Optional chaining used for guest fields.

---

### 15. Prepare Cleaning Job Data

- **Type:** Code  
- **Role:** Builds one cleaning job object from the lead/reservation: `cleaningJobId` = `bookingUid` + `_CLEAN`, `cleaningDate` / `cleaningTime` from `checkOutLocalDateTime`, `status` = `"PENDING"`, empty strings for `assignedCleaner`, `clockIn`, `clockOut`, `workedHours`, `createdAtSystem` = `new Date().toISOString()`.

---

### 16. Create Cleaning Job Record

- **Type:** Google Sheets (Append)  
- **Role:** Appends one row to **CleaningJobs** with the object from **Prepare Cleaning Job Data**.

---

### 17. Update Reservation with Cleaning Job ID

- **Type:** Google Sheets (Update)  
- **Role:** Updates the **Reservations** row for this booking: set `cleaningJobId` to the value from the cleaning job. **Match column:** `bookingUid`. Then the flow connects back to **Split In Batches** for the next lead.

---

### 18. Compute Max Updated Timestamp

- **Type:** Code  
- **Role:** From **all** accumulated leads (not only filtered), compute the maximum `metadata.updatedUtcDateTime` so the next run can use it as `updatedSince`.
- **Input:** The single item from **Has More Pages?** (no more pages) with `accumulatedLeads` and `storedTimestamp`.
- **Output:** One item: `key: 'config'`, `storedTimestamp: maxUpdatedTime` (or previous `storedTimestamp` if no dates found). Does not assume API returns sorted data.

---

### 19. Update Stored Timestamp

- **Type:** Google Sheets (Update)  
- **Role:** Writes the new timestamp back to the timestamp sheet (row where `key` = `config`).
- **Configure:** Same document/sheet as **Read Last Timestamp**. Set **Column to match on** to `key` (value to match: `config`). Map columns `key` and `storedTimestamp` from the incoming item.

---

## Configuration

| What | Where |
|------|--------|
| **Google Sheets (one spreadsheet)** | Same document for all nodes. Tabs: one for timestamp (`key` / `storedTimestamp`), **Reservations**, **CleaningJobs**. |
| **Timestamp sheet** | **Read Last Timestamp** and **Update Stored Timestamp**: columns `key`, `storedTimestamp`; row `key` = `config`. |
| **Reservations tab** | **Lookup Reservation**, **Create Reservation Record**, **Update Reservation with Cleaning Job ID**. Column `bookingUid` required; other columns per node mapping. |
| **CleaningJobs tab** | **Create Cleaning Job Record**. Columns as in Prepare Cleaning Job Data output. |
| **Agency UID** | Fetch Hostfully Leads → Query: `agencyUid`. |
| **Hostfully API key** | Fetch Hostfully Leads → Headers: `X-HOSTFULLY-APIKEY`. Prefer n8n credentials over hardcoding. |

---

## Usage

1. Create one Google Spreadsheet with: (a) a timestamp sheet (`key`, `storedTimestamp`, row `config` + initial ISO timestamp or leave empty); (b) tab **Reservations** with header row and column `bookingUid`; (c) tab **CleaningJobs** with headers for cleaning job fields.
2. In n8n, set Google Sheets credentials and the same document for **Read Last Timestamp**, **Update Stored Timestamp**, **Lookup Reservation**, **Create Reservation Record**, **Update Reservation with Cleaning Job ID**, and **Create Cleaning Job Record**. Set sheet/tab to the timestamp sheet, **Reservations**, or **CleaningJobs** as appropriate.
3. Run with **Execute workflow**.
4. New confirmed bookings (BOOKING + BOOKED) are processed one by one: lookup by `uid` in Reservations; if not found, a reservation row and a cleaning job row are created and the reservation is updated with `cleaningJobId`. If found, the lead is skipped (no duplicate rows).
5. After each run, the stored timestamp is updated so the next run only fetches leads updated after that time.

---

## Rules (summary)

- **Timestamp format:** The value read from the sheet is normalized in **Initialize Cursor** (space → `T`) so it is valid for the Hostfully API. No separate Edit/Set node is used.
- **New bookings:** Use `metadata.createdUtcDateTime`, `type === "BOOKING"`, and `status === "BOOKED"`; keep only leads that pass all three and `createdUtcDateTime > storedTimestamp`.
- **Reservation/cleaning creation:** Runs only for leads that pass Filter New Bookings. Each lead is looked up in **Reservations** by `bookingUid` (= lead `uid`); if a row exists, the lead is skipped (no duplicate reservation or cleaning job). If no row exists, one reservation row and one cleaning job row are created and the reservation is updated with `cleaningJobId`.
- **Idempotency:** Re-running the workflow does not create duplicate reservation or cleaning job rows for the same booking, because **Lookup Reservation** and **Reservation Exists?** skip creation when a row already exists.
- **No new bookings:** If Filter New Bookings outputs 0 items, **Split In Batches** receives nothing and the reservation/cleaning chain does not run; **Compute Max Updated Timestamp** and **Update Stored Timestamp** still run from **Has More Pages?** and the stored timestamp is updated as usual.
- **Advancing timestamp:** Use `metadata.updatedUtcDateTime`; set stored timestamp to **max** of all accumulated leads’ `updatedUtcDateTime`.
- **No assumption of sorted data:** Max is always computed from the full `accumulatedLeads` list.
- **Pagination:** Unchanged; accumulation and `storedTimestamp` pass-through only.

---

## Limitation: INQUIRY promoted to BOOKING

**Label:** `createdUtcDateTime` vs booking confirmation time

The workflow detects “new booking” using **creation time** (`metadata.createdUtcDateTime > storedTimestamp`), not the time the lead became a confirmed booking.

- **When this is fine:** If in your business a lead is created directly as BOOKING + BOOKED, creation time and booking time are the same. The current logic is correct.

- **When this is a problem:** If a lead can start as **INQUIRY** and later be promoted to **BOOKING** + **BOOKED**, then:
  - `createdUtcDateTime` stays the original (old) creation time.
  - The workflow only keeps leads where `createdUtcDateTime > storedTimestamp`.
  - So once `storedTimestamp` has moved past that creation time, the lead will **not** be detected as a new booking when it later becomes BOOKED.
  - Result: **promoted INQUIRY → BOOKING leads can be missed** if they are confirmed after the stored timestamp has already advanced past their creation date.

**If that scenario exists in your business:** Change the **Filter New Bookings** node to use `metadata.updatedUtcDateTime` instead of (or in addition to) `createdUtcDateTime` for the “is it new?” check, so that leads that were **updated** (e.g. promoted to BOOKED) after `storedTimestamp` are detected. The rest of the workflow (fetch by `updatedSince`, advance stored timestamp by max `updatedUtcDateTime`) already supports that approach.
