# Tools & Configuration

## Tools Required

### Workflow Orchestration
**n8n or Make.com**
- Choose based on preference
- n8n: Self-hosted or cloud
- Make: Cloud-based, pay per operation

### Form Source
**Google Forms** (easiest)
- Free, simple setup
- Automatic Sheets integration
- Easy to modify

### AI Scoring
**OpenAI API**
- Model: gpt-3.5-turbo or gpt-4
- Cost: $0.50-$1 per 1000 leads (approx)
- Setup: Get API key from https://platform.openai.com

### CRM
**HubSpot** (recommended for this demo)
- Free tier available
- Good lead management
- Easy API access

### Email Delivery
**Gmail API**
- Free with Google account
- Must enable Gmail API
- Supports templates

### Logging
**Google Sheets**
- Free
- Easy to monitor
- Good for dashboards

---

## Setup Instructions

### Step 1: Get API Keys

1. **OpenAI**
   - Go to https://platform.openai.com
   - Create API key
   - Set usage limits for safety
   - Copy key to n8n/Make

2. **HubSpot**
   - Go to https://app.hubspot.com
   - Settings → API Access → Private apps
   - Create private app
   - Get token
   - Copy to n8n/Make

---

## Configuration Templates

### OpenAI Prompt

```
Qualify this lead for a B2B SaaS software. Score from 0-100 based on:
- Company size (larger is better)
- Budget (>$5K is good)
- Timeline (immediate is better)
- Fit with service

Lead Info:
Name: {{name}}
Company: {{company}}
Budget: {{budget}}
Timeline: {{timeline}}

Return ONLY a number 0-100, no explanation.
```

### HubSpot Contact Fields

Map form fields to HubSpot:
- `firstName` → First name
- `lastName` → Last name
- `email` → Email
- `company` → Company name
- `phone` → Phone number
- `customScore` → AI Score

### Email Template

```
Subject: Welcome {{firstName}}! Let's talk about {{company}}

Hi {{firstName}},

Thanks for reaching out! I received your inquiry about [your service].

Based on your information, I think we could be a great fit.

I'd like to schedule a quick 15-minute call to understand your needs better.

Is tomorrow at 2 PM your time available?

Looking forward to connecting!

Best,
[Your Name]
```

---

**Status:** Planned
