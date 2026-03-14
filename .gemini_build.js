const fs = require('fs');
const path = require('path');

const wf1Path = path.join(__dirname, 'newBookingFinder.json');
const wf2Path = path.join(__dirname, 'cancellationHandler.json');

// --- PART 1 ---
const wf1 = JSON.parse(fs.readFileSync(wf1Path, 'utf8'));

const part1Nodes = [
  {
    "parameters": {
      "jsCode": "const leads = $('Accumulate Leads').last().json?.accumulatedLeads ?? [];\nconst candidates = leads.filter(l =>\n  l.type === 'BOOKING' &&\n  l.status === 'CANCELLED'\n);\nreturn candidates.map(c => ({ json: c }));"
    },
    "id": "node_detect_cancellations",
    "name": "Detect Cancellations",
    "type": "n8n-nodes-base.code",
    "typeVersion": 2,
    "position": [1568, 1060]
  },
  {
    "parameters": {
      "operation": "lookup",
      "documentId": {
        "__rl": true,
        "value": "12q_ZZJEkE6xQGJH0XxwCFlt821lpEBgCjLkfm0GmX-g",
        "mode": "id"
      },
      "sheetName": {
        "__rl": true,
        "value": "Reservations",
        "mode": "id"
      },
      "filtersUI": {
        "values": [
          {
            "lookupColumn": "bookingUid",
            "lookupValue": "={{ $json.bookingUid }}"
          }
        ]
      },
      "options": {}
    },
    "id": "node_lookup_reservation",
    "name": "Lookup Reservation for Cancellation",
    "type": "n8n-nodes-base.googleSheets",
    "typeVersion": 4,
    "position": [1792, 1060],
    "alwaysOutputData": true,
    "credentials": {
      "googleSheetsOAuth2Api": {
        "id": "q52dbWoN6OaKRDZO",
        "name": "Google Sheets account"
      }
    }
  },
  {
    "parameters": {
      "jsCode": "const candidate = $('Detect Cancellations').item.json;\nconst lookup = $input.first()?.json ?? {};\nconst bookingUid = (candidate.bookingUid ?? '').toString().trim();\n// Skip if no reservation row found\nif (!lookup.bookingUid) return [];\n// Skip if already cancelled\nconst status = (lookup.cleaningStatus ?? '').toString().trim().toUpperCase();\nif (status === 'CANCELLED') return [];\nreturn [{ json: candidate }];"
    },
    "id": "node_cancellation_guard",
    "name": "Cancellation Idempotency Guard",
    "type": "n8n-nodes-base.code",
    "typeVersion": 2,
    "position": [2016, 1060]
  },
  {
    "parameters": {
      "method": "POST",
      "url": "YOUR_N8N_WEBHOOK_BASE_URL/webhook/cancellation-handler",
      "sendBody": true,
      "specifyBody": "keypair",
      "bodyParameters": {
        "parameters": [
          {
            "name": "bookingUid",
            "value": "={{ $json.bookingUid }}"
          },
          {
            "name": "propertyUid",
            "value": "={{ $json.propertyUid }}"
          }
        ]
      },
      "options": {}
    },
    "id": "node_trigger_cancellation",
    "name": "Trigger Cancellation Handler",
    "type": "n8n-nodes-base.httpRequest",
    "typeVersion": 4,
    "position": [2240, 1060]
  }
];

wf1.nodes.push(...part1Nodes);

const filtConn = wf1.connections["Filter New Bookings"];
if (!filtConn) {
  wf1.connections["Filter New Bookings"] = { main: [[{"node": "Detect Cancellations", "type": "main", "index": 0}]] };
} else {
  let targetIdx = 0;
  for (let i = 0; i < filtConn.main.length; i++) {
    if (filtConn.main[i] && filtConn.main[i].find(c => c.node === "Detect Extended Checkouts")) {
      targetIdx = i;
      break;
    }
  }
  if (!filtConn.main[targetIdx]) filtConn.main[targetIdx] = [];
  filtConn.main[targetIdx].push({
    "node": "Detect Cancellations",
    "type": "main",
    "index": 0
  });
}

wf1.connections["Detect Cancellations"] = {
  main: [[{"node": "Lookup Reservation for Cancellation", "type": "main", "index": 0}]]
};
wf1.connections["Lookup Reservation for Cancellation"] = {
  main: [[{"node": "Cancellation Idempotency Guard", "type": "main", "index": 0}]]
};
wf1.connections["Cancellation Idempotency Guard"] = {
  main: [[{"node": "Trigger Cancellation Handler", "type": "main", "index": 0}]]
};

fs.writeFileSync(wf1Path, JSON.stringify(wf1, null, 2));


// --- PART 2 ---
const nodes2 = [
  {
    "parameters": {
      "path": "cancellation-handler",
      "httpMethod": "POST",
      "responseMode": "onReceived",
      "options": {}
    },
    "name": "Receive Cancellation Payload",
    "type": "n8n-nodes-base.webhook",
    "typeVersion": 1,
    "position": [0, 0]
  },
  {
    "parameters": {
      "operation": "lookup",
      "documentId": { "__rl": true, "value": "12q_ZZJEkE6xQGJH0XxwCFlt821lpEBgCjLkfm0GmX-g", "mode": "id" },
      "sheetName": { "__rl": true, "value": "CleaningJobs", "mode": "id" },
      "filtersUI": {
        "values": [
          { "lookupColumn": "bookingUid", "lookupValue": "={{ $json.body.bookingUid }}" }
        ]
      },
      "options": {}
    },
    "name": "Lookup Cleaning Job",
    "type": "n8n-nodes-base.googleSheets",
    "typeVersion": 4,
    "position": [200, 0],
    "alwaysOutputData": true,
    "credentials": { "googleSheetsOAuth2Api": { "id": "q52dbWoN6OaKRDZO", "name": "Google Sheets account" } }
  },
  {
    "parameters": {
      "jsCode": "const body = $('Receive Cancellation Payload').item.json.body || {};\nconst items = $input.all();\nconst first = items[0]?.json || {};\nconst hasJob = items.length > 0 && !!(first.bookingUid ?? '').toString().trim();\nreturn [{ json: { ...body, ...(hasJob ? first : {}), _jobFound: hasJob } }];"
    },
    "name": "Prepare Cancellation Context",
    "type": "n8n-nodes-base.code",
    "typeVersion": 2,
    "position": [400, 0]
  },
  {
    "parameters": {
      "conditions": {
        "boolean": [ { "value1": "={{ $json._jobFound }}", "value2": true } ]
      }
    },
    "name": "Job Found?",
    "type": "n8n-nodes-base.if",
    "typeVersion": 1,
    "position": [600, 0]
  },
  {
    "parameters": {
      "dataType": "string",
      "value1": "={{ $json.status }}",
      "rules": {
        "rules": [
          { "operation": "equal", "value2": "PENDING", "outputKey": "PENDING" },
          { "operation": "equal", "value2": "ASSIGNED", "outputKey": "ASSIGNED" }
        ]
      },
      "fallbackOutput": "extra"
    },
    "name": "Route by Job Status",
    "type": "n8n-nodes-base.switch",
    "typeVersion": 1,
    "position": [800, -200]
  },
  {
    "parameters": {
      "operation": "update",
      "documentId": { "__rl": true, "value": "12q_ZZJEkE6xQGJH0XxwCFlt821lpEBgCjLkfm0GmX-g", "mode": "id" },
      "sheetName": { "__rl": true, "value": "CleaningJobs", "mode": "id" },
      "columns": { "mappingMode": "defineBelow", "value": { "status": "CANCELLED" }, "matchingColumns": ["bookingUid"] },
      "options": {}
    },
    "name": "Update CleaningJob CANCELLED PENDING",
    "type": "n8n-nodes-base.googleSheets",
    "typeVersion": 4,
    "position": [1100, -400],
    "credentials": { "googleSheetsOAuth2Api": { "id": "q52dbWoN6OaKRDZO", "name": "Google Sheets account" } }
  },
  {
    "parameters": {
      "operation": "update",
      "documentId": { "__rl": true, "value": "12q_ZZJEkE6xQGJH0XxwCFlt821lpEBgCjLkfm0GmX-g", "mode": "id" },
      "sheetName": { "__rl": true, "value": "Reservations", "mode": "id" },
      "columns": { "mappingMode": "defineBelow", "value": { "cleaningStatus": "CANCELLED" }, "matchingColumns": ["bookingUid"] },
      "options": {}
    },
    "name": "Update Reservation CANCELLED PENDING",
    "type": "n8n-nodes-base.googleSheets",
    "typeVersion": 4,
    "position": [1300, -400],
    "credentials": { "googleSheetsOAuth2Api": { "id": "q52dbWoN6OaKRDZO", "name": "Google Sheets account" } }
  },
  {
    "parameters": {
      "jsCode": "const body = $('Receive Cancellation Payload').item.json.body || {};\nconst job = $('Lookup Cleaning Job').item.json || {};\nconst cancellationId = (body.bookingUid || '') + '_CANCEL_' + Date.now();\nreturn [{ json: {\n  cancellationId,\n  bookingUid:             body.bookingUid  || '',\n  propertyUid:            body.propertyUid || '',\n  jobStatusAtCancellation: job.status      || '',\n  cleanerId:              job.cleanerId    || '',\n  calendarEventId:        job.calendarEventId || '',\n  cancelledAtUTC:         new Date().toISOString(),\n  cleanerNotified:        'false'\n} }];"
    },
    "name": "Prepare Log Row PENDING",
    "type": "n8n-nodes-base.code",
    "typeVersion": 2,
    "position": [1500, -400]
  },
  {
    "parameters": {
      "operation": "append",
      "documentId": { "__rl": true, "value": "12q_ZZJEkE6xQGJH0XxwCFlt821lpEBgCjLkfm0GmX-g", "mode": "id" },
      "sheetName": { "__rl": true, "value": "CancelledBookings", "mode": "id" },
      "columns": { "mappingMode": "autoMapInputData" },
      "options": {}
    },
    "name": "Log to CancelledBookings PENDING",
    "type": "n8n-nodes-base.googleSheets",
    "typeVersion": 4,
    "position": [1700, -400],
    "credentials": { "googleSheetsOAuth2Api": { "id": "q52dbWoN6OaKRDZO", "name": "Google Sheets account" } }
  },
  {
    "parameters": {
      "operation": "update",
      "documentId": { "__rl": true, "value": "12q_ZZJEkE6xQGJH0XxwCFlt821lpEBgCjLkfm0GmX-g", "mode": "id" },
      "sheetName": { "__rl": true, "value": "CleaningJobs", "mode": "id" },
      "columns": {
        "mappingMode": "defineBelow",
        "value": { "status": "CANCELLED", "calendarStatus": "CANCELLED", "calendarEventId": "", "adminCalendarEventId": "" },
        "matchingColumns": ["bookingUid"]
      },
      "options": {}
    },
    "name": "Update CleaningJob CANCELLED ASSIGNED",
    "type": "n8n-nodes-base.googleSheets",
    "typeVersion": 4,
    "position": [1100, -200],
    "credentials": { "googleSheetsOAuth2Api": { "id": "q52dbWoN6OaKRDZO", "name": "Google Sheets account" } }
  },
  {
    "parameters": {
      "operation": "update",
      "documentId": { "__rl": true, "value": "12q_ZZJEkE6xQGJH0XxwCFlt821lpEBgCjLkfm0GmX-g", "mode": "id" },
      "sheetName": { "__rl": true, "value": "Reservations", "mode": "id" },
      "columns": { "mappingMode": "defineBelow", "value": { "cleaningStatus": "CANCELLED" }, "matchingColumns": ["bookingUid"] },
      "options": {}
    },
    "name": "Update Reservation CANCELLED ASSIGNED",
    "type": "n8n-nodes-base.googleSheets",
    "typeVersion": 4,
    "position": [1300, -200],
    "credentials": { "googleSheetsOAuth2Api": { "id": "q52dbWoN6OaKRDZO", "name": "Google Sheets account" } }
  },
  {
    "parameters": {
      "operation": "update",
      "calendar": { "__rl": true, "value": "usman2acountf@gmail.com", "mode": "id" },
      "eventId": "={{ $('Lookup Cleaning Job').item.json.adminCalendarEventId }}",
      "updateFields": { "summary": "CANCELLED – {{ $('Lookup Cleaning Job').item.json.propertyUid }}" }
    },
    "name": "Update Admin Calendar Event",
    "type": "n8n-nodes-base.googleCalendar",
    "typeVersion": 1,
    "position": [1500, -200],
    "credentials": { "googleCalendarOAuth2Api": { "id": "zieubUQMxpWLThGP", "name": "Google Calendar account" } }
  },
  {
    "parameters": {
      "operation": "update",
      "calendar": { "__rl": true, "value": "={{ $('Lookup Cleaning Job').item.json.calendarId }}", "mode": "id" },
      "eventId": "={{ $('Lookup Cleaning Job').item.json.calendarEventId }}",
      "updateFields": { "summary": "CANCELLED – {{ $('Lookup Cleaning Job').item.json.propertyUid }}" }
    },
    "name": "Update Cleaner Calendar Event",
    "type": "n8n-nodes-base.googleCalendar",
    "typeVersion": 1,
    "position": [1700, -200],
    "credentials": { "googleCalendarOAuth2Api": { "id": "zieubUQMxpWLThGP", "name": "Google Calendar account" } }
  },
  {
    "parameters": {
      "operation": "lookup",
      "documentId": { "__rl": true, "value": "12q_ZZJEkE6xQGJH0XxwCFlt821lpEBgCjLkfm0GmX-g", "mode": "id" },
      "sheetName": { "__rl": true, "value": "CleanersProfile", "mode": "id" },
      "filtersUI": {
        "values": [ { "lookupColumn": "cleanerId", "lookupValue": "={{ $('Lookup Cleaning Job').item.json.cleanerId }}" } ]
      },
      "options": {}
    },
    "name": "Lookup Cleaner Email",
    "type": "n8n-nodes-base.googleSheets",
    "typeVersion": 4,
    "position": [1900, -200],
    "alwaysOutputData": true,
    "credentials": { "googleSheetsOAuth2Api": { "id": "q52dbWoN6OaKRDZO", "name": "Google Sheets account" } }
  },
  {
    "parameters": {
      "operation": "lookup",
      "documentId": { "__rl": true, "value": "12q_ZZJEkE6xQGJH0XxwCFlt821lpEBgCjLkfm0GmX-g", "mode": "id" },
      "sheetName": { "__rl": true, "value": "Properties", "mode": "id" },
      "filtersUI": {
        "values": [ { "lookupColumn": "propertyUid", "lookupValue": "={{ $('Receive Cancellation Payload').item.json.body.propertyUid }}" } ]
      },
      "options": {}
    },
    "name": "Lookup Property Name",
    "type": "n8n-nodes-base.googleSheets",
    "typeVersion": 4,
    "position": [2100, -200],
    "alwaysOutputData": true,
    "credentials": { "googleSheetsOAuth2Api": { "id": "q52dbWoN6OaKRDZO", "name": "Google Sheets account" } }
  },
  {
    "parameters": {
      "jsCode": "const body = $('Receive Cancellation Payload').item.json.body || {};\nconst job = $('Lookup Cleaning Job').item.json || {};\nconst profile = $('Lookup Cleaner Email').item.json || {};\nconst prop = $('Lookup Property Name').item.json || {};\nconst cleanerEmail = (profile['email'] || profile['cleanerEmail'] || '').toString().trim();\nconst propertyName = (prop.propertyName || body.propertyUid || '').toString().trim();\nconst subject = 'Booking Cancelled – ' + propertyName;\nconst bodyText = `Hi,\\n\\nPlease note that the following booking has been cancelled by the guest.\\n\\nProperty: ${propertyName}\\nBooking Reference: ${body.bookingUid || ''}\\n\\nYour calendar event for this cleaning has been marked as cancelled. No action is required on your part.\\n\\nContact your manager if you have any questions.`;\nreturn [{ json: { toEmail: cleanerEmail, subject, body: bodyText } }];"
    },
    "name": "Prepare Cancellation Email",
    "type": "n8n-nodes-base.code",
    "typeVersion": 2,
    "position": [2300, -200]
  },
  {
    "parameters": {
      "sendTo": "={{ $json.toEmail }}",
      "subject": "={{ $json.subject }}",
      "message": "={{ $json.body }}",
      "emailType": "text"
    },
    "name": "Send Cancellation Email",
    "type": "n8n-nodes-base.gmail",
    "typeVersion": 2,
    "position": [2500, -200],
    "credentials": { "gmailOAuth2": { "id": "6sr232YN6z3c4tiW", "name": "Gmail account" } }
  },
  {
    "parameters": {
      "jsCode": "const body = $('Receive Cancellation Payload').item.json.body || {};\nconst job = $('Lookup Cleaning Job').item.json || {};\nconst cancellationId = (body.bookingUid || '') + '_CANCEL_' + Date.now();\nreturn [{ json: {\n  cancellationId,\n  bookingUid:             body.bookingUid  || '',\n  propertyUid:            body.propertyUid || '',\n  jobStatusAtCancellation: job.status      || '',\n  cleanerId:              job.cleanerId    || '',\n  calendarEventId:        job.calendarEventId || '',\n  cancelledAtUTC:         new Date().toISOString(),\n  cleanerNotified:        'true'\n} }];"
    },
    "name": "Prepare Log Row ASSIGNED",
    "type": "n8n-nodes-base.code",
    "typeVersion": 2,
    "position": [2700, -200]
  },
  {
    "parameters": {
      "operation": "append",
      "documentId": { "__rl": true, "value": "12q_ZZJEkE6xQGJH0XxwCFlt821lpEBgCjLkfm0GmX-g", "mode": "id" },
      "sheetName": { "__rl": true, "value": "CancelledBookings", "mode": "id" },
      "columns": { "mappingMode": "autoMapInputData" },
      "options": {}
    },
    "name": "Log to CancelledBookings ASSIGNED",
    "type": "n8n-nodes-base.googleSheets",
    "typeVersion": 4,
    "position": [2900, -200],
    "credentials": { "googleSheetsOAuth2Api": { "id": "q52dbWoN6OaKRDZO", "name": "Google Sheets account" } }
  },
  {
    "parameters": {
      "operation": "update",
      "documentId": { "__rl": true, "value": "12q_ZZJEkE6xQGJH0XxwCFlt821lpEBgCjLkfm0GmX-g", "mode": "id" },
      "sheetName": { "__rl": true, "value": "Reservations", "mode": "id" },
      "columns": { "mappingMode": "defineBelow", "value": { "cleaningStatus": "CANCELLED" }, "matchingColumns": ["bookingUid"] },
      "options": {}
    },
    "name": "Update Reservation Only",
    "type": "n8n-nodes-base.googleSheets",
    "typeVersion": 4,
    "position": [800, 200],
    "credentials": { "googleSheetsOAuth2Api": { "id": "q52dbWoN6OaKRDZO", "name": "Google Sheets account" } }
  },
  {
    "parameters": {
      "jsCode": "const body = $('Receive Cancellation Payload').item.json.body || {};\nconst cancellationId = (body.bookingUid || '') + '_CANCEL_' + Date.now();\nreturn [{ json: {\n  cancellationId,\n  bookingUid:             body.bookingUid  || '',\n  propertyUid:            body.propertyUid || '',\n  jobStatusAtCancellation: 'NO_JOB',\n  cleanerId:              '',\n  calendarEventId:        '',\n  cancelledAtUTC:         new Date().toISOString(),\n  cleanerNotified:        'false'\n} }];"
    },
    "name": "Prepare Log Row NO JOB",
    "type": "n8n-nodes-base.code",
    "typeVersion": 2,
    "position": [1000, 200]
  },
  {
    "parameters": {
      "operation": "append",
      "documentId": { "__rl": true, "value": "12q_ZZJEkE6xQGJH0XxwCFlt821lpEBgCjLkfm0GmX-g", "mode": "id" },
      "sheetName": { "__rl": true, "value": "CancelledBookings", "mode": "id" },
      "columns": { "mappingMode": "autoMapInputData" },
      "options": {}
    },
    "name": "Log to CancelledBookings NO JOB",
    "type": "n8n-nodes-base.googleSheets",
    "typeVersion": 4,
    "position": [1200, 200],
    "credentials": { "googleSheetsOAuth2Api": { "id": "q52dbWoN6OaKRDZO", "name": "Google Sheets account" } }
  },
  {
    "parameters": {},
    "name": "NoOp",
    "type": "n8n-nodes-base.noOp",
    "typeVersion": 1,
    "position": [1100, 0]
  }
];

nodes2.forEach((n, i) => n.id = `handler_node_${i + 1}`);

const connections2 = {
  "Receive Cancellation Payload": { main: [[{"node": "Lookup Cleaning Job", "type": "main", "index": 0}]] },
  "Lookup Cleaning Job": { main: [[{"node": "Prepare Cancellation Context", "type": "main", "index": 0}]] },
  "Prepare Cancellation Context": { main: [[{"node": "Job Found?", "type": "main", "index": 0}]] },
  "Job Found?": { main: [
    [{"node": "Route by Job Status", "type": "main", "index": 0}],
    [{"node": "Update Reservation Only", "type": "main", "index": 0}]
  ]},
  "Route by Job Status": { main: [
    [{"node": "Update CleaningJob CANCELLED PENDING", "type": "main", "index": 0}],
    [{"node": "Update CleaningJob CANCELLED ASSIGNED", "type": "main", "index": 0}],
    [{"node": "NoOp", "type": "main", "index": 0}],
    []
  ]},
  "Update Reservation Only": { main: [[{"node": "Prepare Log Row NO JOB", "type": "main", "index": 0}]] },
  "Prepare Log Row NO JOB": { main: [[{"node": "Log to CancelledBookings NO JOB", "type": "main", "index": 0}]] },
  "Update CleaningJob CANCELLED PENDING": { main: [[{"node": "Update Reservation CANCELLED PENDING", "type": "main", "index": 0}]] },
  "Update Reservation CANCELLED PENDING": { main: [[{"node": "Prepare Log Row PENDING", "type": "main", "index": 0}]] },
  "Prepare Log Row PENDING": { main: [[{"node": "Log to CancelledBookings PENDING", "type": "main", "index": 0}]] },
  "Update CleaningJob CANCELLED ASSIGNED": { main: [[{"node": "Update Reservation CANCELLED ASSIGNED", "type": "main", "index": 0}]] },
  "Update Reservation CANCELLED ASSIGNED": { main: [[{"node": "Update Admin Calendar Event", "type": "main", "index": 0}]] },
  "Update Admin Calendar Event": { main: [[{"node": "Update Cleaner Calendar Event", "type": "main", "index": 0}]] },
  "Update Cleaner Calendar Event": { main: [[{"node": "Lookup Cleaner Email", "type": "main", "index": 0}]] },
  "Lookup Cleaner Email": { main: [[{"node": "Lookup Property Name", "type": "main", "index": 0}]] },
  "Lookup Property Name": { main: [[{"node": "Prepare Cancellation Email", "type": "main", "index": 0}]] },
  "Prepare Cancellation Email": { main: [[{"node": "Send Cancellation Email", "type": "main", "index": 0}]] },
  "Send Cancellation Email": { main: [[{"node": "Prepare Log Row ASSIGNED", "type": "main", "index": 0}]] },
  "Prepare Log Row ASSIGNED": { main: [[{"node": "Log to CancelledBookings ASSIGNED", "type": "main", "index": 0}]] }
};

const wf2 = {
  name: "cancellationHandler",
  nodes: nodes2,
  connections: connections2,
  settings: {
    executionOrder: "v1"
  },
  active: false,
  versionId: "1",
  triggerCount: 1,
  id: "wf_cancellation_handler",
  tags: []
};

fs.writeFileSync(wf2Path, JSON.stringify(wf2, null, 2));

console.log("SUCCESS");
