1-update workflow 1 to send gmail with start and end time in UTC

2-Cleaner opens Google Maps → Share location → paste link.Workflow extracts lat/lng from link.User can also paste wrong location we can use app instead of it other wise it needs scripting 
You can attach Apps Script to the form
to auto-capture browser geolocation.

BUT:
Requires script permissions
Requires domain configuration
Can break on mobile browsers

3- when triggerring workflow Processing may take 30–60 seconds because Google Sheets trigger polls.