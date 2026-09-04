// SETTLE AI agent.
// Agent style architecture: the agent reads the reconciliation state through
// tool functions, reasons over the results, and answers with references to
// actual records. Works fully offline with a built in reasoning engine. When
// AI_API_KEY is configured it calls a live model and falls back to the built
// in engine on any failure.

const engine = require("./engine");

const SYSTEM_PROMPT =
  "You are SETTLE, an AI payment reconciliation operations agent. " +
  "You analyze verified transaction and order records. Never invent financial information. " +
  "Only make claims supported by provided data. Use deterministic reconciliation results as the source of truth. " +
  "Your role is to explain discrepancies, identify likely causes, prioritize issues, and recommend operational next steps. " +
  "Do not modify transactions. Do not claim that a payment was refunded, captured, failed, or reversed unless the supplied data explicitly indicates it. " +
  "When uncertain, clearly state uncertainty. " +
  "Respond with JSON only: {\"answer\": string, \"references\": array of record ids, \"actions\": array of strings, \"toolsUsed\": array of strings, \"reasoning\": string}. " +
  "Never use hyphens or dashes in your answer text.";

// ---------------------------------------------------------------------------
// Tool functions
// ---------------------------------------------------------------------------
const tools = {
  get_reconciliation_summary(s) {
    return `${s.summary.orders} orders, ${s.summary.payments} payments, ${s.summary.matched} matched, ${s.summary.open} open issues, ${engine.fmtINR(s.summary.unresolvedAmount)} unresolved.`;
  },
  get_issue_list(s, opts = {}) {
    return s.issues.filter((i) =>
      (!opts.severity || i.severity === opts.severity) &&
      (!opts.status || i.state === opts.status) &&
      (!opts.type || i.type === opts.type)).slice(0, opts.limit || 10);
  },
  get_issue_details(s, id) {
    return s.issues.find((i) => i.id.toLowerCase() === String(id).toLowerCase());
  },
  get_order(s, id) {
    return s.orders.find((o) => o.order_id.toLowerCase() === String(id).toLowerCase());
  },
  get_payment(s, id) {
    return s.payments.find((p) => p.payment_id.toLowerCase() === String(id).toLowerCase());
  },
  calculate_unresolved_amount(s) {
    const open = s.issues.filter((i) => i.state === "open");
    return { count: open.length, amount: open.reduce((sum, i) => sum + i.amount, 0) };
  },
  get_high_value_issues(s, limit = 5) {
    return s.issues.filter((i) => i.state === "open").sort((a, b) => b.amount - a.amount).slice(0, limit);
  },
  get_issue_breakdown(s) {
    const byType = {};
    s.issues.forEach((i) => { byType[i.typeLabel] = (byType[i.typeLabel] || 0) + 1; });
    return Object.entries(byType).sort((a, b) => b[1] - a[1]);
  },
  generate_finance_summary(s) {
    const sum = s.summary;
    const top = tools.get_issue_breakdown(s)[0];
    const steps = tools.get_high_value_issues(s, 3);
    return [
      `Reconciliation report for the loaded dataset. ${sum.orders} orders were compared with ${sum.payments} payment records.`,
      `${sum.matched} records matched automatically and ${sum.open} issues are still open, representing ${engine.fmtINR(sum.unresolvedAmount)} in unresolved value.`,
      `The largest concentration is ${top ? top[0].toLowerCase() : "none"} with ${top ? top[1] : 0} cases.`,
      `Highest value open cases: ${steps.map((i) => `${i.id} for ${engine.fmtINR(i.amount)}`).join(", ")}.`,
      "Recommended next steps: review high severity cases first, verify the records in the gateway, then update order statuses or prepare refunds only after human confirmation."
    ].join(" ");
  },
  search(s, q) {
    const term = q.toLowerCase();
    return {
      issues: s.issues.filter((i) => i.id.toLowerCase().includes(term) || i.typeLabel.toLowerCase().includes(term) || (i.orderCustomer || "").toLowerCase().includes(term)),
      orders: s.orders.filter((o) => o.order_id.toLowerCase().includes(term) || o.customer.toLowerCase().includes(term)),
      payments: s.payments.filter((p) => p.payment_id.toLowerCase().includes(term) || p.order_id.toLowerCase().includes(term) || p.customer.toLowerCase().includes(term))
    };
  }
};

// ---------------------------------------------------------------------------
// Built in reasoning engine
// ---------------------------------------------------------------------------
function issueLines(s, issues) {
  return issues.map((i) => `${i.id} ${i.typeLabel} on ${i.orderId || i.paymentId} for ${engine.fmtINR(i.amount)}, ${i.severity.toUpperCase()} severity`).join(". ") + ".";
}

function builtInReply(s, message, history) {
  const m = message.toLowerCase();
  const toolsUsed = [];
  const use = (t) => { toolsUsed.push(t); return t; };
  const lastIssueId = [...history].reverse().map((h) => h.references || []).flat().find((r) => r.startsWith("ISS"));
  const live = lastIssueId && s.issues.find((i) => i.id === lastIssueId);
  let references = [];

  const iss = message.match(/ISS\d{4}/i);
  if (iss) {
    use("get_issue_details");
    const issue = tools.get_issue_details(s, iss[0]);
    if (issue) {
      const inv = engine.generateInvestigation(issue);
      references = [issue.id];
      return {
        answer: `${issue.id} is a ${issue.typeLabel.toLowerCase()} on ${issue.orderId || "no order"} worth ${engine.fmtINR(issue.amount)}. ${inv.what_happened} ${inv.recommended_action}`,
        references, toolsUsed, aiSource: "builtin"
      };
    }
    return { answer: `I don't have enough information in the current dataset to determine that. No issue with id ${iss[0]} exists.`, references: [], toolsUsed, aiSource: "builtin" };
  }
  const ord = message.match(/ORD\d{3,}/i);
  if (ord) {
    use("get_order");
    const order = tools.get_order(s, ord[0]);
    if (order) {
      const issues = s.issues.filter((i) => i.orderId === order.order_id);
      references = issues.map((i) => i.id);
      return {
        answer: `${order.order_id} belongs to ${order.customer}, expected ${engine.fmtINR(order.expected_amount)}, order status ${order.order_status}. ${issues.length ? `It has ${issues.length} flagged issue${issues.length > 1 ? "s" : ""}: ${issueLines(s, issues)}` : "No issues are flagged for this order."}`,
        references, toolsUsed, aiSource: "builtin"
      };
    }
  }
  const pay = message.match(/pay_[a-z0-9]+/i);
  if (pay) {
    use("get_payment");
    const payment = tools.get_payment(s, pay[0]);
    if (payment) {
      const issues = s.issues.filter((i) => i.paymentId === payment.payment_id);
      references = issues.map((i) => i.id);
      return {
        answer: `${payment.payment_id} is a ${payment.status} payment of ${engine.fmtINR(payment.amount)} from ${payment.customer}${payment.order_id ? ` linked to ${payment.order_id}` : " with no linked order"}. ${issues.length ? `It is part of ${issues.length} flagged issue${issues.length > 1 ? "s" : ""}.` : ""}`,
        references, toolsUsed, aiSource: "builtin"
      };
    }
  }

  const explainLargest = /\b(explain|what happened|tell me about|why is)\b/.test(m) && /\b(biggest|largest|big|top)\b/.test(m);
  if (explainLargest) {
    use("get_high_value_issues");
    use("get_issue_details");
    const target = s.issues.filter((i) => i.state === "open").sort((a, b) => b.amount - a.amount)[0];
    if (target) {
      const inv = engine.generateInvestigation(target);
      references = [target.id];
      return {
        answer: `${target.id} is the largest open issue, worth ${engine.fmtINR(target.amount)}. ${inv.what_happened} ${inv.why_it_matters} Recommended action: ${inv.recommended_action} Confidence ${inv.confidence} percent.`,
        references, toolsUsed, aiSource: "builtin"
      };
    }
  }

  if (/\b(why|explain|what happened|go on|tell me more)\b/.test(m) && live) {
    use("get_issue_details");
    const inv = engine.generateInvestigation(live);
    references = [live.id];
    return {
      answer: `For ${live.id}: ${inv.what_happened} ${inv.why_it_matters} Recommended action: ${inv.recommended_action} Confidence ${inv.confidence} percent.`,
      references, toolsUsed, aiSource: "builtin"
    };
  }

  if (/what should i do|what do i do|next step|how do i fix/.test(m)) {
    use("get_issue_list");
    use("calculate_unresolved_amount");
    const high = s.issues.filter((i) => i.state === "open" && (i.severity === "high" || i.severity === "critical"));
    references = high.map((i) => i.id);
    const u = tools.calculate_unresolved_amount(s);
    const steps = high.length
      ? `Start with the ${high.length} high severity cases worth ${engine.fmtINR(high.reduce((x, i) => x + i.amount, 0))}. ${high.map((i) => `${i.id} recommends ${i.recommendation.toLowerCase()}`).join(". ")}.`
      : `No high severity cases are open, but ${engine.fmtINR(u.amount)} is still unresolved.`;
    return {
      answer: `${steps} After that, clear the quick wins such as incorrect statuses and refund mismatches by updating the order statuses, then re run reconciliation.`,
      references, toolsUsed, aiSource: "builtin"
    };
  }

  if (/urgent|attention|immediate|priority|what needs|needs my attention/.test(m)) {
    use("get_issue_list");
    use("calculate_unresolved_amount");
    const high = s.issues.filter((i) => i.state === "open" && (i.severity === "high" || i.severity === "critical"));
    const u = tools.calculate_unresolved_amount(s);
    if (high.length) {
      references = high.map((i) => i.id);
      return {
        answer: `${high.length} high severity case${high.length > 1 ? "s" : ""} need${high.length > 1 ? "" : "s"} attention: ${issueLines(s, high)} Together they represent ${engine.fmtINR(high.reduce((x, i) => x + i.amount, 0))}. These should be manually verified before any refund or order status change.`,
        references, toolsUsed, aiSource: "builtin"
      };
    }
    return {
      answer: `No high severity cases are open. ${engine.fmtINR(u.amount)} is still unresolved across ${u.count} medium and low severity issues.`,
      references: [], toolsUsed, aiSource: "builtin"
    };
  }

  if (/unresolved|how much money|outstanding|at risk/.test(m)) {
    use("calculate_unresolved_amount");
    const u = tools.calculate_unresolved_amount(s);
    const largest = tools.get_high_value_issues(s, 1)[0];
    return {
      answer: `${engine.fmtINR(u.amount)} is currently unresolved across ${u.count} open issues. The largest is ${largest ? `${largest.id} at ${engine.fmtINR(largest.amount)}` : "none"}.`,
      references: largest ? [largest.id] : [],
      toolsUsed, aiSource: "builtin"
    };
  }

  if (/largest|biggest|highest|high value|risk|show me the top/.test(m)) {
    use("get_high_value_issues");
    const top = tools.get_high_value_issues(s, 5);
    references = top.map((i) => i.id);
    return {
      answer: `The highest value open issues are: ${issueLines(s, top)}`,
      references, toolsUsed, aiSource: "builtin"
    };
  }

  const historyRefs = [...history].reverse().map((h) => h.references || []).flat();
  if (/\b(those|them|that case|these cases)\b/.test(m) && historyRefs.length) {
    use("get_issue_details");
    const list = s.issues.filter((i) => historyRefs.includes(i.id));
    references = list.map((i) => i.id);
    if (list.length) return {
      answer: `Here are the cases you asked about: ${issueLines(s, list)}`,
      references, toolsUsed, aiSource: "builtin"
    };
  }

  if (/breakdown|most common|common failure|category|types of|distribution/.test(m)) {
    use("get_issue_breakdown");
    const b = tools.get_issue_breakdown(s);
    return {
      answer: `The most common reconciliation failures are: ${b.map(([t, n]) => `${n} ${t.toLowerCase()}`).join(", ")}.`,
      references: [], toolsUsed, aiSource: "builtin"
    };
  }

  if (/suspicious|wrong order|mislink|mapping/.test(m)) {
    use("get_issue_list");
    const list = tools.get_issue_list(s, { type: "suspicious_mapping" });
    references = list.map((i) => i.id);
    return {
      answer: list.length ? `Suspicious payment mappings found: ${issueLines(s, list)} Each links a payment to an order whose expected amount does not match, while the amount matches a different order.` : "No suspicious payment mappings exist in the current dataset.",
      references, toolsUsed, aiSource: "builtin"
    };
  }

  if (/summary|report|finance team|send to/.test(m)) {
    use("generate_finance_summary");
    return { answer: tools.generate_finance_summary(s), references: [], toolsUsed, aiSource: "builtin" };
  }

  if (/resolve|quickly|easy|fast|clear/.test(m)) {
    use("get_issue_list");
    const quick = s.issues.filter((i) => i.state === "open" && (i.type === "incorrect_status" || i.type === "refund_mismatch"));
    references = quick.map((i) => i.id);
    return {
      answer: quick.length ? `Issues that can be resolved quickly: ${issueLines(s, quick)} Each needs only a status update after verification in the gateway.` : "No low effort issues are open right now. Review the high severity cases first.",
      references, toolsUsed, aiSource: "builtin"
    };
  }

  if (/what'?s wrong|what is wrong|needs my attention|what needs|health|status of|overview/.test(m)) {
    use("get_reconciliation_summary");
    use("get_high_value_issues");
    const top = tools.get_high_value_issues(s, 3);
    references = top.map((i) => i.id);
    return {
      answer: `${s.summary.aiSummary} The three highest value open issues are: ${issueLines(s, top)}`,
      references, toolsUsed, aiSource: "builtin"
    };
  }

  use("get_reconciliation_summary");
  return {
    answer: `${tools.get_reconciliation_summary(s)} Ask me what needs attention, where the largest mismatch is, how much money is unresolved, or for a summary you can send to your finance team.`,
    references: [], toolsUsed, aiSource: "builtin"
  };
}

// ---------------------------------------------------------------------------
// Optional live LLM
// ---------------------------------------------------------------------------
function buildContext(s) {
  const top = tools.get_high_value_issues(s, 8).map((i) => {
    const inv = engine.generateInvestigation(i);
    return { id: i.id, type: i.typeLabel, orderId: i.orderId, paymentId: i.paymentId, amount: i.amount, severity: i.severity, state: i.state, what_happened: inv.what_happened, recommended_action: inv.recommended_action };
  });
  return JSON.stringify({ summary: s.summary, topIssues: top, issueBreakdown: tools.get_issue_breakdown(s) });
}

async function liveReply(config, s, message, history) {
  const url = (config.aiBaseUrl || "https://api.openai.com/v1").replace(/\/+$/, "") + "/chat/completions";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + config.aiApiKey },
    body: JSON.stringify({
      model: config.aiModel || "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT + "\nCurrent dataset context:\n" + buildContext(s) },
        ...history.slice(-8),
        { role: "user", content: message }
      ],
      temperature: 0.3,
      response_format: { type: "json_object" }
    })
  });
  if (!res.ok) throw new Error("AI request failed with " + res.status);
  const data = await res.json();
  const parsed = JSON.parse(data.choices[0].message.content);
  const references = (parsed.references || []).filter((r) =>
    s.issues.some((i) => i.id === r) || s.orders.some((o) => o.order_id === r) || s.payments.some((p) => p.payment_id === r));
  return {
    answer: String(parsed.answer || ""),
    references,
    actions: Array.isArray(parsed.actions) ? parsed.actions : [],
    toolsUsed: Array.isArray(parsed.toolsUsed) ? parsed.toolsUsed : [],
    reasoning: String(parsed.reasoning || ""),
    aiSource: "live"
  };
}

async function agentReply(s, message, history, config) {
  const hasKey = !!(config && config.aiApiKey);
  if (hasKey) {
    try {
      const r = await liveReply(config, s, message, history);
      if (r.answer) return Object.assign(r, { fallbackUsed: false });
    } catch (e) {
      // fall through to the built in engine
    }
  }
  return Object.assign(builtInReply(s, message, history), { fallbackUsed: hasKey });
}

module.exports = { agentReply, tools, builtInReply };