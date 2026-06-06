# Setup Guide

## Prerequisites

- Google account (for Forms, Sheets, Gmail)
- OpenAI account with API key
- HubSpot account (free tier ok)
- n8n or Make account
- (Optional) Slack workspace

**Estimated Time:** 2-3 hours

---

## Part 1: Create the Form (15 minutes)

### Step 1: Create Google Form

1. Go to https://forms.google.com
2. Click **+ Create new form**
3. Name it: "Lead Capture Form"

### Step 2: Add Form Fields

Add these questions:

1. **Full Name** (Short answer, Required)
2. **Email** (Short answer, Required)
3. **Company** (Short answer, Required)
4. **Phone** (Short answer, Required)
5. **Budget** (Multiple choice)
   - Options: <$5K, $5K-$25K, $25K-$50K, $50K+
6. **Timeline** (Multiple choice)
   - Options: ASAP, 1-3 months, 3-6 months, 6+ months
7. **What do you need help with?** (Paragraph, Required)

### Step 3: Enable Responses Sheet

1. Click **Responses** tab
2. Click spreadsheet icon
3. **Create new spreadsheet**
4. Name: "Lead Capture Responses"
5. Forms will now log to this sheet

### Step 4: Test Form

1. Click **Preview** (eye icon)
2. Fill out test submission
3. Submit
4. Check that response appears in spreadsheet

---

## Part 2: Set Up APIs (45 minutes)

### OpenAI Setup

1. Go to https://platform.openai.com/account/api-keys
2. Click **Create new secret key**
3. Copy the key (store securely)
4. Go to **Usage** → Set usage limits to be safe

### HubSpot Setup

1. Go to https://app.hubspot.com
2. Settings (bottom left)
3. **Integrations** → **Private apps**
4. Click **Create private app**
5. Name: "Lead Automation"
6. Scopes needed:
   - crm.objects.contacts.read
   - crm.objects.contacts.write
7. **Create app**
8. Copy **Private app access token**

---

## Part 3: Build Workflow in n8n (60-90 minutes)

### In n8n or Make.com

1. **Create New Workflow**
   - Name: "Lead Qualification Automation"

2. **Add Trigger**
   - Google Forms: New Form Response
   - Select your form
   - Test trigger

3. **Add Nodes (in order)**

#### Node 1: Parse Form Data
- Type: Basic node / Function
- Extract form fields into structured format

#### Node 2: OpenAI API Call
- Type: OpenAI node (or HTTP request)
- Model: gpt-3.5-turbo
- Temperature: 0.3
- Use scoring prompt

#### Node 3: Parse AI Response
- Extract score number from response
- Convert to integer

#### Node 4: Conditional Logic
- IF score >= 80: Go to hot lead path
- ELSE: Go to low-score path

#### Node 5a (Hot Lead): HubSpot Create Contact
- API: HubSpot Create Contact
- Map fields: name, email, company, etc.
- Set custom property: Lead Score = AI score

#### Node 6: Error Handling
- Add error handler
- Send email if anything fails
- Log error details

---

## Part 4: Verification & Testing (30 minutes)

### Test Scenarios

1. **Test High-Score Lead**
   - Submit form with all fields complete
   - High budget, immediate timeline
   - Check HubSpot → Contact created
   - Check Gmail → Email received

2. **Test Low-Score Lead**
   - Submit form with minimal info
   - Low budget, distant timeline
   - Check HubSpot → No contact created

3. **Test Error Handling**
   - Temporarily disable HubSpot API
   - Submit form
   - Check error log

---

## Final Checklist

- ✓ Form is live and tested
- ✓ Workflow is active
- ✓ All API keys configured
- ✓ Error alerts set up
- ✓ Logging sheet created
- ✓ Email templates ready
- ✓ HubSpot fields mapped correctly

---

**Status:** Planned  
**Last Updated:** June 2026
