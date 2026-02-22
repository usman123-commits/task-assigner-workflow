# Hostfully to Operto Reservation Cleaning Sync

n8n workflow that fetches leads from the Hostfully API using a stored **last-processed timestamp** (in Google Sheets), accumulates them with pagination, filters to **new bookings only** (by `createdUtcDateTime`), and updates the stored timestamp from the max **updatedUtcDateTime** so the next run only fetches newer leads.

---

## Overview

| Property | Value |
|----------|--------|
| **Workflow name** | Hostfully to Operto Reservation Cleaning Sync |
| **Trigger** | Manual (“Execute workflow”) |
| **Purpose** | Fetch leads updated after last stored timestamp, detect new bookings, output only new bookings for downstream use, and advance the stored timestamp. |

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
            → Filter New Bookings (createdUtcDateTime > storedTimestamp)
            → (downstream: e.g. Operto sync)
        → and → Compute Max Updated Timestamp
            → Update Stored Timestamp (Google Sheets)
        → Yes (more pages): loop back to Fetch Hostfully Leads
```

---

## Google Sheets Setup

Use one sheet to store the last-processed timestamp.

- **Columns:** `key` (e.g. column A), `storedTimestamp` (e.g. column B).
- **Row 1:** Headers: `key`, `storedTimestamp` (or `lastProcessedTimestamp`).
- **Row 2:** `key` = `config`, `storedTimestamp` = ISO date string (e.g. `2026-02-19T00:00:00.000Z`).

**Read Last Timestamp** reads from this sheet (output field used in the workflow: `storedTimestamp`).  
**Update Stored Timestamp** writes the new value back to the same sheet (row where `key` = `config`).

If the sheet is empty or the read returns no rows, the workflow uses `1970-01-01T00:00:00.000Z` so the first run fetches all leads. **Initialize Cursor** normalizes the read value: if the sheet stores a timestamp with a space (e.g. `2026-02-19 00:00:00`), it is converted to ISO format with `T` (e.g. `2026-02-19T00:00:00`) for Hostfully API compatibility.

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
- **Role:** Keeps only **newly created** bookings.
- **Logic:** For each lead, keep it only if `lead.metadata.createdUtcDateTime > storedTimestamp` (uses `storedTimestamp` from **Accumulate Leads** last run).
- **Output:** Only leads that are new bookings; downstream nodes (e.g. Operto) should connect here.

---

### 9. Compute Max Updated Timestamp

- **Type:** Code  
- **Role:** From **all** accumulated leads (not only filtered), compute the maximum `metadata.updatedUtcDateTime` so the next run can use it as `updatedSince`.
- **Input:** The single item from **Has More Pages?** (no more pages) with `accumulatedLeads` and `storedTimestamp`.
- **Output:** One item: `key: 'config'`, `storedTimestamp: maxUpdatedTime` (or previous `storedTimestamp` if no dates found). Does not assume API returns sorted data.

---

### 10. Update Stored Timestamp

- **Type:** Google Sheets (Update)  
- **Role:** Writes the new timestamp back to the sheet (row where `key` = `config`).
- **Configure:** Same document/sheet as **Read Last Timestamp**. Set **Column to match on** to `key` (value to match: `config`). Map columns `key` and `storedTimestamp` from the incoming item.

---

## Configuration

| What | Where |
|------|--------|
| **Google Sheets** | **Read Last Timestamp** and **Update Stored Timestamp**: Document, Sheet, credentials. |
| **Stored timestamp cell** | Sheet layout: `key` + `storedTimestamp` (or `lastProcessedTimestamp`), row with `key` = `config`. |
| **Agency UID** | Fetch Hostfully Leads → Query: `agencyUid`. |
| **Hostfully API key** | Fetch Hostfully Leads → Headers: `X-HOSTFULLY-APIKEY`. Prefer n8n credentials over hardcoding. |

---

## Usage

1. Create the Google Sheet with columns `key` and `storedTimestamp`, and one row `config` + initial timestamp (or leave empty for first run).
2. In n8n, open the workflow and set Google Sheets credentials and document/sheet for **Read Last Timestamp** and **Update Stored Timestamp**.
3. Run with **Execute workflow**.
4. **Filter New Bookings** outputs only new bookings; connect Operto or other logic there.
5. After each run, the sheet’s stored timestamp is updated so the next run only fetches leads updated after that time.

---

## Rules (summary)

- **Timestamp format:** The value read from the sheet is normalized in **Initialize Cursor** (space → `T`) so it is valid for the Hostfully API. No separate Edit/Set node is used.
- **New bookings:** Use `metadata.createdUtcDateTime` and keep only leads with `createdUtcDateTime > storedTimestamp`.
- **Advancing timestamp:** Use `metadata.updatedUtcDateTime`; set stored timestamp to **max** of all accumulated leads’ `updatedUtcDateTime`.
- **No assumption of sorted data:** Max is always computed from the full `accumulatedLeads` list.
- **Pagination:** Unchanged; accumulation and `storedTimestamp` pass-through only.
