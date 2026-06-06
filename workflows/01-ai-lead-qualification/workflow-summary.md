# Workflow Summary

## Quick Overview

This workflow converts form submissions into qualified leads automatically.

**Input:** Form submission with lead information  
**Output:** Lead added to CRM (if qualified) + automated follow-up email + error logs

---

## Step-by-Step Breakdown

### Step 1: Form Submission Trigger
- Listen for new submissions from Google Forms
- Capture all form fields

### Step 2: Extract & Structure Data
- Extract name, email, company, etc.
- Format for API calls

### Step 3: AI Scoring
- Send lead data to OpenAI API
- Request qualification score (0-100)
- Parse score from response

### Step 4: Decision Branch
- **If Score >= 80:** Proceed to hot lead flow
- **If Score < 80:** Proceed to log flow

### Step 5a: Hot Lead Flow
1. Add contact to HubSpot
2. Send welcome email from template
3. Create follow-up task
4. Send Slack notification to sales team
5. Log success to spreadsheet

### Step 5b: Low-Score Lead Flow
1. Log to "Review Later" spreadsheet
2. Send admin email alert
3. Tag for manual review
4. Don't add to CRM yet

### Step 6: Error Handling
- If any step fails:
  1. Log error details
  2. Send error notification to admin
  3. Store lead temporarily
  4. Retry after 1 hour

### Step 7: Logging
- Record all executions
- Track success rate
- Monitor error patterns

---

## Data Flow

```
Google Forms
    ↓
n8n/Make Workflow
    ↓
    ├→ OpenAI API (scoring)
    ├→ HubSpot API (CRM add)
    ├→ Gmail (send email)
    ├→ Google Sheets (logging)
    └→ Slack (notifications)
```

## Execution Timeline

- **Form submission:** 0 seconds
- **AI scoring:** 2-3 seconds
- **CRM addition:** 1-2 seconds
- **Email sent:** 1-2 seconds
- **Total time:** 5-10 seconds

---

**Status:** Planned
