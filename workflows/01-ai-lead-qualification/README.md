# AI Lead Qualification Automation

This workflow is a demo AI automation built with n8n, OpenAI, Gmail, and Airtable CRM.

It captures real estate buyer leads from a form, extracts and scores lead information using AI, checks whether the lead is qualified, sends an email alert, and saves the lead into Airtable CRM.

## Problem

Real estate agents and small agencies often spend time manually reviewing buyer inquiries, checking budgets, reading purchase timelines, and deciding which leads deserve quick follow-up.

This can slow down response time and cause qualified leads to be missed.

## Solution

This workflow automates the lead qualification process.

A buyer submits a form. The workflow sends the lead details to an AI information extractor, calculates a qualification score, checks if the lead is qualified, sends a Gmail alert, and stores the lead in Airtable CRM.

## Tools Used

- n8n
- OpenAI / AI Chat Model
- Gmail
- Airtable
- Form Trigger
- Conditional Logic

## Workflow Steps

1. Lead submits a property inquiry form.
2. n8n receives the form submission.
3. AI extracts structured lead information.
4. AI calculates lead score based on budget, timeline, location, and property type.
5. Workflow checks whether the lead is qualified.
6. Qualified lead alert is sent through Gmail.
7. Lead details are saved in Airtable CRM.

## Business Use Case

This workflow is useful for:

- Real estate agents
- Property consultants
- Small real estate agencies
- Sales teams
- Lead generation teams

It helps reduce manual lead checking, improve response speed, and keep CRM records organized.

## Demo Video

YouTube Demo: https://youtu.be/rynkF-VkaOY

## Screenshots

Screenshots are available in the `/screenshots` folder.

## Exported Workflow

The exported n8n workflow JSON is available in the `/exported-workflow` folder.

## Setup Notes

To reuse this workflow:

1. Replace the demo form with your own form.
2. Connect your OpenAI account.
3. Connect your Gmail account.
4. Connect your Airtable base.
5. Update lead scoring rules if needed.
6. Test the workflow with sample lead data.

## Disclaimer

This is a portfolio/demo workflow created for learning, testing, and client demonstration purposes. It does not represent confidential client work.
