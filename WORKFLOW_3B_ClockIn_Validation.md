# Workflow 3B – ClockIn Validation Processor

**Workflow file:** `Workflow3B_ClockIn_Validation_Processor.json`  
**n8n workflow name:** Workflow 3B - ClockIn Validation Processor  
**Purpose:** Periodically read **ClockInSubmissions** with processingStatus=PENDING, validate that the submitting cleaner is assigned to the booking, check GPS distance to property (≤100 m), then set ClockInSubmissions to APPROVED or REJECTED and update **CleaningJobs** (and optionally **Reservations**).

---

## 1. Trigger

| Type | Configuration |
|------|---------------|
| **Schedule Trigger** | Every 1 minute. Can be switched to Google Sheets Trigger on ClockInSubmissions (row updated) if available. |

**Flow start:** Schedule Trigger → Read ClockInSubmissions.

---

## 2. Execution flow (node order)

| # | Node name | Type | Role |
|---|-----------|------|------|
| 1 | Schedule Trigger | Schedule Trigger | Every minute |
| 2 | Read ClockInSubmissions | Google Sheets (read) | Read all rows |
| 3 | Only PENDING | Code | Keep only rows where processingStatus === 'PENDING' |
| 4 | Get Booking | Google Sheets (read) | For each item: lookup **CleaningJobs** by bookingUid |
| 5 | Edit Fields | Set | Exclude field "row_number " from job rows (normalize) |
| 6 | Merge Submission and Job | Code | Combine by index: submission + job |
| 7 | Validate Cleaner Assignment | IF | cleanerId (job) !== cleanerIdFromForm (submission)? TRUE → Reject / FALSE → Pass + Get Property Coordinates |
| 8 | Reject Cleaner Not Assigned | Google Sheets (update) | **ClockInSubmissions**: processingStatus=REJECTED, resultMessage="Cleaner not assigned to this booking", processedAt; match by row_number |
| 9 | Pass TRUE items | Code | Pass through items where cleaner matches (for merge with coords) |
| 10 | Get Property Coordinates | Google Sheets (read) | Lookup **CleanersProfile** by cleanerId (property latitude/longitude) |
| 11 | Refining feilds | Set | Include all fields except "row_number" (from CleanersProfile rows) |
| 12 | Merge Coords with Submission | Code | Combine by index: Pass TRUE items + Refining feilds → submission + job + latitude, longitude |
| 13 | DistanceCalculation | Code | Haversine: distance in meters (submission gpsLat/gpsLng vs property latitude/longitude) |
| 14 | Radius Check | IF | distance ≤ 100? TRUE → Update APPROVED / FALSE → Update REJECTED (radius) |
| 15 | Update APPROVED | Google Sheets (update) | **ClockInSubmissions**: processingStatus=APPROVED, resultMessage="Clock-in successful", processedAt; match by row_number |
| 16 | Update CleaningJobs | Google Sheets (update) | **CleaningJobs** by bookingUid: status=IN_PROGRESS, clockInTimeUTC, gpsClockInLat, gpsClockInLng, gpsStatus=INSIDE_RADIUS |
| 17 | Update REJECTED (radius) | Google Sheets (update) | **ClockInSubmissions**: processingStatus=REJECTED, resultMessage="Cleaner outside allowed 100m radius", processedAt; match by row_number |
| 18 | Update row in sheet | Google Sheets (update) | **Reservations** by bookingUid: cleaningStatus=IN_PROGRESS |

**Branches:**  
- **Validate Cleaner Assignment**  
  - TRUE (cleanerId ≠ cleanerIdFromForm): → Reject Cleaner Not Assigned (stop for that item).  
  - FALSE (match): → Get Property Coordinates + Pass TRUE items → Refining feilds → Merge Coords → Distance → Radius Check.  
- **Radius Check**  
  - TRUE (≤100 m): → Update APPROVED → Update CleaningJobs → Update row in sheet (Reservations).  
  - FALSE (>100 m): → Update REJECTED (radius).

---

## 3. Google Sheets usage

| Sheet (tab) | Operation | Key columns / notes |
|-------------|-----------|----------------------|
| **ClockInSubmissions** | Read | All rows; filtered to PENDING in code. Must have row_number for updates. |
| **ClockInSubmissions** | Update (Reject – not assigned) | Match row_number; set processingStatus=REJECTED, resultMessage, processedAt. |
| **ClockInSubmissions** | Update (APPROVED) | Match row_number; set processingStatus=APPROVED, resultMessage, processedAt. |
| **ClockInSubmissions** | Update (REJECTED radius) | Match row_number; set processingStatus=REJECTED, resultMessage, processedAt. |
| **CleaningJobs** | Read (lookup) | Lookup by bookingUid. |
| **CleaningJobs** | Update | Match bookingUid; set status=IN_PROGRESS, clockInTimeUTC, gpsClockInLat, gpsClockInLng, gpsStatus=INSIDE_RADIUS. |
| **CleanersProfile** | Read (lookup) | Lookup by cleanerId. **Must have latitude and longitude** (property coordinates for distance). |
| **Reservations** | Update | Match bookingUid; set cleaningStatus=IN_PROGRESS. |

---

## 4. Key logic

### 4.1 Validate Cleaner Assignment (IF)

- Condition: `$json.cleanerId` (from **CleaningJobs**) **notEquals** `$json.cleanerIdFromForm` (from ClockInSubmissions).
- **TRUE** → cleaner does not match → **Reject Cleaner Not Assigned** (ClockInSubmissions set to REJECTED, message "Cleaner not assigned to this booking").
- **FALSE** → cleaner matches → continue to Get Property Coordinates and Pass TRUE items.

### 4.2 Get Property Coordinates

- Lookup **CleanersProfile** where cleanerId = submission’s assigned cleanerId.
- **CleanersProfile** must contain **latitude** and **longitude** (property location for 100 m check). Column names must match what **DistanceCalculation** expects (latitude, longitude).

### 4.3 Refining feilds

- Set node: include all fields except "row_number" from Get Property Coordinates output (pass through CleanersProfile row with latitude/longitude).

### 4.4 Merge Coords with Submission

- Combine by index: Pass TRUE items (submission + job) with Refining feilds output (coords) so each item has gpsLat, gpsLng (submission) and latitude, longitude (property).

### 4.5 DistanceCalculation (Haversine)

- R = 6371000 m. Converts deg to rad. For each item: user (gpsLat, gpsLng), property (latitude, longitude). Returns **distance** in meters. Invalid/missing coords → distance = 999999.

### 4.6 Radius Check

- TRUE: distance ≤ 100 → Update APPROVED then Update CleaningJobs then Update row in sheet (Reservations).
- FALSE: distance > 100 → Update REJECTED (radius) only.

### 4.7 Update CleaningJobs (on APPROVED)

- bookingUid from current item.
- status = IN_PROGRESS.
- clockInTimeUTC = submissionTimestamp from DistanceCalculation item.
- gpsClockInLat, gpsClockInLng from submission.
- gpsStatus = INSIDE_RADIUS.

### 4.8 Update row in sheet (Reservations)

- After Update CleaningJobs: **Reservations** row for same bookingUid → cleaningStatus = IN_PROGRESS.

---

## 5. Error / rejection paths

| Condition | Action |
|-----------|--------|
| cleanerId ≠ cleanerIdFromForm | ClockInSubmissions: REJECTED, "Cleaner not assigned to this booking". No CleaningJobs/Reservations update. |
| distance > 100 m | ClockInSubmissions: REJECTED, "Cleaner outside allowed 100m radius". No CleaningJobs/Reservations update. |
| Missing CleanersProfile row or latitude/longitude | DistanceCalculation yields 999999 m → Radius Check FALSE → REJECTED (radius). |
| Get Booking returns no row | Merge by index can misalign; recommend ensuring one CleaningJobs row per PENDING submission. |

---

## 6. Dependencies

- **ClockInSubmissions:** bookingUid, cleanerIdFromForm, gpsLat, gpsLng, submissionTimestamp, processingStatus, resultMessage, processedAt, **row_number** (for update matching).
- **CleaningJobs:** bookingUid, cleanerId, status, clockInTimeUTC, gpsClockInLat, gpsClockInLng, gpsStatus.
- **CleanersProfile:** **cleanerId**, **latitude**, **longitude** (required for distance check). Other columns optional.
- **Reservations:** bookingUid, cleaningStatus.

---

## 7. Known gaps / notes

- **Multiple PENDING rows:** Only PENDING outputs all rows where processingStatus === 'PENDING'. n8n runs Get Booking and downstream nodes once per item; no extra loop is needed. All PENDING submissions in a run are processed.
- **Row matching:** ClockInSubmissions updates use **row_number**. Ensure the sheet returns row_number (e.g. n8n “Include row number” or equivalent) so updates target the correct row.
- **Edit Fields** excludes "row_number " (with space); **Get Booking** returns CleaningJobs rows that may have row_number from the sheet – Edit Fields avoids carrying that into Merge Submission and Job if it would conflict.
- **Merge by index:** Get Booking runs once per PENDING item; order must align with Only PENDING so Merge Submission and Job and Merge Coords with Submission are correct. If Get Booking returns 0 rows for a submission, merge by index can pair wrong job/coords; consider handling “no job” explicitly.
- Workflow is **active** by default (`active: true` in JSON).
