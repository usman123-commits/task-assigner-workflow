# Phase 2 – Cleaner Assignment + Calendar Dispatch

## Assumptions

1. **Sheets**
   - Spreadsheet has two tabs: **reservation** and **cleaning_job** (names must match in workflow).
   - **cleaning_job** columns include: `bookingUid`, `propertyUid`, `cleaningDate`, `checkOut`, `guestName`, `adultCount`, `cleaningStatus`, `cleanerId`, `assignedAt`, `calendarEventId`.
   - **reservation** has at least `bookingUid`; optional `propertyName`, `address` for email/calendar text.

2. **Phase 1**
   - Phase 1 (or equivalent) already creates **cleaning_job** rows with `cleaningStatus = "PENDING"` and empty `cleanerId` / `assignedAt` / `calendarEventId`. This workflow does not change Phase 1.

3. **Trigger**
   - Workflow runs on **Manual Trigger** (replace with **Schedule Trigger** in production, e.g. every 5 min).
   - Only rows with `cleaningStatus = "PENDING"` and empty `cleanerId` are processed; **Filter Pending Only** also skips rows that already have `calendarEventId` (no duplicate events).

4. **Mapping**
   - **Assign Cleaner** uses a static object `PROPERTY_TO_CLEANER`: `propertyUid` → `{ cleanerId, email, calendarId }`. You must edit this in the node to match your properties and cleaners.

5. **Calendars**
   - **Admin** calendar: set `REPLACE_ADMIN_CALENDAR_ID` in **Create Admin Calendar Event** (e.g. primary or shared admin calendar ID).
   - **Cleaner** calendar: comes from mapping (`cleanerCalendarId`). Each cleaner has a calendar ID (e.g. `cleaner@group.calendar.google.com`).

6. **Update behavior**
   - All sheet updates use **bookingUid** as the match key (update one row per run). No bulk overwrites.

7. **Errors**
   - If a property has no mapping, **Assign Cleaner** throws; fix by adding the property to `PROPERTY_TO_CLEANER`. For other failures (e.g. Calendar/Gmail), n8n will log; you can add error workflows or retries in the UI.

---

## What to replace before running

| Placeholder | Where | Action |
|------------|--------|--------|
| `REPLACE_WITH_YOUR_SPREADSHEET_ID` | All Google Sheets nodes | Your spreadsheet ID (same as Phase 1 if same file). |
| `REPLACE_GOOGLE_CREDENTIAL_ID` | Google Sheets nodes | Your Google account credential ID (or re-select in n8n). |
| `REPLACE_ADMIN_CALENDAR_ID` | Create Admin Calendar Event | Admin calendar ID. |
| `REPLACE_GOOGLE_CALENDAR_CREDENTIAL_ID` | Google Calendar nodes | Google Calendar OAuth2 credential. |
| `REPLACE_GMAIL_CREDENTIAL_ID` | Send Gmail to Cleaner | Gmail OAuth2 credential. |
| `PROPERTY_TO_CLEANER` object | Assign Cleaner (Code) | Add entries: `'property-uid': { cleanerId, email, calendarId }`. |

---

## Flow summary

1. **Trigger** → **Read Pending Cleaning Jobs** (cleaningStatus = PENDING) → **Filter Pending Only** (cleanerId empty, no calendarEventId).
2. **Split In Batches** (1) → for each job: **Lookup Reservation** → **Ensure One Item** → **Merge Job and Reservation** → **Assign Cleaner** (map propertyUid → cleanerId, set assignedAt, cleaningStatus = ASSIGNED).
3. **Update Job Assigned** (sheet: cleanerId, assignedAt, cleaningStatus).
4. **Calculate Cleaning Time** (11:00 AM + 3 h duration).
5. **Already Has Calendar Event?** → if yes: **Skip** → loop back; if no: **Create Admin Event** → **Create Cleaner Event** → **Prepare Event Id** → **Update Job With Event Id** (sheet: calendarEventId) → **Send Gmail to Cleaner** → loop back.

---

## Optional

- **Schedule Trigger**: Add a Schedule node (e.g. every 5 minutes), connect it to **Read Pending Cleaning Jobs**, and disable or remove the Manual Trigger.
- **propertyName / address**: If **reservation** (or **cleaning_job**) has columns `propertyName` and `address`, they are used in calendar title/description and email; otherwise fallbacks (propertyUid, "Address TBD") are used.
- **Calendar link in email**: The link uses `calendarEventId`. If your Google Calendar API returns `htmlLink`, you can change **Prepare Event Id for Sheet** to also set `calendarEventLink = eventResult.htmlLink` and use that in the Gmail node.
