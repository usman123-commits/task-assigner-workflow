🧱 PHASE 1 — Booking → Internal Job Creation

We do NOT touch cleaners, payroll, maintenance yet.

First we define:

What should happen the moment a new confirmed booking is detected?

Step 1.1 – Booking Trigger (Already Done)

Your workflow correctly detects:

type === "BOOKING"

status === "BOOKED"

createdUtcDateTime > storedTimestamp

Good. That is your system entry point.

Step 1.2 – Create Internal “Reservation Record”

Instead of sending to Operto, we now:

Create a structured internal record.

This could be stored in:

Google Sheets (temporary)

Airtable

Supabase

Or your own DB later

Minimum fields to store:

bookingUid

propertyUid

checkIn

checkOut

guestName

adultCount

source (Airbnb, VRBO, etc.)

createdUtcDateTime

cleaningStatus = "PENDING"

maintenanceStatus = "NONE"

payrollStatus = "NOT_STARTED"

This becomes your internal control table.

We do this before anything else.

Step 1.3 – Derive Cleaning Job

Now we calculate:

Cleaning date = checkOut date

Add logic:

Cleaning scheduled at checkout time

Or fixed cleaning window (ex: 11:00 AM)

Create cleaning task record:

bookingUid

propertyUid

cleaningDate

status = "ASSIGNED"

cleanerId (optional for now)

Still internal only.

No payroll yet.

🧹 PHASE 2 — Cleaner Assignment Layer

Now we improve gradually.

Step 2.1 – Assign Cleaner Automatically

Rules could be:

Based on property

Based on weekday

Based on cleaner availability

Round-robin

For now keep it simple:

Map propertyUid → cleanerId

Store:

cleanerId

assignedAt timestamp

Step 2.2 – Notify Cleaner

Send:

SMS (via GHL)

Email

WhatsApp

Include:

Property

Date

Check-out time

Guest count

Now cleaning becomes operational.

📍 PHASE 3 — Clock In / Clock Out (GPS)

Now we build time tracking.

Cleaner workflow:

Cleaner clicks “Start Cleaning”

System captures:

Timestamp

GPS location

Validate:

Within X meters of property

Store clockInTime

When done:

Click “Finish Cleaning”

Capture:

Timestamp

GPS

Store clockOutTime

Now you have:

Actual hours worked

Verified by GPS

💰 PHASE 4 — Payroll Sync (QuickBooks)

After clockOut:

Calculate:

workedHours = clockOut - clockIn

Then:

Push to QuickBooks Payroll
OR

Export weekly payroll sheet

Now cleaner payment is automated.

🔧 PHASE 5 — Maintenance Automation (Later)

After cleaning:

Cleaner can report:

Broken item

Damage

Missing supply

This creates:

Maintenance ticket:

propertyUid

issue

photos

priority

assigned technician

Separate workflow.

📦 PHASE 6 — Supply Tracking

When cleaner finishes:

They can report:

Paper towels low

Soap low

Trash bags low

System:

Decreases inventory

If below threshold → auto create order task

🧠 High-Level Architecture Flow

New Booking
→ Create Reservation Record
→ Create Cleaning Job
→ Assign Cleaner
→ Notify Cleaner
→ Cleaner Clock In
→ Cleaner Clock Out
→ Sync Payroll
→ Update Reservation Status

Everything modular.