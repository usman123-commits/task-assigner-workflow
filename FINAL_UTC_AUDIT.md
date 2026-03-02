# Final Strict UTC Hardening Pass — Audit Report

**Date:** 2026-02-25  
**Scope:** Workflow 1 (newBookingFinder.json), Workflow 2 (phase2CleanerAssignmentCalendar.json), Workflow 3 (Phase3_ClockIn_Workflow.json)

---

## Result: **System is fully strict UTC compliant. No changes required.**

---

## Rule-by-rule confirmation

### RULE 1 — Single source of truth

| Check | Status |
|-------|--------|
| Only allowed time input from Hostfully: `checkOutZonedDateTime` | **PASS** — W1 Prepare Cleaning Job Data uses only `j?.checkOutZonedDateTime` |
| No `checkOutUtc` | **PASS** — Not referenced |
| No `checkOutLocalDateTime` for logic | **PASS** — Only used in W1 Create Reservation Record for Reservations sheet display; not used for CleaningJobs time logic |
| No `checkOut` for logic | **PASS** — Not used for checkoutTimeUTC/scheduledCleaningTimeUTC |
| No `cleaningDate` for logic | **PASS** — W1 writes it for compatibility only; W2 Calculate Cleaning Time does not use it |
| No `cleaningTime` for logic | **PASS** — Same as above |

---

### RULE 2 — Zoned validation (Workflow 1)

| Check | Status |
|-------|--------|
| `ZONED_REGEX = /[zZ]|[+-]\d{2}:\d{2}$/` enforced | **PASS** — Present in Prepare Cleaning Job Data |
| Reject if missing | **PASS** — `if (!rawCheckout \|\| ... trim() === '') throw ...` |
| Reject if empty string | **PASS** — Covered by above |
| Reject if no timezone offset or Z | **PASS** — `if (!ZONED_REGEX.test(s)) throw ...` |
| Parse only after validation | **PASS** — `new Date(s)` after regex and empty check |
| `checkoutTimeUTC = new Date(s).toISOString()` | **PASS** — Implemented |
| `scheduledCleaningTimeUTC = checkoutTimeUTC` (identical) | **PASS** — Direct assignment |
| No 11:00 construction | **PASS** — None |
| No Date.UTC | **PASS** — None |
| No manual hour setting | **PASS** — None |

---

### RULE 3 — No local hour math anywhere

| Forbidden | Status |
|-----------|--------|
| setHours() | **PASS** — Not used |
| getHours() | **PASS** — Not used |
| toLocaleString() | **PASS** — Not used |
| substring time manipulation | **PASS** — Not used |
| regex time replacement (e.g. 11:00) | **PASS** — Not used |
| manual date splitting/reconstruction | **PASS** — Not used |

| Allowed | Status |
|---------|--------|
| new Date(utcString) | **PASS** — Used in W1, W2, W3 |
| getTime() | **PASS** — W2 endDate calculation |
| setUTCHours() / getUTCHours() | **PASS** — W3 Late Check only |
| toISOString() | **PASS** — Used throughout |

---

### RULE 4 — Workflow 2 strict behavior

| Check | Status |
|-------|--------|
| Calculate Cleaning Time uses ONLY `item.scheduledCleaningTimeUTC` | **PASS** — No fallback |
| `endDate = new Date(startDate.getTime() + 3h in ms)` | **PASS** — `new Date(startDate.getTime() + DURATION_HOURS * 3600 * 1000)` |
| No fallback to cleaningDate, checkOut, checkoutTimeUTC, other | **PASS** — None |

---

### RULE 5 — Workflow 3 strict behavior

| Check | Status |
|-------|--------|
| Validations use only checkoutTimeUTC / scheduledCleaningTimeUTC | **PASS** — Only checkoutTimeUTC for gate; no cleaningDate/cleaningTime |
| Late Check: `deadline = new Date(scheduledCleaningTimeUTC)` | **PASS** — Implemented |
| Late Check: `deadline.setUTCHours(deadline.getUTCHours() + 1)` | **PASS** — Implemented |
| Clock-in: `serverTime = new Date()`, `clockInTimeUTC = serverTime.toISOString()` | **PASS** — Implemented |
| No local time logic | **PASS** — None |
| No cleaningDate / cleaningTime | **PASS** — Not used |

---

### RULE 6 — Defensive parsing

| Location | Status |
|----------|--------|
| W1 Prepare Cleaning Job Data | **PASS** — `if (isNaN(checkoutDate.getTime())) throw new Error(...)` |
| W2 Calculate Cleaning Time | **PASS** — `if (isNaN(startDate.getTime())) throw new Error(...)` |
| W3 Validations | **PASS** — `if (checkoutTime == null \|\| isNaN(checkoutTime.getTime()))` return 400 |
| W3 Late Check | **PASS** — `!isNaN(deadline.getTime())` before using deadline |

---

### RULE 7 — Sheet write protection

| Check | Status |
|-------|--------|
| checkoutTimeUTC always written (W1 Create Cleaning Job Record) | **PASS** — In columns mapping |
| scheduledCleaningTimeUTC always written (W1 Create Cleaning Job Record) | **PASS** — In columns mapping |
| Never overwritten later | **PASS** — W2 updates do not touch these; W3 Update Cleaning Job Row writes only clockInTimeUTC, gps*, lateFlag, status |
| No node recalculates them | **PASS** — Only W1 Prepare Cleaning Job Data produces them; no other node recalculates |

---

## Explicit confirmations

- **scheduledCleaningTimeUTC === checkoutTimeUTC**  
  Yes. In W1 Prepare Cleaning Job Data: `const scheduledCleaningTimeUTC = checkoutTimeUTC;` (same reference).

- **No local-time math exists**  
  Yes. Only UTC methods used (getTime, setUTCHours, getUTCHours, toISOString). No setHours/getHours/toLocaleString.

- **No fallback time fields exist**  
  Yes. W1 uses only checkOutZonedDateTime; W2 uses only scheduledCleaningTimeUTC; W3 uses only checkoutTimeUTC and scheduledCleaningTimeUTC for validation and late logic.

- **System is fully deterministic UTC**  
  Yes. Single source (checkOutZonedDateTime), zoned validation, identical checkout/scheduled times, UTC-only comparisons and writes.

---

## Nodes audited (no changes made)

| Workflow | Node | Role |
|----------|------|------|
| W1 | Prepare Cleaning Job Data | Single source checkOutZonedDateTime; ZONED_REGEX; checkoutTimeUTC/scheduledCleaningTimeUTC identical |
| W1 | Create Cleaning Job Record | Writes checkoutTimeUTC, scheduledCleaningTimeUTC (and compatibility fields only) |
| W2 | Calculate Cleaning Time | Only scheduledCleaningTimeUTC; endTime via getTime() + 3h ms |
| W3 | Check Lookup and Merge | Requires checkoutTimeUTC, scheduledCleaningTimeUTC in required columns |
| W3 | Validations | Only checkoutTimeUTC; new Date(); isNaN check |
| W3 | Late Check | Only scheduledCleaningTimeUTC; setUTCHours(getUTCHours()+1); serverTime.toISOString() |
| W3 | Update Cleaning Job Row | Does not write checkoutTimeUTC or scheduledCleaningTimeUTC |

---

**End of audit.**
