# What Broke, and How We Got Out

The buildathon asks for honesty: what broke and how was it fixed. This document records the real failures from building SETTLE, each with the problem, the cause, the fix, and the lesson.

## 1. CSV Schema Inconsistencies

**Problem.** Uploaded CSVs used different column names: `orderId` and `order_id`, `expected_amount` and `amount`, `createdAt` and `timestamp`. Records were silently dropped or misread.

**Cause.** Real business exports are never consistent. Each source names its columns its own way, and a strict parser treats any mismatch as a broken file.

**Fix.** Added a normalization layer in `backend/engine.js`. Headers are lowercased, stripped of spaces and underscores, and aliases are mapped (for example `paymentid` becomes the canonical `pid`). Every upload goes through the same canonical shape before matching starts.

**Lesson.** Assume the input is messy. Normalize at the boundary and let the rest of the system work with one shape.

## 2. Demo Data Collisions Produced False Positives

**Problem.** The demo generator created amount mismatches using amounts that also existed elsewhere in the price pool. The engine then classified those cases as suspicious mappings, doubling the issue count and confusing the demo narrative.

**Cause.** The engine deliberately checks "does this exact amount belong to a different order?" for the suspicious mapping rule. When a mismatch amount coincided with another order's amount, the rule fired by design, and the demo data was not designed around it.

**Fix.** Generated mismatch received amounts with odd deltas (555, 333, 444) so they never collide with the standard price pool, and reserved a specific order so the one intended suspicious mapping produces exactly one missing payment instead of two overlapping flags.

**Lesson.** Rules interact. When you add a clever detection rule, regenerate the fixtures against the rule, not the other way around.

## 3. AI Structured Output Failures

**Problem.** The live model sometimes returned prose instead of the requested JSON, or a JSON object missing required fields. Parsing crashed the agent request.

**Cause.** Models drift on format instructions, and a bare `JSON.parse` trusts the model completely.

**Fix.** Asked for a strict JSON object with an explicit schema, wrapped parsing in a try/catch, validated that the answer is a string, and filtered every reference id against the actual dataset before returning it. Any failure falls through to the built in reasoning engine instead of erroring.

**Lesson.** Never let a model response reach the UI unvalidated. The fallback path is not a nice to have, it is the safety net that keeps the demo alive.

## 4. Duplicate Payment Detection Double Counting

**Problem.** An order with two captured payments could also trigger the refund or status rules, producing multiple issues for the same underlying case and inflating the totals.

**Cause.** The detection loop evaluated rules in a way that allowed later rules to fire after an earlier rule already claimed the order. Each rule wanted to be correct, and together they were wrong.

**Fix.** Made the loop emit one issue per order, with the most specific rule winning: cancelled order paid beats everything, duplicate beats amount mismatch, and so on. Payments with no order are handled in a separate pass.

**Lesson.** Issue detection is a decision tree, not a checklist. Decide the priority order of rules and enforce it with control flow.

## 5. Frontend and Backend State Drift

**Problem.** After resolving an issue, the dashboard still showed the old count until a manual refresh. The sidebar badge and the dashboard disagreed.

**Cause.** The frontend cached the summary from the initial load and only re-rendered the current page. Mutations updated the server but not the client mirror.

**Fix.** Centralized client state in one object, made every mutation endpoint reply with the fresh issue, re-fetched the summary after every state change, and re-rendered through the router so all pages read from the same mirror.

**Lesson.** In a small app the discipline is the same as in a big one: one source of truth, refresh it after every write, render from it everywhere.

## 6. Agent Conversation Context Loss

**Problem.** Asking "how much is unresolved?" and then "what is the biggest one?" lost the thread. The second question got a generic answer.

**Cause.** The agent treated every message as independent. There was no memory of the last referenced issue.

**Fix.** Added session context: the server keeps the conversation, and the reasoning engine looks back through prior references to find the issue the user is asking about. "Why?" after an explanation now resolves to the same case.

**Lesson.** Agents are judged on follow ups. Context, even a lightweight one, is what turns a Q&A box into a copilot.

## 7. Razorpay Credentials Breaking the Demo

**Problem.** Early on, the app tried to reach the Razorpay API whenever it started, and without credentials the flow errored out.

**Cause.** Integration code assumed credentials exist. The buildathon rule says the demo must never break because credentials are missing.

**Fix.** Made Razorpay a pure optional layer. The server checks configuration and reports status; the UI disables the import button and labels the source honestly when not configured. The demo path never touches the gateway.

**Lesson.** External dependencies are liabilities in a demo. Feature flag them at the boundary and keep the core path offline safe.

## The Meta Lesson

Every failure in this list came from the same root: assuming the world is clean. Messy CSVs, colliding fixtures, sloppy model output, overlapping rules, drifting state, and lost context are all the world being messy. The fixes all point the same direction: normalize at the boundary, validate at the boundary, decide priorities explicitly, and keep one source of truth. SETTLE is more reliable for having broken, and this document exists so the next build does not break the same way.