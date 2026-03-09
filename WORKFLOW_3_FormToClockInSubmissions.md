# Workflow 3 – Form Responses 1 to ClockInSubmissions

**Workflow file:** `Workflow3_FormResponsesToClockInSubmissions.json`  
**n8n workflow name:** Workflow 3 – Form Responses 1 to ClockInSubmissions  
**Purpose:** On each new Google Form response (Clock-In form), normalize and validate the submission, parse location (full URL, short link, or DMS), and append one row to **ClockInSubmissions** with processingStatus=PENDING. Duplicate protection: do not insert if this bookingUid already has an APPROVED row.

---

## 1. Trigger

| Type | Configuration |
|------|---------------|
| **Google Sheets Trigger** | Poll (e.g. every minute). Document = hostfully spreadsheet. Sheet = **Form Responses 1** (or "Raw Form Responses" by gid). Event: **Row Added**. |

**Flow start:** Google Sheets Trigger → Split In Batches → Normalize and Check.

**Multiple submissions:** The trigger may emit multiple new rows in one poll. **Split In Batches** (batch size 1) processes them one-by-one: each submission runs through the pipeline, then the flow loops back from **Reject If Already Approved** to Split In Batches for the next item. This ensures every new form response is processed without dropping any.

---

## 2. Execution flow (node order)

| # | Node name | Type | Role |
|---|-----------|------|------|
| 1 | Google Sheets Trigger | Google Sheets Trigger | On new row(s) in Form Responses 1 |
| 2 | Split In Batches | Split In Batches | Batch size 1; process one submission per loop; loop back from Reject |
| 3 | Normalize and Check | Code | Normalize form keys (spaces); set captureLocation, isShortLink |
| 4 | Is Short Link? | IF | isShortLink true? → Resolve Short Link / false → ParseAndValidate |
| 5 | Resolve Short Link | HTTP Request | GET captureLocation URL (short Maps link) |
| 6 | Parse Short Link Response | Code | Parse lat/lng from response body (q=lat%2Clng or similar); validate Confirm Arrival |
| 7 | ParseAndValidate | Code | Full URL or lat,lng or DMS; validate Confirm Arrival + location; output structured row |
| 8 | Lookup Existing ClockIn | Google Sheets (read) | Lookup **ClockInSubmissions** by bookingUid + processingStatus=APPROVED |
| 9 | Reject If Already Approved | Code | If any row APPROVED → return 1 item with skipInsert: true (loop continues). Else return parsed item with skipInsert: false. |
| 10 | Should Insert? | IF | skipInsert === false? TRUE → Insert Structured Row / FALSE → skip insert (loop continues) |
| 11 | Insert Structured Row | Google Sheets (append) | Append one row to **ClockInSubmissions** with exact column mapping |

**Loop back:** Reject If Already Approved → Split In Batches (so the next batch runs). When Reject returns `skipInsert: true`, only the FALSE branch of Should Insert? is taken (no insert); when `skipInsert: false`, TRUE branch runs and Insert appends the row.

**Branches:**  
- Short link: Split In Batches → Normalize → Is Short Link (true) → Resolve Short Link → Parse Short Link Response → Lookup Existing ClockIn → Reject → (Split In Batches or Should Insert? → Insert).  
- Full URL / lat,lng / DMS: Split In Batches → Normalize → Is Short Link (false) → ParseAndValidate → Lookup Existing ClockIn → Reject → (Split In Batches or Should Insert? → Insert).

---

## 3. Google Sheets usage

| Sheet (tab) | Operation | Key columns / notes |
|-------------|-----------|----------------------|
| **Form Responses 1** (trigger) | Trigger | Row Added. Column names may have spaces (e.g. "Confirm Arrival", "Capture Location", "Booking ID", "Cleaner ID"). |
| **ClockInSubmissions** | Read (lookup) | Filter by bookingUid and processingStatus=APPROVED (duplicate check). |
| **ClockInSubmissions** | Append | bookingUid, cleanerIdFromForm (cleanerId), gpsLat, gpsLng, submissionTimestamp, processingStatus=PENDING, resultMessage, processedAt. |

---

## 4. Form field handling (spaced names)

- **Normalize and Check** uses a `get(name)` helper: first exact key, then key where `k.trim() === name`, so columns with trailing/leading spaces (e.g. "Confirm Arrival", "Capture Location", "Booking ID", "Cleaner ID") are read correctly.
- **Parse Short Link Response** and **ParseAndValidate** use the same form data (from Normalize and Check or direct from trigger) and the same `get()` pattern where needed.

---

## 5. Key logic

### 5.1 Normalize and Check

- Reads form item; normalizes "Capture Location" (with possible space in header).
- Sets `captureLocation` (trimmed string) and `isShortLink` = true if Capture Location matches:  
  `^(https?:\/\/)?(www\.)?(maps\.app\.goo\.gl|goo\.gl\/maps)\/\S+`

### 5.2 Parse Short Link Response (short Maps link branch)

- **Confirm Arrival** must be present and lowercased === 'yes'; else throws "Arrival not confirmed".
- From HTTP response body: extract coords via regex: `q=(-?\d+\.\d+)%2C(-?\d+\.\d+)` or `(-?\d+\.\d+),(-?\d+\.\d+)` or `3d(-?\d+\.\d+)...4d(-?\d+\.\d+)`.
- Output: bookingUid, cleanerId, gpsLat, gpsLng, submissionTimestamp (now ISO), processingStatus=PENDING, resultMessage='', processedAt=''.

### 5.3 ParseAndValidate (full URL / lat,lng / DMS branch)

- **Confirm Arrival** must be 'yes'; else throws "Arrival not confirmed".
- **Capture Location** must be non-empty; else throws "Location link missing".
- **parseLatLngFromString:**  
  - First try: `(-?\d+\.\d+),(-?\d+\.\d+)` → lat, lng.  
  - Else: DMS regex `(\d+)°...(\d+)'...([\d.]+)"?...([NS])\s*(\d+)°...([EW])` → convert to decimal lat/lng.
- Throws "Invalid Google Maps link format..." if no coords found.
- Output: same structure as Parse Short Link Response (bookingUid, cleanerId, gpsLat, gpsLng, submissionTimestamp, processingStatus=PENDING, resultMessage, processedAt).

### 5.4 Reject If Already Approved

- If **Lookup Existing ClockIn** returned any row with processingStatus=APPROVED → return **one item** with `skipInsert: true` (so the batch loop continues; Insert is skipped via Should Insert?).
- Otherwise return the parsed item with `skipInsert: false` (Should Insert? TRUE branch runs and Insert appends the row).
- The node always returns exactly one item so that the flow always loops back to Split In Batches and processes the next submission.

### 5.5 Should Insert?

- **TRUE** when `skipInsert === false` → run Insert Structured Row.
- **FALSE** when `skipInsert === true` (already approved) → no insert; flow has already returned to Split In Batches via Reject.

---

## 6. Insert Structured Row (column mapping)

| ClockInSubmissions column | Expression / source |
|---------------------------|---------------------|
| bookingUid | Parsed bookingUid |
| cleanerIdFromForm | Parsed cleanerId |
| gpsLat | Parsed gpsLat |
| gpsLng | Parsed gpsLng |
| submissionTimestamp | Parsed submissionTimestamp |
| processingStatus | PENDING |
| resultMessage | '' |
| processedAt | '' |

---

## 7. Error / rejection paths

- **Parse Short Link Response / ParseAndValidate:** "Arrival not confirmed" or "Location link missing" or "Could not find coordinates..." / "Invalid Google Maps link format..." → workflow execution fails for that trigger (no row appended).
- **Reject If Already Approved:** If already APPROVED for this bookingUid → 0 items → no insert (silent skip).
- HTTP Request (Resolve Short Link) failure → execution fails for that response.

---

## 8. Dependencies

- **Form Responses 1:** Columns include Booking ID, Cleaner ID, Confirm Arrival, Capture Location (names may have spaces). Trigger sheet must be the one receiving the form submissions.
- **ClockInSubmissions:** Columns bookingUid, cleanerIdFromForm, gpsLat, gpsLng, submissionTimestamp, processingStatus, resultMessage, processedAt. Optional: row_number if added by sheet.
- Google Sheets Trigger credential (separate from main Google Sheets credential if configured).
- For short links: outbound HTTP GET to Maps URLs (no auth).

---

## 9. Known gaps / notes

- One trigger execution can include **multiple new rows** in one poll. **Split In Batches** (batch size 1) plus loop back from Reject ensures each row is processed one-by-one; duplicate check is per bookingUid (no insert if already APPROVED).
- Workflow is **active** by default (`active: true` in JSON).
