# Open-JSON-UI examples

## Basic screen

```json
{
  "type": "screen",
  "title": "Project status",
  "content": [
    { "type": "heading", "level": 2, "text": "Launch readiness" },
    { "type": "text", "text": "The project is on track with two open risks." },
    { "type": "badge", "label": "On track", "tone": "success" }
  ]
}
```

## Card with actions

```json
{
  "type": "screen",
  "title": "Approval queue",
  "content": [
    {
      "type": "card",
      "title": "Expense approval",
      "description": "Request exp_2048 needs review.",
      "content": [
        { "type": "text", "text": "Amount: $245.10" },
        { "type": "text", "text": "Vendor: Acme Supplies" }
      ],
      "actions": [
        {
          "type": "button",
          "label": "Approve",
          "action": { "name": "approve_expense", "parameters": { "expenseId": "exp_2048" } }
        },
        {
          "type": "button",
          "label": "Reject",
          "style": "secondary",
          "action": { "name": "reject_expense", "parameters": { "expenseId": "exp_2048" } }
        }
      ]
    }
  ]
}
```

## Form

```json
{
  "type": "screen",
  "title": "Create support ticket",
  "content": [
    {
      "type": "form",
      "title": "Ticket details",
      "fields": [
        {
          "type": "input",
          "name": "summary",
          "label": "Summary",
          "inputType": "text",
          "required": true,
          "placeholder": "Briefly describe the issue"
        },
        {
          "type": "input",
          "name": "details",
          "label": "Details",
          "inputType": "textarea",
          "required": true
        },
        {
          "type": "select",
          "name": "priority",
          "label": "Priority",
          "required": true,
          "options": [
            { "label": "Low", "value": "low" },
            { "label": "Medium", "value": "medium" },
            { "label": "High", "value": "high" }
          ]
        }
      ],
      "actions": [
        { "type": "button", "label": "Submit ticket", "action": { "name": "submit_ticket" } }
      ]
    }
  ]
}
```

## Table and chart

```json
{
  "type": "screen",
  "title": "Revenue report",
  "content": [
    {
      "type": "chart",
      "chartType": "bar",
      "title": "Revenue by month",
      "x": "month",
      "y": "revenue",
      "data": [
        { "month": "Jan", "revenue": 12000 },
        { "month": "Feb", "revenue": 15000 },
        { "month": "Mar", "revenue": 18000 }
      ]
    },
    {
      "type": "table",
      "columns": [
        { "key": "month", "label": "Month" },
        { "key": "revenue", "label": "Revenue" }
      ],
      "rows": [
        { "month": "Jan", "revenue": "$12,000" },
        { "month": "Feb", "revenue": "$15,000" },
        { "month": "Mar", "revenue": "$18,000" }
      ]
    }
  ]
}
```

## Component-catalog form

```json
{
  "version": "1.0",
  "components": [
    {
      "id": "ticket-form",
      "type": "form",
      "properties": {
        "title": "Create support ticket",
        "fields": [
          { "type": "input", "name": "summary", "label": "Summary", "inputType": "text", "required": true },
          { "type": "input", "name": "details", "label": "Details", "inputType": "textarea", "required": true }
        ],
        "actions": [
          { "type": "button", "label": "Submit", "action": { "name": "submit_ticket" } }
        ]
      }
    }
  ]
}
```

## Explicit Open-JSON-UI wrapper

```json
{
  "type": "open-json-ui",
  "spec": {
    "type": "screen",
    "title": "Next steps",
    "content": [
      {
        "type": "list",
        "ordered": true,
        "items": [
          "Confirm scope",
          "Assign owner",
          "Schedule review"
        ]
      }
    ]
  }
}
```

## AG-UI carrier event

```json
{
  "type": "STATE_DELTA",
  "delta": {
    "ui": {
      "spec": "open-json-ui",
      "content": {
        "type": "screen",
        "title": "Revenue by month",
        "content": [
          {
            "type": "chart",
            "chartType": "bar",
            "x": "month",
            "y": "revenue",
            "data": [
              { "month": "Jan", "revenue": 12000 },
              { "month": "Feb", "revenue": 15000 }
            ]
          }
        ]
      }
    }
  }
}
```
