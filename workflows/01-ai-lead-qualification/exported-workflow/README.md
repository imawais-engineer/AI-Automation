# Exported Workflow

This folder contains the n8n or Make.com workflow export.

## How to Use

1. Get your API keys:
   - OpenAI
   - HubSpot
   - Gmail

2. In n8n or Make:
   - Click Import
   - Upload workflow file
   - Replace placeholders with your API keys
   - Test trigger
   - Activate

## Workflow Files

- `workflow.json` – n8n format
- `workflow.zip` – Make.com format

## Important Notes

- API keys are NOT included
- You must add your own:
  - OpenAI API Key
  - HubSpot Private App Token
  - Gmail OAuth token

- Update these placeholders:
  - `YOUR_OPENAI_API_KEY`
  - `YOUR_HUBSPOT_TOKEN`
  - `YOUR_FORM_ID`

## Version

- n8n: v1.0 (compatible with n8n 0.170+)
- Make: v1.0

---

**Status:** Planned
