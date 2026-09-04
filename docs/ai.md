# SETTLE AI Documentation

This document explains the AI architecture for judges and reviewers: why deterministic rules exist, why and how an LLM is used, how context is built, how hallucinations are prevented, how structured output works, how fallback works, and why the agent never executes financial actions by itself.

## The Principle

SETTLE is an AI operations agent, not a chatbot pasted over a table. The product rule is simple and strict:

**Arithmetic is deterministic. AI interprets. Humans approve.**

The reconciliation engine calculates every number: totals, differences, counts, statuses, severity, unresolved value. The AI layer reads those verified results, classifies the likely problem, explains it in human language, and recommends a next step. The AI is never asked to add, subtract, or remember financial facts.

## Why Deterministic Rules Come First

An LLM is a language model. It is excellent at explanation and terrible at guaranteed arithmetic. If a payment of ₹2,499 is matched to an order expecting ₹2,999, the difference of ₹500 must be computed once, by code, and then trusted everywhere.

Rules also make the demo deterministic. The same dataset always produces the same 27 issues with the same severities and the same unresolved amount. A judge can run the flow twice and get identical results. That reliability is the foundation of the pitch.

The deterministic layer produces, for every issue: type, severity, amount at stake, expected amount, received amount, difference, refund amount, order status, payment status, and a recommendation label.

## Why an LLM Is Used

The rules know that something is wrong. They do not know how to talk about it. The LLM, or the built in reasoning engine in offline mode, turns a structured discrepancy into an investigation:

- What happened: "The payment was successfully captured, but the received amount is ₹500 lower than the expected order amount."
- Why it matters: "The order may have been partially paid or the internal order amount may be incorrect."
- Recommended action: "Verify whether a discount or partial payment was intentionally applied."
- Confidence: 87%

That interpretation is where AI earns its place. It converts a table row into an operational decision.

## Agent Tools and Context

The agent is architected with internal tools, even though the MVP implementation is small:

- `get_reconciliation_summary` returns the verified headline numbers
- `get_issue_list` filters by severity, status, or type
- `get_issue_details` returns one issue with its investigation
- `get_order` and `get_payment` fetch single records
- `calculate_unresolved_amount` sums the value at stake of open issues
- `get_high_value_issues` ranks open issues by amount
- `get_issue_breakdown` groups issues by type
- `generate_finance_summary` assembles a report ready to send to a finance team

The built in reasoning engine routes user intents to these tools. "How much money is unresolved?" calls `calculate_unresolved_amount`. "Show me suspicious payments" calls `get_issue_list` with the suspicious mapping type. "Explain the biggest issue" calls `get_high_value_issues` then `get_issue_details`. The answer always cites real records.

The live model path sends the same verified context: the summary, the top issues with their investigations, and the breakdown, serialized as JSON. The conversation history is included so follow ups like "what is the biggest one?" keep context.

## How Hallucinations Are Minimized

Several layers enforce honesty:

1. **Data first.** Every number in a response comes from the reconciliation state. The prompt instructs the model to treat deterministic results as the source of truth.
2. **No invention.** The system prompt forbids claiming a payment was refunded, captured, failed, or reversed unless the data says so. The model is told to state uncertainty when unsure.
3. **Reference validation.** When a live model returns references, the server checks each one against the actual orders, payments, and issues. Any id that does not exist is dropped.
4. **Unknown answers.** If the dataset cannot answer a question, the agent says: "I don't have enough information in the current dataset to determine that."
5. **Trust labels.** The UI separates "AI generated recommendation" from "Financial records are calculated by SETTLE's reconciliation engine."

## Structured Output

The live model is asked for JSON only, using a response format of `{ "answer": string, "references": array of ids, "actions": array of strings, "toolsUsed": array of strings, "reasoning": string }`. The server parses the response, validates that the answer is a string, filters the references, and rejects the payload if it does not parse. A malformed response never reaches the UI because it falls back to the built in engine.

## Fallback Mode

Reliability is the demo. If no API key is configured, or the API times out, or the response is invalid, the agent uses the built in reasoning engine. The same tools answer the same questions with deterministic, rule based explanations that are generated from the verified facts. The UI labels this clearly with "AI unavailable, using rule based explanation" when a configured model failed, and "Built in reasoning engine" in offline mode.

The core demo flow works with no internet, no API key, and no credentials.

## Why AI Does Not Execute Financial Actions

An AI that can move money is a liability, not a feature, for a one day MVP. SETTLE follows the pattern "AI prepares the decision, humans approve the action."

The agent recommends: "Mark ORD1043 for manual review." The UI offers "Apply Recommendation", which copies the recommendation into the issue note and marks the issue reviewed. Mark Reviewed and Resolve only change the local reconciliation status. No real refunds, no gateway mutations, no irreversible operations. The demo emphasizes that a human is always in the loop.

## Summary for the Pitch

The agent demonstrates the full loop: OBSERVE, it reads the reconciliation state; REASON, it identifies the important discrepancies; INVESTIGATE, it retrieves the records behind a case; RECOMMEND, it explains and suggests the next step; ACT, it prepares a safe workflow action that a human approves. That loop, not the chat surface, is what makes SETTLE an agent.