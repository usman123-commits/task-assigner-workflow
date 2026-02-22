# Hostfully to Operto Reservation Cleaning Sync

n8n workflow that fetches leads from the Hostfully API with pagination and outputs them as individual items, intended for use in a Hostfully → Operto reservation/cleaning sync.

---

## Overview

| Property | Value |
|----------|--------|
| **Workflow name** | Hostfully to Operto Reservation Cleaning Sync |
| **Trigger** | Manual (“Execute workflow”) |
| **Purpose** | Fetch all leads from Hostfully (with pagination), accumulate them, then output one item per lead for downstream nodes (e.g. Operto sync). |

---

## Flow Summary

```
Manual trigger
    → Initialize Cursor
    → Fetch Hostfully Leads (first page)
    → Accumulate Leads
    → Has More Pages?
        → Yes: loop back to Fetch Hostfully Leads
        → No:  Output Leads Individually (one item per lead)
```

---

## Nodes

### 1. When clicking ‘Execute workflow’

- **Type:** Manual Trigger  
- **Role:** Starts the workflow on demand.

---

### 2. Initialize Cursor

- **Type:** Code  
- **Role:** Sets initial state for pagination and accumulation.
- **Output:** One item with:
  - `cursor`: `null` (no cursor for first request)
  - `accumulatedLeads`: `[]`

This is passed into the first “Fetch Hostfully Leads” call.

---

### 3. Fetch Hostfully Leads

- **Type:** HTTP Request  
- **Role:** Calls Hostfully API v3 to get a page of leads.
- **Details:**
  - **URL:**  
    `https://platform.hostfully.com/api/v3/leads?updatedSince=2026-02-19T01:00:00`  
    Plus `&_cursor=<cursor>` when a cursor exists (from previous accumulation).
  - **Method:** GET (default for this setup).
  - **Query parameters:**
    - `agencyUid`: `35842d2f-b5c1-46fa-a33d-a12756b42ed8`
  - **Headers:**
    - `X-HOSTFULLY-APIKEY`: (Hostfully API key)

Expects a response that includes:

- `leads`: array of lead objects  
- `_paging._nextCursor`: cursor for the next page (or null/absent when no more pages)

---

### 4. Accumulate Leads

- **Type:** Code  
- **Role:** Merges the new page of leads with previously accumulated leads and updates the cursor.
- **Logic:**
  - Reads previous state from **Initialize Cursor** output: `cursor`, `accumulatedLeads`.
  - Reads API response from **Fetch Hostfully Leads**: `leads`, `_paging._nextCursor`.
  - Outputs one item with:
    - `cursor`: `response._paging._nextCursor ?? null`
    - `accumulatedLeads`: `previousData.accumulatedLeads` + `response.leads`

This single item is then used by **Has More Pages?** and, when done, by **Output Leads Individually**.

---

### 5. Has More Pages?1

- **Type:** IF  
- **Role:** Decides whether to fetch another page or finish.
- **Condition:**  
  `$json.cursor` is empty (null/empty string).
  - **True (no more pages):** go to **Output Leads Individually**.
  - **False (more pages):** go back to **Fetch Hostfully Leads** (uses the new `cursor` in the URL).

---

### 6. Output Leads Individually

- **Type:** Split Out  
- **Role:** Turns the accumulated array into one item per lead for the next steps.
- **Configuration:** Split out the field `accumulatedLeads`.

Downstream nodes receive one item per lead (e.g. for mapping to Operto reservations/cleaning tasks).

---

## Configuration

Values you may want to change:

| What | Where | Current (example) |
|------|--------|-------------------|
| **Updated-since date** | Fetch Hostfully Leads → URL | `2026-02-19T01:00:00` |
| **Agency UID** | Fetch Hostfully Leads → Query | `35842d2f-b5c1-46fa-a33d-a12756b42ed8` |
| **Hostfully API key** | Fetch Hostfully Leads → Headers | Stored in header `X-HOSTFULLY-APIKEY` |

**Security:** Prefer storing the API key in n8n credentials (e.g. HTTP Header Auth or a generic credential) and referencing it in the node instead of hardcoding it in the workflow.

---

## Usage

1. In n8n, import or open this workflow.
2. Ensure the Hostfully API key (and optionally agency Uid / `updatedSince`) are set as above or via credentials.
3. Run the workflow with **Execute workflow** (manual trigger).
4. After it finishes, **Output Leads Individually** will have one item per lead; connect further nodes (e.g. Operto, filters, or other logic) to that node’s output.

---

## Notes

- The workflow name refers to “Operto” but this workflow only fetches and normalizes Hostfully leads; any Operto sync or “cleaning” logic would be added in nodes after **Output Leads Individually**.
- Pagination is cursor-based and continues until the API returns no `_nextCursor`.
- If the Hostfully response shape changes (e.g. `leads` or `_paging._nextCursor`), the **Accumulate Leads** and **Fetch Hostfully Leads** nodes may need to be updated.
