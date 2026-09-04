# SETTLE Architecture

## Overview

SETTLE is a single page application with a Node.js API server. The server owns all data and all logic. The frontend is a thin client that renders state and sends actions. There is no database. State lives in memory on the server, which keeps the demo reliable and the build honest.

```
        USER
         |
         v
   SETTLE UI (SPA)
   HTML + CSS + vanilla JS
   hash router, 8 pages, agent chat
         |
         | fetch JSON over HTTP
         v
   API SERVER (Express)
   /api/health /api/status /api/demo /api/import /api/reconcile
   /api/reconciliation/summary /api/issues /api/orders /api/payments
   /api/search /api/agent /api/report /api/razorpay/*
         |
         v
   RECONCILIATION ENGINE (backend/engine.js)
   normalize orders and payments
   match by order id
   validate statuses, amounts, refunds, duplicates
   detect 8 issue types, assign severity, compute totals
         |
         +-------- ORDERS --------+-------- PAYMENTS --------+
         |
         v
   ISSUE LIST (sorted by severity, then value)
         |
         v
   AI AGENT (backend/ai.js)
   tool functions read the reconciliation state
   built in reasoning engine routes intents
   optional live model with structured JSON output
   fallback on any failure
         |
         v
   EXPLANATION + RECOMMENDATION + CONFIDENCE
         |
         v
   HUMAN APPROVAL
   review / resolve / note / apply recommendation
```

## Directory Layout

```
settle/
  frontend/
    index.html          app shell, sidebar, topbar, view container
    css/app.css         design tokens, layout, components
    js/app.js           state, API client, router, page renderers, agent, actions
  backend/
    server.js           Express server, routes, CSV parsing, in memory state
    engine.js           deterministic reconciliation engine
    ai.js               AI agent with tools, built in reasoning, live model, fallback
    demo.js             deterministic demo dataset generator (127 orders, 124 payments, 27 issues)
    razorpay.js         optional Razorpay integration layer
    data/               generated demo CSV files
  scripts/
    generate-demo-data.js   regenerates the demo CSVs
  docs/
    architecture.md
    ai.md
    demo-script.md
    what-broke.md
```

## Frontend

A vanilla JavaScript single page application. No framework, no build step, no bundle. The router listens to hash changes and renders one of eight views: dashboard, reconcile, issues, payments, orders, agent, reports, settings.

The frontend has a resilience trick for demos: `frontend/js/demo-data.js` embeds the demo dataset and `frontend/js/local-engine.js` is a client side port of the engine and agent. The API client tries the backend server first (from any origin, thanks to CORS) and switches to the embedded engine when the server is unreachable. The embedded engine mirrors the backend response shapes exactly, so every view works identically with or without the server.

The client keeps a mirror of the server state (summary, issues, orders, payments) and refreshes it after every mutation. Every button either navigates, calls an API, or updates local state. There are no placeholder buttons.

Key interactions:

- Load Demo Dataset posts to `/api/demo` and re-renders everything
- Run Reconciliation animates progress steps, posts to `/api/reconcile`, then shows the result
- Issue rows open a detail modal with verified facts and the AI investigation
- Mark Reviewed, Add Note, Resolve, and Apply Recommendation post to the issue endpoints and refresh the dashboard metrics
- The agent page posts messages to `/api/agent` and renders references as clickable chips
- Global search queries `/api/search` and shows grouped results

## Backend

Express serves the frontend statically and exposes the JSON API. On boot it loads the demo dataset and reconciles it, so the app is always in a demonstrable state.

In memory state holds orders, payments, issues, the summary, and the agent conversation. The conversation is capped at 30 messages. CSV parsing handles quoted fields, blank lines, and a UTF-8 BOM. All handlers return human readable errors, never stack traces.

## Reconciliation Engine

The engine in `backend/engine.js` is deterministic and self contained. It does not call any AI.

Normalization maps flexible CSV headers to a canonical shape. Matching then walks every order:

1. No payment record and order not cancelled becomes a missing payment
2. Order cancelled but a payment captured becomes a cancelled order paid
3. Order paid but linked payment failed becomes an incorrect status
4. Payment refunded but order not marked refunded becomes a refund mismatch
5. More than one captured payment becomes a duplicate payment
6. One captured payment whose amount differs from the expected amount becomes an amount mismatch, unless that exact amount belongs to a different order, which becomes a suspicious mapping
7. Payments referencing no known order become missing orders

Severity comes from logical rules: cancelled order paid and missing order are high, missing payment and duplicates scale with amount, amount mismatches scale with the difference. Every issue gets a value at stake, which drives the unresolved total and the "highest value" answers.

The summary computes matched count, open count, unresolved amount, refund amount, health score, the issue breakdown by type, and a narrative line assembled from real numbers.

## AI Agent

The agent lives in `backend/ai.js`. It exposes tool functions, a built in reasoning engine, an optional live model path, and a shared context builder. Details are in `docs/ai.md`.

## Razorpay Integration

`backend/razorpay.js` wraps the Razorpay API for fetching payments in test mode. It is only used when credentials exist. The server exposes its status so the UI can disable the import button and label the data source honestly. Without credentials nothing breaks.

## Data Flow for One Issue

1. The user opens ORD1043 from the issues table
2. The server runs `generateInvestigation` on the stored issue
3. Verified facts come from the record: expected ₹2,999, received ₹2,499, difference ₹500
4. The investigation explains the likely cause and recommends a check for discount or partial payment
5. The user marks the issue reviewed
6. The server rebuilds the summary and the dashboard counts update

This flow, data to reasoning to human approved action, is the whole product in miniature.