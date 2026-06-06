# Sample Data

Use this data to test the workflow without submitting real leads.

## CSV Format

```csv
name,email,company,phone,budget,timeline,message
John Smith,john@example.com,Tech Corp,555-1234,$25K-$50K,ASAP,We need help automating our lead process
Sarah Johnson,sarah@acme.com,ACME Inc,555-5678,<$5K,3-6 months,Interested in learning about automation
Mike Chen,mike@startup.io,StartupAI,555-9999,$50K+,ASAP,Building automation into our product
```

## Test Scenarios

### Scenario 1: High-Quality Lead
- Name: John Smith
- Email: john.smith@techcorp.com
- Company: TechCorp Inc
- Budget: $50K+
- Timeline: ASAP
- Expected Score: 85-95 (should add to CRM)

### Scenario 2: Medium-Quality Lead
- Name: Sarah Johnson
- Email: sarah@acme.com
- Company: ACME Corp
- Budget: $10K-$25K
- Timeline: 1-3 months
- Expected Score: 60-75 (review required)

### Scenario 3: Low-Quality Lead
- Name: Mike Brown
- Email: mike@fakemail.co
- Company: Unknown
- Budget: <$5K
- Timeline: 6+ months
- Expected Score: 20-40 (review list)

---

**Status:** Planned
