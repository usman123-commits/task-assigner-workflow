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
- createdUtcDateTime
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
- cleaningDate = checkOut
- cleaningStartTime = 11:00 AM (fixed window)
- cleaningDuration = 3 hours (configurable)
- cleaningStatus = "PENDING"
- cleanerId = empty
- assignedAt = empty
- calendarEventId = empty
- clockInTime = empty
- clockOutTime = empty

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

- cleaningStatus = "PENDING"
- AND cleanerId is empty

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
- cleaningStatus = "ASSIGNED"

## Step 2.3 – Create Calendar Events (One-Way Sync)

Create two events:

- Master Admin Calendar (your account)
- Cleaner-specific calendar (owned by you, shared as view-only)

**Event title format:**
Cleaning – [Property Name] – [Guest Name]

**Event description:**

- Property
- Full Address
- Guest Count
- Booking Reference ID
- Internal Notes

Start: cleaningStartTime
End: cleaningStartTime + duration

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

- Cleaner ID (pre-filled)
- Booking UID (hidden/pre-filled)
- Start Cleaning button

**System captures:**

- Timestamp
- GPS location (via form or web app)

**Validation:**
Location must be within X meters of property address.

**Store:**

- clockInTime
- clockInLat
- clockInLng

**Update:**
cleaningStatus = "IN_PROGRESS"

## Step 3.2 – Finish Cleaning (Clock Out)

Cleaner submits Finish Form.

**System captures:**

- Timestamp
- GPS

**Store:**

- clockOutTime
- clockOutLat
- clockOutLng

**Update:**
cleaningStatus = "COMPLETED"

Now you have verified job duration.

---

# 💰 PHASE 4 — Payroll Preparation (Structured)

We do NOT directly trust calendar duration.

**We calculate:**
workedHours = clockOutTime – clockInTime

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
