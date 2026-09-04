# SETTLE

**Your payments should reconcile themselves.**

SETTLE is an AI powered payment reconciliation agent. It takes two datasets, the payments your gateway collected and the orders your business recorded, matches them, finds every discrepancy, explains why each one happened, and tells you what to do next. Built for the Razorpay Buildathon, Track 05, Open Track.

## The Problem

Payment systems tell businesses whether money moved. They do not always tell businesses whether their internal records agree with that money.

A business can have Order ORD1042 expecting ₹1,999 while the payment system holds a captured payment for ₹1,999 linked to a different order. Or an order that was cancelled while the money was still captured. Or a refund issued while the books still show the order as paid. Finding these manually is tedious spreadsheet work.

The real question is not "where is my payment?". The real question is "what happened to my money, why does my record not match, and what should I do about it?". SETTLE answers that question.

## The Solution

SETTLE is an operations agent, not a chatbot. It:

1. Reads the orders and payments datasets
2. Normalizes every record
3. Matches payments to orders with a deterministic engine
4. Detects and classifies discrepancies across 8 issue types
5. Investigates each case and explains it in human language
6. Assigns a severity and recommends the next action
7. Lets a human approve each resolution

The core division of labor is strict. The reconciliation engine does all arithmetic: totals, differences, counts, statuses. The AI layer only interprets those verified results. AI never invents financial facts.

## Features

- **Dashboard** with live metrics: total payments, orders, matched records, issues, unresolved count, refunds
- **Reconciliation health score** with a clear visual indicator
- **AI reconciliation summary** generated from the current dataset
- **Issue detection** across 8 categories: missing payment, missing order, amount mismatch, duplicate payment, cancelled order paid, refund mismatch, incorrect status, suspicious mapping
- **Severity levels**: critical, high, medium, low
- **Issue detail panel** with verified facts, AI investigation, recommended action, and confidence
- **SETTLE Agent**, a tool using AI copilot that observes, reasons, investigates, recommends, and prepares actions
- **Agent memory** so follow up questions keep context, such as "what is the biggest one?" after "how much is unresolved?"
- **Clickable references** so the agent can open the exact records it mentions
- **CSV upload** for orders and payments, with automatic header detection
- **Load Demo Dataset** one click flow that works fully offline
- **Search and filters** across issues, payments, and orders
- **Resolve, review, and note workflow** with live dashboard updates
- **Reports page** with a copyable reconciliation report and CSV export
- **Razorpay integration layer** that works in test mode when credentials are configured, and is completely optional

## Architecture

```
USER
  |
  v
SETTLE UI (HTML, CSS, vanilla JavaScript SPA)
  |
  v
API SERVER (Node.js + Express)
  |
  v
RECONCILIATION ENGINE (deterministic matching and issue detection)
  |
  +----------- ORDERS ----------+----------- PAYMENTS ----------+
  |
  v
ISSUE DETECTION (8 categories, severity assignment)
  |
  v
AI AGENT (tool functions, built in reasoning engine, optional live model)
  |
  v
EXPLANATION + RECOMMENDATION
  |
  v
HUMAN APPROVAL (review, resolve, apply recommendation)
```

## AI Architecture

The AI agent uses an internal tool architecture. Before answering, it decides which data it needs:

- `get_reconciliation_summary`
- `get_issue_list`
- `get_issue_details`
- `get_order`
- `get_payment`
- `calculate_unresolved_amount`
- `get_high_value_issues`
- `get_issue_breakdown`
- `generate_finance_summary`

The agent works in two modes:

1. **Built in reasoning engine (default).** A deterministic intent engine reads the reconciliation state through the same tools, routes questions such as "what needs my attention?", "explain ORD1120", or "how much is unresolved?" to the right data, and answers with references to real records. This mode needs no API key, no internet, and cannot hallucinate.
2. **Live model (optional).** When `AI_API_KEY` is set, the agent calls a chat completions API with the verified reconciliation context and asks for structured JSON output. The response is validated, references are filtered against the actual dataset, and any failure falls back to the built in engine.

AI generates interpretation and recommendations only. Financial records are calculated by the reconciliation engine, and a human approves every action. See `docs/ai.md` for the full explanation.

## Running Locally

Requirements: Node.js 18 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:4000

The server starts with the demo dataset already loaded and reconciled, so the first click is always "Load Demo Dataset" style ready. To regenerate the demo CSV files:

```bash
npm run generate-data
```

## Standalone Mode (No Server Needed)

SETTLE also runs as a completely standalone page. The demo dataset is embedded in `frontend/js/demo-data.js` and a client side copy of the reconciliation engine, agent, and CSV parser lives in `frontend/js/local-engine.js`.

Just open `frontend/index.html` directly in a browser. When the app cannot reach the backend server it automatically switches to the embedded engine and shows a banner: "Standalone demo mode." Every feature keeps working: dashboard, reconciliation, issues, AI agent, review and resolve, search, filters, and reports.

The same page talks to the backend server whenever it is reachable, from any origin, thanks to permissive CORS on the server.

## Environment Variables

Copy `.env.example` to `.env`. Everything is optional.

| Variable | Purpose |
| -------- | ------- |
| `AI_API_KEY` | Enables the live model mode. Without it, SETTLE uses the built in reasoning engine, which is fully functional and offline. |
| `AI_BASE_URL` | Optional. Base URL for a compatible chat completions API. Defaults to `https://api.openai.com/v1`. |
| `AI_MODEL` | Optional. Model name. Defaults to `gpt-4o-mini`. |
| `RAZORPAY_KEY_ID` | Optional. Enables importing payments from Razorpay test mode. |
| `RAZORPAY_KEY_SECRET` | Optional. Secret for the Razorpay API. |

Secrets never appear in frontend code. The browser only ever talks to the local server, and the server keeps keys in process environment variables.

## Demo

1. Open the app
2. Load Demo Dataset (or it is already loaded)
3. Run Reconciliation (or it is already reconciled)
4. Open Issues and filter by severity
5. Open the highest value issue and read the verified facts and AI investigation
6. Open the AI Agent and ask "What needs my attention?"
7. Ask "Explain the largest issue", then "What should I do?"
8. Click a referenced issue, mark it reviewed
9. Return to the dashboard and watch the metrics update
10. Open Reports and copy the report

The whole journey takes about 90 seconds and works with no external credentials. See `docs/demo-script.md` for the timed 5 minute version.

## Razorpay Integration

SETTLE supports two data modes: demo CSV mode (default) and Razorpay API mode. The application works completely without Razorpay credentials. When `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` are present, the Reconcile page offers "Import from Razorpay", which fetches payments from the account in test mode. Orders still come from your dataset or upload. The demo never breaks when credentials are missing.

## What Broke

Real development problems were hit and fixed during this build. They are documented honestly in `docs/what-broke.md`: CSV schema inconsistencies, AI structured output failures, duplicate detection, state synchronization, and more.

## Limitations

- In memory state only. Restarting the server resets resolutions and notes.
- Single workspace. No multi tenant support in this MVP.
- No real refund execution. The agent prepares actions, humans approve them, and only the local reconciliation status changes.
- The live model mode is best effort. When the API is unreachable, the built in engine takes over automatically.

## Future

- Automatic reconciliation on a schedule with email digests
- Accounting integrations (ledger sync, tax reports)
- ERP integrations (order systems, inventory)
- Human approval queues with roles
- Webhook driven reconciliation as payments arrive
- Export to Excel and Google Sheets

## License

MIT. See `LICENSE`.