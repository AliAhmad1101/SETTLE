# SETTLE Voiceover Script for Text to Speech

A narration script synced to the 5 minute demo video. Four segments match the on screen timeline. The audio should run parallel to the video, so each segment is timed to what is visible.

## How to use this script

- Generate the narration as one audio file, or as four segments and stitch them.
- Segment boundaries and start times are marked below. Pause roughly one second at each `[pause]` marker.
- Amounts and record ids are written the way they should be spoken. Do not read symbols. For example `₹1,45,715` is written as "one lakh forty five thousand seven hundred fifteen rupees", and `ORD1082` as "order one zero eight two".
- Word counts per segment assume a calm pace of about 140 words per minute. Keep that pace so the audio stays inside each time window.
- Voice direction: confident, calm, operations professional. No music, no effects.

## Timeline map

| Video time | On screen | Segment |
| ---------- | --------- | ------- |
| 0:00 to 0:50 | Overview dashboard, then Reconcile page | Segment 1 |
| 0:51 to 2:15 | Issues page, then Payments page | Segment 2 |
| 2:16 to 4:00 | Orders page, then AI Agent page | Segment 3 |
| 4:01 to 5:00 | Settings page, then Reports page | Segment 4 |

---

## Segment 1 — 0:00 to 0:50 — Overview and Reconcile

Payment systems tell businesses whether money moved. They do not always tell them whether their records agree with that money. [pause] This is SETTLE. An AI agent that reconciles payments automatically.

We loaded a demo dataset with one hundred twenty seven orders and one hundred twenty four payment records. The reconciliation engine compared them in seconds. One hundred three records matched cleanly. Twenty seven discrepancies need attention. One lakh forty five thousand seven hundred fifteen rupees is unresolved. Health score? Eighty one percent. Needs attention.

Watch how it works. [pause] We open the Reconcile page, load the demo dataset, and run reconciliation. The engine normalizes every record, matches payments to orders, checks amounts and statuses, and detects every discrepancy. No spreadsheets. No manual checking.

---

## Segment 2 — 0:51 to 2:15 — Issues and Payments

Now the real work begins. The Issues page lists all twenty seven discrepancies, sorted by severity and value. Nine missing payments. Five amount mismatches. Three duplicate payments. Three captured payments on cancelled orders. Three payments with no matching order. Two refund mismatches. One suspicious mapping. And one incorrect status.

[pause] Let us filter by high severity and open the largest case. Order one zero eight two was paid, but the payment amount exactly matches a different order, order one zero zero four. Eighteen thousand nine hundred ninety nine rupees is at stake.

Notice the structure. The panel separates verified facts from AI interpretation. The engine shows the expected amount, the received amount, the difference, and both statuses. The AI explains what happened, why it matters, and what to do next, with an eighty five percent confidence. The numbers are calculated by the engine. The AI only interprets them.

[pause] From here we check the Payments page. Every payment shows its amount, status, customer, date, and whether it matches an order. Captured. Pending. Failed. Refunded. One search finds any record in seconds.

---

## Segment 3 — 2:16 to 4:00 — Orders and AI Agent

The Orders page gives the same clarity from the other side. Each order shows the customer, the expected amount, the order status, the linked payment status, and the reconciliation status. Any order with a problem opens its investigation directly.

[pause] Now for the heart of SETTLE. The AI agent is not a chatbot. It is a payment operations copilot. It observes, reasons, investigates, recommends, and acts.

We ask: what needs my attention? The agent answers with the high severity cases and the exact money at stake, and it cites the issue records.

We ask: explain the largest issue. It opens the case and walks through what happened and what to do.

We ask: what should I do? It gives a clear priority order, starting with the highest value cases.

[pause] Watch the references. Every record the agent mentions is clickable. We click one, and the issue panel opens. The agent remembers the conversation, so a follow up like "why" keeps the context without repeating the order number.

The agent uses internal tools to read the reconciliation state, calculate unresolved amounts, and rank high value issues. If the model is unavailable, a built in reasoning engine answers with the same data. And humans approve every action. The agent prepares the decision. We execute it.

---

## Segment 4 — 4:01 to 5:00 — Settings and Reports

Finally, the Settings page shows the system status. Reconciliation engine: operational. AI agent: operational. Data source: demo dataset. Razorpay connection: not configured. And that is fine, because the demo works fully offline.

[pause] The Reports page turns everything into one page. Total orders. Total payments. Matched records. Unresolved amount. Refund amount. The full issue breakdown. And an AI executive summary that explains the overall situation in plain language. One click copies the report. One click exports the CSV.

[pause] Businesses already have payment data. The painful part begins after the payment succeeds, when they have to figure out whether that payment actually reconciles with their records. SETTLE turns payment reconciliation from a spreadsheet task into an AI assisted operations workflow. Your payments should reconcile themselves.

---

## Reading notes

- `₹1,45,715` → "one lakh forty five thousand seven hundred fifteen rupees"
- `ORD1082` → "order one zero eight two" (never "ord one thousand eighty two")
- `ORD1004` → "order one zero zero four"
- `18,999` → "eighteen thousand nine hundred ninety nine"
- `81%` → "eighty one percent"
- `85%` → "eighty five percent"
- Do not read the brackets. Everything in square brackets is a delivery instruction only.