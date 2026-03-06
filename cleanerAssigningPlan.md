# 🧱 PHASE 1 — Booking → Internal Job Creation (Completed)

We do NOT touch cleaners, payroll, maintenance yet.
Google Sheets is now the official system of record.
There are only 5 property UIDs discovered yet:

- `29ce8c43-0368-4934-bce2-e5f7c54d2091`
- `080afa02-ef01-4038-9528-3c10f88a7645`
- `33f964cf-2531-47f8-8133-fd501e9f6814`
- `6301ad7e-6d32-426a-8aef-daa74978f911`
- `2e49d012-dcf1-43ef-8ce3-566f2364352d`

First we define:
What should happen the moment a new confirmed booking is detected?

## Step 1.1 – Booking Trigger (Already Done)

Your workflow correctly detects:

- `type === "BOOKING"`
- `status === "BOOKED"`
- `createdUtcDateTime > storedTimestamp`

This is your ingestion entry point.

**System rule:**
Booking workflow must remain isolated and stable.

## Step 1.2 – Create Internal "Reservation Record"

Instead of external tools, we now:
Create a structured record in Google Sheets (reservation tab).

**Minimum fields stored:**

- bookingUid
- propertyUid
- checkIn
- checkOut
- guestName
- adultCount
- source
- createdUtc
- cleaningStatus = "PENDING"
- maintenanceStatus = "NONE"
- payrollStatus = "NOT_STARTED"

This is the control table.
No cleaner logic here.

## Step 1.3 – Derive Cleaning Job

Immediately after reservation record creation:
Create entry in cleaning_job tab.

**Fields:**

- bookingUid
- propertyUid
- cleaningDate / cleaningTime = checkout datetime from Hostfully (stored for display/tracing)
- checkoutTimeUTC = checkout time in UTC ISO (used for Phase 3 clock-in gating/validations)
- scheduledCleaningTimeUTC = scheduled cleaning start in UTC ISO (currently equals checkoutTimeUTC)
- durationHours = 3 hours (current default used by Phase 2 calendar time window)
- status = "PENDING"
- cleanerId = empty
- assignedAt = empty
- calendarEventId = empty
- clockInTimeUTC = empty (actual clock-in will be written in Phase 3.1)
- clockOutTimeUTC = (NOT IMPLEMENTED YET – will be written in Phase 3.2)

Still internal only.
No calendar.
No email.
No payroll.

---

# 🧹 PHASE 2 — Cleaner Assignment + Calendar Dispatch (New Architecture)

This phase is a separate workflow.
Calendar is visualization only.
Google Sheets remains source of truth.

## Step 2.1 – Detect Unassigned Cleaning Jobs

**Trigger when:**

- status = "PENDING"
- AND cleanerId is empty
- AND calendarEventId is empty
- AND processingFlag is empty (row-level lock)

System polls cleaning_job tab.

## Step 2.2 – Assign Cleaner (Rule-Based)

**Initial logic:**
propertyUid → cleanerId mapping

**Future upgrade options:**

- Weekday logic
- Cleaner workload balancing
- Availability check
- Round-robin

For now: static mapping.

**Update cleaning_job:**

- cleanerId
- assignedAt = current UTC timestamp
- status becomes "ASSIGNED" after calendar + email succeeds (finalize step)
- clockInLink is generated and stored for Phase 3.1

## Step 2.3 – Create Calendar Events (One-Way Sync)

Create two events:

- Master Admin Calendar (your account)
- Cleaner-specific calendar (owned by you, shared as view-only)

**Calendar purpose:** visualization only (not used for clock-in / status).

Start: scheduledCleaningTimeUTC  
End: start + 3 hours

**Event description:** the workflow appends a "Clock-In Link" section containing the Google Form prefilled URL.

**Store:**
calendarEventId (from cleaner calendar)

**Important:**
If calendarEventId exists → DO NOT recreate event.
Calendar is not editable by cleaners.

## Step 2.4 – Send Assignment Email (Gmail Node)

Send via Gmail.

**Subject:**
New Cleaning Assigned – [Property Name]

**Body includes:**

- Property Name
- Full Address
- Date
- Time
- Guest Count
- Booking Reference
- Calendar Event Link
- Clock-In Link (Google Form)

This acts as:

- Operational alert
- Assignment proof
- Legal timestamp record

Optional future upgrade:
Add SMS redundancy.

Now cleaning becomes operational.

---

# 📋 PHASE 3 — Cleaner Interaction Layer (Google Forms + GPS)

We do NOT use calendar for interaction.
We use Google Forms.

## Step 3.1 – Start Cleaning (Clock In)

Cleaner opens Google Form link.

**Form collects:**

- Booking ID (pre-filled)
- Cleaner ID (pre-filled)
- Confirm Arrival (must be "Yes")
- Capture Location (Google Maps link or coordinates captured by the device/form)

**System captures:**

- Form submission timestamp (from the raw response row)
- GPS location from "Capture Location"

**Processing pipeline (current implementation):**

- Workflow 3 listens to new rows in `Form Responses 1`, validates required fields, extracts lat/lng, and appends a normalized row into `ClockInSubmissions` with `processingStatus = PENDING`.
- Workflow 3B polls `ClockInSubmissions` and processes only `PENDING` rows:
  - Validates the cleaner is assigned to the booking (by comparing submission `cleanerId` with the assigned `cleanerId` in `CleaningJobs` for the same `bookingUid`).
  - Validates GPS radius (≤ 100m) using property coordinates (currently expected from `CleanersProfile` as `latitude` / `longitude`).
  - If approved:
    - Updates `ClockInSubmissions.processingStatus = APPROVED`, sets `processedAt`.
    - Updates `CleaningJobs`:
      - `status = IN_PROGRESS`
      - `clockInTimeUTC = submissionTimestamp`
      - `gpsClockInLat`, `gpsClockInLng`
      - `gpsStatus = INSIDE_RADIUS`
  - If rejected: updates `ClockInSubmissions.processingStatus = REJECTED` with a message and does not update `CleaningJobs`.

**Store:**

- clockInTimeUTC (actual)
- gpsClockInLat / gpsClockInLng (actual)

**Update:**
status = "IN_PROGRESS"

## Step 3.2 – Finish Cleaning (Clock Out)

⚠️ Not implemented yet.

We still need a dedicated workflow for clock-out handling (Phase 3.2). This will likely mirror clock-in:

- Accept a clock-out form submission (bookingUid, cleanerId, GPS)
- Validate cleaner assignment
- (Optional) validate radius
- Write `clockOutTimeUTC`, `gpsClockOutLat`, `gpsClockOutLng`
- Update `status = COMPLETED`

Now you have verified job duration.

---

# 💰 PHASE 4 — Payroll Preparation (Structured)

We do NOT directly trust calendar duration.

**We calculate:**
workedHours = clockOutTimeUTC – clockInTimeUTC

**Store:**

- workedHours
- payrollStatus = "READY"

**Options:**

- **Option A:** Export weekly payroll sheet.
- **Option B:** Push to QuickBooks Payroll automatically.

**System rule:**
Payroll only processes jobs with:

- cleaningStatus = COMPLETED
- AND payrollStatus = READY

---

# 🔧 PHASE 5 — Maintenance Reporting (Form-Based)

After clock-out form:

Cleaner sees:
"Report Issue?"

If yes:
Create maintenance_ticket entry.

**Fields:**

- bookingUid
- propertyUid
- issueType
- description
- photoUpload
- priority
- status = "OPEN"

Separate maintenance workflow handles technician assignment.

---

# 📦 PHASE 6 — Supply Tracking

After cleaning completion form:
Cleaner can report supply usage.

**Form collects:**

- Supply type
- Quantity used
- Low stock checkbox

**System:**
Reduces inventory count.

If below threshold:
Create reorder task.

Separate procurement workflow handles purchase.

---

# 🗓 Calendar Architecture Rules

**Calendar is:**
View layer only.

**It does NOT:**

- Control status
- Track payroll
- Trigger automation

Only Sheets can do that.

**Cleaners:**

- View-only access
- Cannot edit events
- Cannot change time

All edits must originate from workflow.
