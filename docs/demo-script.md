# SETTLE Demo Script

A timed 5 minute presentation. The full journey, problem to resolved issue to report, takes about 90 seconds of clicking. The remaining time is narrative and architecture.

## Before You Start

- Run `npm install` then `npm run dev`
- Open http://localhost:4000
- The demo dataset is already loaded and reconciled, so nothing needs credentials
- Close every other tab. The whole demo happens in one browser window

## 0:00 to 0:30. Problem

> "Payment systems tell businesses whether money moved. They don't always tell businesses whether their internal records agree with that money."

Give one concrete example: an order expects ₹2,499, a payment for ₹2,499 is captured, but the reference points at a different order. Somewhere between the gateway and the books, the truth got lost. Finding these cases by hand is spreadsheet archaeology.

Introduce SETTLE: an AI agent that reads the orders and the payments, finds every mismatch, explains why it happened, and tells you what to do.

## 0:30 to 1:00. Load and Run

Click **Load Demo Dataset** in the sidebar flow (or note it is already loaded). Click **Run Reconciliation** and let the progress steps play: loading, matching, checking amounts, detecting discrepancies, building AI explanations.

Land on the dashboard and read the numbers out loud:

- 127 orders, 124 payments
- 103 matched, 27 issues
- Health score in the high seventies
- The AI summary card: "X orders were compared against Y payment records. Z records matched automatically. N discrepancies require attention."

## 1:00 to 2:00. Issues

Open **Issues**. Filter by severity and pick High. Open the largest issue, the cancelled order with a captured payment.

Point at the structure of the panel:

- **Verified data**: the facts calculated by the engine, expected, received, difference, statuses
- **AI Investigation**: what happened, why it matters, recommended action, confidence
- The trust line: financial records are calculated by the engine, AI only interprets

## 2:00 to 3:00. The Agent

Open **AI Agent**. Ask "What needs my attention?" The agent reports the high severity cases and the money at stake, and cites the exact issue ids.

Ask "Explain the largest issue." The agent opens the reasoning for that case with references.

Ask "What should I do?" The agent lays out a priority order and which issues resolve quickly.

Click one of the referenced issue chips. The detail panel opens. This is the wow moment: the agent did not just talk, it navigated the product to the exact record.

## 3:00 to 4:00. Resolve and Watch It Update

In the issue panel click **Mark Reviewed** or **Apply Recommendation**. The dashboard updates live: open issues drops from 27 to 26, unresolved amount drops.

Return to the dashboard and show the updated numbers. The agent prepared the decision, a human approved it.

## 4:00 to 4:30. Architecture

Draw the flow on the whiteboard or on screen:

Data → Reconciliation Engine → Issue Detection → AI Investigation → Human Approval

Emphasize the division of labor: the engine does all arithmetic, AI interprets only verified results, humans approve every action. No API key is required for any of it.

## 4:30 to 5:00. Why This Matters

> "Businesses already have payment data. The painful part begins after the payment succeeds, when they have to determine whether that payment actually reconciles with their business records."

Close with the one line:

> "SETTLE turns payment reconciliation from a spreadsheet task into an AI assisted operations workflow."

## The Pitch Frame

Do not say "we built an AI chatbot for payments". Say: the agent investigates reconciliation problems. It observes, reasons, investigates, recommends, and acts with human approval. That is the difference between a wrapper and a workflow.

## Fail Safe

If the live model is configured but unreachable, the agent falls back to the built in reasoning engine and the demo never stops. If you have no credentials at all, the demo is identical. Nothing in the core flow depends on the internet.