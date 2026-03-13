Reject If Already Approved — Bug Report

The Problem
When 3 form submissions were processed in sequence:

Submission 1: short Google Maps link (wrong location)
Submission 2: short Google Maps link (wrong location)
Submission 3: lat/lng coordinates (correct location)

Submission 3's row in ClockInSubmissions was identical to submission 2 — same timestamp, same coordinates. Submission 3's actual data was never written.

Why It Happened
The original code reached back to parse nodes by name to get the parsed submission:
javascripttry { parsed = $('Parse Short Link Response').first().json; } catch (_) {}
if (!parsed) try { parsed = $('ParseAndValidate').first().json; } catch (_) {}
In n8n, .first() on a previous node returns that node's last known output from any execution — it is not branch-aware. So when submission 3 ran through the ParseAndValidate path, $('Parse Short Link Response').first() still succeeded and returned submission 2's cached data. The fallback to ParseAndValidate never triggered because the first try block didn't throw — it just returned stale data silently.

The Fix
Instead of relying on branch fallback, both parse nodes are read simultaneously and the correct one is selected by comparing submissionTimestamp:
javascriptconst existing = $input.all();
let parsed;
let parsedFromShortLink;
let parsedFromDirect;
try { parsedFromShortLink = $('Parse Short Link Response').first().json; } catch (_) {}
try { parsedFromDirect = $('ParseAndValidate').first().json; } catch (_) {}

if (parsedFromShortLink && parsedFromDirect) {
  const tsA = new Date(parsedFromShortLink.submissionTimestamp || 0).getTime();
  const tsB = new Date(parsedFromDirect.submissionTimestamp || 0).getTime();
  parsed = tsA >= tsB ? parsedFromShortLink : parsedFromDirect;
} else {
  parsed = parsedFromShortLink || parsedFromDirect;
}

if (!parsed) throw new Error('Missing parsed submission');
const hasApproved = existing.some(i =>
  (i.json?.processingStatus ?? '').toString().trim() === 'APPROVED');
if (hasApproved) return [{ json: { skipInsert: true } }];
return [{ json: { ...parsed, skipInsert: false } }];
This works because both parse nodes set submissionTimestamp: new Date().toISOString() at execution time. Whichever branch actually ran for the current submission will always have the more recent timestamp — so the correct parsed item is always selected regardless of which path the submission took.