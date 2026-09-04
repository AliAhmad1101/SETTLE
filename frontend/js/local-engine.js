/* SETTLE standalone engine.
 * A client side port of the backend reconciliation engine and AI agent so the
 * demo works fully without a server. Response shapes mirror the backend API
 * exactly, so the rest of the frontend does not care which mode it is in.
 * Works in the browser (window.SETTLE_LOCAL) and in Node for testing.
 */
(function () {
  "use strict";

  const TYPES = {
    missing_payment: "Missing Payment",
    missing_order: "Missing Order",
    amount_mismatch: "Amount Mismatch",
    duplicate_payment: "Duplicate Payment",
    cancelled_order_paid: "Cancelled Order Paid",
    refund_mismatch: "Refund Mismatch",
    incorrect_status: "Incorrect Status",
    suspicious_mapping: "Suspicious Mapping"
  };

  const RECOMMENDATIONS = {
    missing_payment: "Locate missing payment",
    missing_order: "Link payment to order",
    amount_mismatch: "Review payment amount",
    duplicate_payment: "Verify duplicate charge",
    cancelled_order_paid: "Review refund eligibility",
    refund_mismatch: "Update refund status",
    incorrect_status: "Correct order status",
    suspicious_mapping: "Review payment mapping"
  };

  const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };

  function num(v) {
    if (v === null || v === undefined || v === "") return 0;
    if (typeof v === "number") return v;
    return parseFloat(String(v).replace(/[^0-9.\-]/g, "")) || 0;
  }

  function fmtINR(n) { return "₹" + Math.round(n).toLocaleString("en-IN"); }

  function norm(row) {
    const out = {};
    for (const k of Object.keys(row)) {
      const key = k.toLowerCase().replace(/[\s_]/g, "").replace("paymentid", "pid");
      out[key] = typeof row[k] === "string" ? row[k].trim() : row[k];
    }
    return out;
  }

  function normalizeOrders(raw) {
    return raw.map((r, i) => {
      const x = norm(r);
      return {
        order_id: String(x.orderid || x.id || "ORD-" + i),
        customer: String(x.customer || "Unknown customer"),
        expected_amount: num(x.expectedamount !== undefined ? x.expectedamount : x.amount),
        order_status: String(x.orderstatus || x.status || "paid").toLowerCase(),
        order_date: String(x.orderdate || x.date || "")
      };
    });
  }

  function normalizePayments(raw) {
    return raw.map((r, i) => {
      const x = norm(r);
      return {
        payment_id: String(x.pid || x.id || "pay_" + i),
        order_id: String(x.orderid || x.order_id || ""),
        amount: num(x.amount),
        status: String(x.status || "captured").toLowerCase(),
        customer: String(x.customer || "Unknown customer"),
        timestamp: String(x.timestamp || x.date || x.createdat || ""),
        refund_amount: num(x.refundamount !== undefined ? x.refundamount : x.refund)
      };
    });
  }

  function severityFor(type, order, payment) {
    const amt = payment ? payment.amount : order.expected_amount;
    switch (type) {
      case "missing_order":
      case "cancelled_order_paid":
        return "high";
      case "missing_payment":
        return amt >= 4999 ? "high" : "medium";
      case "amount_mismatch":
        return Math.abs(payment.amount - order.expected_amount) >= 500 ? "high" : "medium";
      case "duplicate_payment":
        return amt >= 4999 ? "high" : "medium";
      case "refund_mismatch":
      case "suspicious_mapping":
        return "medium";
      default:
        return "low";
    }
  }

  function amountAtStake(type, order, payment) {
    switch (type) {
      case "missing_payment": return order.expected_amount;
      case "refund_mismatch": return payment.refund_amount;
      default: return payment ? payment.amount : order.expected_amount;
    }
  }

  function detectIssues(orders, payments) {
    const orderMap = new Map(orders.map((o) => [o.order_id, o]));
    const issues = [];
    let seq = 0;
    const add = (issue) => {
      seq++;
      issues.push(Object.assign({ id: "ISS" + String(seq).padStart(4, "0"), state: "open", note: "", createdAt: new Date().toISOString() }, issue));
    };

    for (const o of orders) {
      const ps = payments.filter((p) => p.order_id === o.order_id);
      const captured = ps.filter((p) => p.status === "captured");
      const failed = ps.filter((p) => p.status === "failed");
      const refunded = ps.filter((p) => p.status === "refunded" || p.refund_amount > 0);

      if (ps.length === 0 && o.order_status !== "cancelled") {
        add({ type: "missing_payment", orderId: o.order_id, orderCustomer: o.customer, expectedAmount: o.expected_amount, orderStatus: o.order_status, paymentId: "", receivedAmount: 0, paymentStatus: "", refundAmount: 0, difference: 0 });
        continue;
      }
      if (o.order_status === "cancelled" && captured.length > 0) {
        const p = captured[0];
        add({ type: "cancelled_order_paid", orderId: o.order_id, orderCustomer: o.customer, expectedAmount: o.expected_amount, orderStatus: o.order_status, paymentId: p.payment_id, receivedAmount: p.amount, paymentStatus: p.status, refundAmount: p.refund_amount, difference: 0 });
        continue;
      }
      if (o.order_status === "paid" && failed.length > 0) {
        const p = failed[0];
        add({ type: "incorrect_status", orderId: o.order_id, orderCustomer: o.customer, expectedAmount: o.expected_amount, orderStatus: o.order_status, paymentId: p.payment_id, receivedAmount: p.amount, paymentStatus: p.status, refundAmount: p.refund_amount, difference: 0 });
        continue;
      }
      if (refunded.length > 0 && o.order_status !== "refunded") {
        const p = refunded[0];
        add({ type: "refund_mismatch", orderId: o.order_id, orderCustomer: o.customer, expectedAmount: o.expected_amount, orderStatus: o.order_status, paymentId: p.payment_id, receivedAmount: p.amount, paymentStatus: p.status, refundAmount: p.refund_amount, difference: 0 });
        continue;
      }
      if (captured.length > 1) {
        const p = captured[0];
        add({ type: "duplicate_payment", orderId: o.order_id, orderCustomer: o.customer, expectedAmount: o.expected_amount, orderStatus: o.order_status, paymentId: p.payment_id, receivedAmount: p.amount, paymentStatus: p.status, refundAmount: p.refund_amount, difference: 0, extraPaymentIds: captured.slice(1).map((x) => x.payment_id) });
        continue;
      }
      if (captured.length === 1) {
        const p = captured[0];
        if (p.amount !== o.expected_amount) {
          const other = orders.find((x) => x.order_id !== o.order_id && x.expected_amount === p.amount);
          if (other) {
            add({ type: "suspicious_mapping", orderId: o.order_id, orderCustomer: o.customer, expectedAmount: o.expected_amount, orderStatus: o.order_status, paymentId: p.payment_id, receivedAmount: p.amount, paymentStatus: p.status, refundAmount: p.refund_amount, difference: p.amount - o.expected_amount, matchedOrderId: other.order_id });
          } else {
            add({ type: "amount_mismatch", orderId: o.order_id, orderCustomer: o.customer, expectedAmount: o.expected_amount, orderStatus: o.order_status, paymentId: p.payment_id, receivedAmount: p.amount, paymentStatus: p.status, refundAmount: p.refund_amount, difference: p.amount - o.expected_amount });
          }
        }
      }
    }

    for (const p of payments) {
      if (!p.order_id || !orderMap.has(p.order_id)) {
        add({ type: "missing_order", orderId: "", orderCustomer: p.customer, expectedAmount: 0, orderStatus: "", paymentId: p.payment_id, receivedAmount: p.amount, paymentStatus: p.status, refundAmount: p.refund_amount, difference: 0 });
      }
    }

    issues.forEach((iss) => {
      const order = iss.orderId ? orderMap.get(iss.orderId) : null;
      const payment = iss.paymentId ? payments.find((p) => p.payment_id === iss.paymentId) : null;
      iss.typeLabel = TYPES[iss.type];
      iss.recommendation = RECOMMENDATIONS[iss.type];
      iss.severity = severityFor(iss.type, order || { expected_amount: iss.expectedAmount }, payment || { amount: iss.receivedAmount, refund_amount: iss.refundAmount });
      iss.amount = amountAtStake(iss.type, { expected_amount: iss.expectedAmount }, payment || { amount: iss.receivedAmount, refund_amount: iss.refundAmount });
    });

    issues.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.amount - a.amount);
    return issues;
  }

  function generateInvestigation(iss) {
    const fmt = fmtINR;
    const order = iss.orderId;
    const pay = iss.paymentId;
    let what, why, action, classification, confidence;
    switch (iss.type) {
      case "missing_payment":
        what = `${iss.orderCustomer} placed order ${order} for ${fmt(iss.expectedAmount)}, but no successful payment record exists for this order in the payment dataset.`;
        why = "The order may have been paid through a channel that was not recorded, or the payment reference may have been entered incorrectly. Until confirmed, this order shows as unpaid in the books.";
        action = "Check bank statements and gateway logs for this amount and customer, then either link the missing payment or follow up with the customer.";
        classification = "Order without a matching successful payment";
        confidence = 0.86;
        break;
      case "amount_mismatch":
        what = `A payment of ${fmt(iss.receivedAmount)} was captured for order ${order}, but the expected amount is ${fmt(iss.expectedAmount)}. The difference is ${fmt(Math.abs(iss.difference))}.`;
        why = "The order may have been partially paid, a discount or coupon may not be reflected, or the internal order amount may be incorrect.";
        action = "Verify whether a discount or partial payment was intentionally applied before adjusting the order.";
        classification = "Payment amount differs from the expected order amount";
        confidence = 0.87;
        break;
      case "duplicate_payment":
        what = `Order ${order} has two captured payments of ${fmt(iss.receivedAmount)} each. Only one payment is expected for this order.`;
        why = "The customer may have been charged twice, or one of the payments may belong to a different order.";
        action = "Verify both payment references in the gateway. If one is a duplicate, prepare a refund after confirmation.";
        classification = "Multiple captured payments for a single order";
        confidence = 0.9;
        break;
      case "cancelled_order_paid":
        what = `Order ${order} was cancelled, but a payment of ${fmt(iss.receivedAmount)} was still captured and linked to it.`;
        why = "Money moved even though the order was cancelled. This needs manual review before any refund or status change.";
        action = "Verify the payment in the gateway and prepare a refund if the order was truly cancelled.";
        classification = "Captured payment associated with a cancelled order";
        confidence = 0.92;
        break;
      case "missing_order":
        what = `A payment of ${fmt(iss.receivedAmount)} from ${iss.orderCustomer} was captured, but no order in the dataset references payment ${pay}.`;
        why = "This payment has no home in the order records. It could be an unrecorded order, a prepayment, or a mislinked reference.";
        action = "Search for the customer and amount in the order system and link the payment to the correct order.";
        classification = "Payment with no matching order";
        confidence = 0.9;
        break;
      case "refund_mismatch":
        what = `Payment ${pay} shows a refund of ${fmt(iss.refundAmount)}, but order ${order} is still marked as paid with no refund recorded.`;
        why = "The books may still show the order as paid after money was returned, which overstates revenue.";
        action = "Update the order status to refunded and reconcile the refund amount in the internal records.";
        classification = "Refunded payment still recorded as fully paid";
        confidence = 0.88;
        break;
      case "suspicious_mapping":
        what = `Payment ${pay} of ${fmt(iss.receivedAmount)} is linked to order ${order}, but the amount exactly matches order ${iss.matchedOrderId}. The link to ${order} may be wrong.`;
        why = "A payment linked to the wrong order can hide a missing payment and create a false match elsewhere.";
        action = "Verify the payment reference in the gateway and remap it to the correct order.";
        classification = "Payment amount matches a different order";
        confidence = 0.85;
        break;
      case "incorrect_status":
        what = `Order ${order} is marked paid, but the linked payment ${pay} has status ${iss.paymentStatus}.`;
        why = "A failed payment treated as successful can show revenue that never arrived.";
        action = "Confirm the payment status in the gateway and correct the order status.";
        classification = "Order and payment statuses conflict";
        confidence = 0.9;
        break;
      default:
        what = `Reconciliation issue ${iss.id} requires manual review.`;
        why = "The deterministic engine flagged a mismatch between the order and payment records.";
        action = "Inspect the records in the gateway and update the internal records to match.";
        classification = "Unclassified discrepancy";
        confidence = 0.8;
    }
    return {
      classification, severity: iss.severity,
      explanation: what + " " + action,
      what_happened: what, why_it_matters: why, recommended_action: action,
      confidence: Math.round(confidence * 100), aiSource: "builtin",
      verified: {
        orderId: iss.orderId || null, paymentId: iss.paymentId || null,
        expectedAmount: iss.expectedAmount, receivedAmount: iss.receivedAmount,
        difference: iss.difference, refundAmount: iss.refundAmount,
        orderStatus: iss.orderStatus, paymentStatus: iss.paymentStatus, customer: iss.orderCustomer
      }
    };
  }

  function buildSummary(orders, payments, issues) {
    const withIssue = new Set(issues.filter((i) => i.orderId).map((i) => i.orderId));
    const matched = orders.length - withIssue.size;
    const open = issues.filter((i) => i.state === "open");
    const resolved = issues.filter((i) => i.state === "resolved");
    const reviewed = issues.filter((i) => i.state === "reviewed");
    const unresolvedAmount = open.reduce((s, i) => s + i.amount, 0);
    const totalPaymentsAmount = payments.reduce((s, p) => s + p.amount, 0);
    const refundAmount = payments.reduce((s, p) => s + p.refund_amount, 0);
    const healthScore = orders.length ? Math.round((matched / orders.length) * 100) : 0;
    const byType = {};
    issues.forEach((i) => { byType[i.typeLabel] = (byType[i.typeLabel] || 0) + 1; });
    const topType = Object.entries(byType).sort((a, b) => b[1] - a[1])[0];
    const aiSummary =
      `${orders.length} orders were compared against ${payments.length} payment records. ` +
      `${matched} records matched automatically. ${issues.length} discrepancies require attention. ` +
      `${topType ? `The most common issue is ${topType[0].toLowerCase()} (${topType[1]} cases). ` : ""}` +
      `${fmtINR(unresolvedAmount)} may require review.`;
    return {
      orders: orders.length, payments: payments.length, totalPaymentsAmount, matched,
      issues: issues.length, open: open.length, resolved: resolved.length, reviewed: reviewed.length,
      unresolvedAmount, refundAmount, healthScore,
      healthLabel: healthScore >= 90 ? "Healthy" : healthScore >= 70 ? "Needs attention" : "At risk",
      aiSummary, byType
    };
  }

  /* ------------------------- CSV parsing ------------------------- */
  function splitRow(line) {
    const out = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
        else cur += c;
      } else if (c === '"') inQ = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out;
  }

  function parseCSV(text) {
    const lines = String(text).replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) throw new Error("The file is empty");
    const headers = splitRow(lines[0]).map((h) => h.trim());
    return lines.slice(1).filter((l) => l.trim()).map((l) => {
      const cells = splitRow(l);
      const row = {};
      headers.forEach((h, i) => { row[h] = cells[i] !== undefined ? cells[i].trim() : ""; });
      return row;
    });
  }

  /* ------------------------- Local state ------------------------- */
  const L = {
    orders: [], payments: [], issues: [], summary: null,
    source: null, lastReconciledAt: null, history: []
  };

  function reconcile() {
    L.issues = detectIssues(L.orders, L.payments);
    L.summary = buildSummary(L.orders, L.payments, L.issues);
    L.lastReconciledAt = new Date().toISOString();
  }

  // Rebuilds only the summary. Used after review, resolve, and note so the
  // existing issue states are preserved, matching the backend behavior.
  function refreshSummary() {
    L.summary = buildSummary(L.orders, L.payments, L.issues);
  }

  function loadDemo() {
    const raw = (typeof window !== "undefined" && window.SETTLE_DEMO) || { orders: [], payments: [] };
    L.orders = normalizeOrders(raw.orders);
    L.payments = normalizePayments(raw.payments);
    L.source = "demo";
    L.history = [];
    reconcile();
  }

  // Preload the demo so the standalone app is instantly populated.
  loadDemo();

  /* ------------------------- Tools and agent ------------------------- */
  const tools = {
    get_reconciliation_summary(s) {
      return `${s.summary.orders} orders, ${s.summary.payments} payments, ${s.summary.matched} matched, ${s.summary.open} open issues, ${fmtINR(s.summary.unresolvedAmount)} unresolved.`;
    },
    get_issue_list(s, opts) {
      opts = opts || {};
      return s.issues.filter((i) =>
        (!opts.severity || i.severity === opts.severity) &&
        (!opts.status || i.state === opts.status) &&
        (!opts.type || i.type === opts.type)).slice(0, opts.limit || 10);
    },
    get_issue_details(s, id) { return s.issues.find((i) => i.id.toLowerCase() === String(id).toLowerCase()); },
    get_order(s, id) { return s.orders.find((o) => o.order_id.toLowerCase() === String(id).toLowerCase()); },
    get_payment(s, id) { return s.payments.find((p) => p.payment_id.toLowerCase() === String(id).toLowerCase()); },
    calculate_unresolved_amount(s) {
      const open = s.issues.filter((i) => i.state === "open");
      return { count: open.length, amount: open.reduce((sum, i) => sum + i.amount, 0) };
    },
    get_high_value_issues(s, limit) {
      return s.issues.filter((i) => i.state === "open").sort((a, b) => b.amount - a.amount).slice(0, limit || 5);
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
        `${sum.matched} records matched automatically and ${sum.open} issues are still open, representing ${fmtINR(sum.unresolvedAmount)} in unresolved value.`,
        `The largest concentration is ${top ? top[0].toLowerCase() : "none"} with ${top ? top[1] : 0} cases.`,
        `Highest value open cases: ${steps.map((i) => `${i.id} for ${fmtINR(i.amount)}`).join(", ")}.`,
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

  function issueLines(s, issues) {
    return issues.map((i) => `${i.id} ${i.typeLabel} on ${i.orderId || i.paymentId} for ${fmtINR(i.amount)}, ${i.severity.toUpperCase()} severity`).join(". ") + ".";
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
        const inv = generateInvestigation(issue);
        references = [issue.id];
        return { answer: `${issue.id} is a ${issue.typeLabel.toLowerCase()} on ${issue.orderId || "no order"} worth ${fmtINR(issue.amount)}. ${inv.what_happened} ${inv.recommended_action}`, references, toolsUsed, aiSource: "builtin" };
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
        return { answer: `${order.order_id} belongs to ${order.customer}, expected ${fmtINR(order.expected_amount)}, order status ${order.order_status}. ${issues.length ? `It has ${issues.length} flagged issue${issues.length > 1 ? "s" : ""}: ${issueLines(s, issues)}` : "No issues are flagged for this order."}`, references, toolsUsed, aiSource: "builtin" };
      }
    }
    const pay = message.match(/pay_[a-z0-9]+/i);
    if (pay) {
      use("get_payment");
      const payment = tools.get_payment(s, pay[0]);
      if (payment) {
        const issues = s.issues.filter((i) => i.paymentId === payment.payment_id);
        references = issues.map((i) => i.id);
        return { answer: `${payment.payment_id} is a ${payment.status} payment of ${fmtINR(payment.amount)} from ${payment.customer}${payment.order_id ? ` linked to ${payment.order_id}` : " with no linked order"}. ${issues.length ? `It is part of ${issues.length} flagged issue${issues.length > 1 ? "s" : ""}.` : ""}`, references, toolsUsed, aiSource: "builtin" };
      }
    }

    const explainLargest = /\b(explain|what happened|tell me about|why is)\b/.test(m) && /\b(biggest|largest|big|top)\b/.test(m);
    if (explainLargest) {
      use("get_high_value_issues");
      use("get_issue_details");
      const target = s.issues.filter((i) => i.state === "open").sort((a, b) => b.amount - a.amount)[0];
      if (target) {
        const inv = generateInvestigation(target);
        references = [target.id];
        return { answer: `${target.id} is the largest open issue, worth ${fmtINR(target.amount)}. ${inv.what_happened} ${inv.why_it_matters} Recommended action: ${inv.recommended_action} Confidence ${inv.confidence} percent.`, references, toolsUsed, aiSource: "builtin" };
      }
    }

    if (/\b(why|explain|what happened|go on|tell me more)\b/.test(m) && live) {
      use("get_issue_details");
      const inv = generateInvestigation(live);
      references = [live.id];
      return { answer: `For ${live.id}: ${inv.what_happened} ${inv.why_it_matters} Recommended action: ${inv.recommended_action} Confidence ${inv.confidence} percent.`, references, toolsUsed, aiSource: "builtin" };
    }

    if (/what should i do|what do i do|next step|how do i fix/.test(m)) {
      use("get_issue_list");
      use("calculate_unresolved_amount");
      const high = s.issues.filter((i) => i.state === "open" && (i.severity === "high" || i.severity === "critical"));
      references = high.map((i) => i.id);
      const u = tools.calculate_unresolved_amount(s);
      const steps = high.length
        ? `Start with the ${high.length} high severity cases worth ${fmtINR(high.reduce((x, i) => x + i.amount, 0))}. ${high.map((i) => `${i.id} recommends ${i.recommendation.toLowerCase()}`).join(". ")}.`
        : `No high severity cases are open, but ${fmtINR(u.amount)} is still unresolved.`;
      return { answer: `${steps} After that, clear the quick wins such as incorrect statuses and refund mismatches by updating the order statuses, then re run reconciliation.`, references, toolsUsed, aiSource: "builtin" };
    }

    if (/urgent|attention|immediate|priority|what needs|needs my attention/.test(m)) {
      use("get_issue_list");
      use("calculate_unresolved_amount");
      const high = s.issues.filter((i) => i.state === "open" && (i.severity === "high" || i.severity === "critical"));
      const u = tools.calculate_unresolved_amount(s);
      if (high.length) {
        references = high.map((i) => i.id);
        return { answer: `${high.length} high severity case${high.length > 1 ? "s" : ""} need${high.length > 1 ? "" : "s"} attention: ${issueLines(s, high)} Together they represent ${fmtINR(high.reduce((x, i) => x + i.amount, 0))}. These should be manually verified before any refund or order status change.`, references, toolsUsed, aiSource: "builtin" };
      }
      return { answer: `No high severity cases are open. ${fmtINR(u.amount)} is still unresolved across ${u.count} medium and low severity issues.`, references: [], toolsUsed, aiSource: "builtin" };
    }

    if (/unresolved|how much money|outstanding|at risk/.test(m)) {
      use("calculate_unresolved_amount");
      const u = tools.calculate_unresolved_amount(s);
      const largest = tools.get_high_value_issues(s, 1)[0];
      return { answer: `${fmtINR(u.amount)} is currently unresolved across ${u.count} open issues. The largest is ${largest ? `${largest.id} at ${fmtINR(largest.amount)}` : "none"}.`, references: largest ? [largest.id] : [], toolsUsed, aiSource: "builtin" };
    }

    if (/largest|biggest|highest|high value|risk|show me the top/.test(m)) {
      use("get_high_value_issues");
      const top = tools.get_high_value_issues(s, 5);
      references = top.map((i) => i.id);
      return { answer: `The highest value open issues are: ${issueLines(s, top)}`, references, toolsUsed, aiSource: "builtin" };
    }

    const historyRefs = [...history].reverse().map((h) => h.references || []).flat();
    if (/\b(those|them|that case|these cases)\b/.test(m) && historyRefs.length) {
      use("get_issue_details");
      const list = s.issues.filter((i) => historyRefs.includes(i.id));
      references = list.map((i) => i.id);
      if (list.length) return { answer: `Here are the cases you asked about: ${issueLines(s, list)}`, references, toolsUsed, aiSource: "builtin" };
    }

    if (/breakdown|most common|common failure|category|types of|distribution/.test(m)) {
      use("get_issue_breakdown");
      const b = tools.get_issue_breakdown(s);
      return { answer: `The most common reconciliation failures are: ${b.map(([t, n]) => `${n} ${t.toLowerCase()}`).join(", ")}.`, references: [], toolsUsed, aiSource: "builtin" };
    }

    if (/suspicious|wrong order|mislink|mapping/.test(m)) {
      use("get_issue_list");
      const list = tools.get_issue_list(s, { type: "suspicious_mapping" });
      references = list.map((i) => i.id);
      return { answer: list.length ? `Suspicious payment mappings found: ${issueLines(s, list)} Each links a payment to an order whose expected amount does not match, while the amount matches a different order.` : "No suspicious payment mappings exist in the current dataset.", references, toolsUsed, aiSource: "builtin" };
    }

    if (/summary|report|finance team|send to/.test(m)) {
      use("generate_finance_summary");
      return { answer: tools.generate_finance_summary(s), references: [], toolsUsed, aiSource: "builtin" };
    }

    if (/resolve|quickly|easy|fast|clear/.test(m)) {
      use("get_issue_list");
      const quick = s.issues.filter((i) => i.state === "open" && (i.type === "incorrect_status" || i.type === "refund_mismatch"));
      references = quick.map((i) => i.id);
      return { answer: quick.length ? `Issues that can be resolved quickly: ${issueLines(s, quick)} Each needs only a status update after verification in the gateway.` : "No low effort issues are open right now. Review the high severity cases first.", references, toolsUsed, aiSource: "builtin" };
    }

    if (/what'?s wrong|what is wrong|needs my attention|what needs|health|status of|overview/.test(m)) {
      use("get_reconciliation_summary");
      use("get_high_value_issues");
      const top = tools.get_high_value_issues(s, 3);
      references = top.map((i) => i.id);
      return { answer: `${s.summary.aiSummary} The three highest value open issues are: ${issueLines(s, top)}`, references, toolsUsed, aiSource: "builtin" };
    }

    use("get_reconciliation_summary");
    return { answer: `${tools.get_reconciliation_summary(s)} Ask me what needs attention, where the largest mismatch is, how much money is unresolved, or for a summary you can send to your finance team.`, references: [], toolsUsed, aiSource: "builtin" };
  }

  function agentReply(message, history) {
    const s = { orders: L.orders, payments: L.payments, issues: L.issues, summary: L.summary };
    const reply = builtInReply(s, message, history);
    return Object.assign(reply, { fallbackUsed: false });
  }

  /* ------------------------- API handlers ------------------------- */
  function payload() {
    return { source: L.source, lastReconciledAt: L.lastReconciledAt, summary: L.summary, issues: L.issues, orders: L.orders, payments: L.payments };
  }

  function issueMap() {
    const m = new Map();
    L.issues.forEach((i) => { if (i.orderId) m.set(i.orderId, i); });
    return m;
  }

  function payIssueMap() {
    const m = new Map();
    L.issues.forEach((i) => { if (i.paymentId) m.set(i.paymentId, i); });
    return m;
  }

  function handler(method, url, body) {
    // POST routes
    if (method === "POST") {
      if (url === "/api/demo") { loadDemo(); return payload(); }
      if (url === "/api/reconcile") {
        if (!L.orders.length && !L.payments.length) throw new Error("No data loaded. Upload files or load the demo dataset first.");
        reconcile();
        return payload();
      }
      if (url === "/api/import") {
        const rawOrders = (body && body.orders) ? parseCSV(body.orders) : [];
        const rawPayments = (body && body.payments) ? parseCSV(body.payments) : [];
        if (!rawOrders.length && !rawPayments.length) throw new Error("No records were found in the uploaded files");
        L.orders = normalizeOrders(rawOrders);
        L.payments = normalizePayments(rawPayments);
        if (!L.orders.length && !L.payments.length) throw new Error("The files contain no usable records");
        L.source = "upload"; L.history = []; L.summary = null; L.issues = []; L.lastReconciledAt = null;
        return { orders: L.orders.length, payments: L.payments.length, source: L.source };
      }
      const agent = url === "/api/agent";
      if (agent) {
        const message = String((body && body.message) || "").trim();
        if (!message) throw new Error("Please enter a message");
        L.history.push({ role: "user", content: message, references: [] });
        const reply = agentReply(message, L.history);
        L.history.push({ role: "assistant", content: reply.answer, references: reply.references });
        if (L.history.length > 30) L.history = L.history.slice(-30);
        return reply;
      }
      if (url === "/api/razorpay/import") throw new Error("Razorpay is not configured");
      const stateMatch = url.match(/^\/api\/issues\/([^/]+)\/(review|resolve|note)$/);
      if (stateMatch) {
        const issue = L.issues.find((i) => i.id === stateMatch[1]);
        if (!issue) throw new Error("Issue not found");
        if (stateMatch[2] === "review") issue.state = "reviewed";
        if (stateMatch[2] === "resolve") issue.state = "resolved";
        if (stateMatch[2] === "note" || (body && body.note)) issue.note = (body && body.note) || issue.note || "";
        refreshSummary();
        return issue;
      }
    }

    // GET routes
    if (url === "/api/status") {
      return {
        dataSource: L.source, loaded: L.source !== null, lastReconciledAt: L.lastReconciledAt,
        aiConfigured: false, aiMode: "built in reasoning engine", razorpayConfigured: false,
        counts: L.summary ? { orders: L.summary.orders, payments: L.summary.payments, issues: L.summary.issues, open: L.summary.open } : { orders: 0, payments: 0, issues: 0, open: 0 }
      };
    }
    if (url === "/api/health") return { ok: true, service: "settle" };
    if (url === "/api/reconciliation/summary") return L.summary || { empty: true };
    if (url === "/api/razorpay/status") return { configured: false, mode: "test mode" };

    if (/^\/api\/issues\?/.test(url) || url === "/api/issues") {
      const p = new URLSearchParams(url.split("?")[1] || "");
      const q = (p.get("q") || "").toLowerCase();
      const status = p.get("status") || "";
      const severity = p.get("severity") || "";
      const type = p.get("type") || "";
      return L.issues.filter((i) =>
        (!status || i.state === status) && (!severity || i.severity === severity) && (!type || i.type === type) &&
        (!q || i.id.toLowerCase().includes(q) || i.typeLabel.toLowerCase().includes(q) || (i.orderId || "").toLowerCase().includes(q) || (i.paymentId || "").toLowerCase().includes(q) || (i.orderCustomer || "").toLowerCase().includes(q)));
    }

    const detail = url.match(/^\/api\/issues\/([^/]+)$/);
    if (detail) {
      const issue = L.issues.find((i) => i.id === detail[1]);
      if (!issue) throw new Error("Issue not found");
      const order = issue.orderId ? L.orders.find((o) => o.order_id === issue.orderId) : null;
      const payment = issue.paymentId ? L.payments.find((p) => p.payment_id === issue.paymentId) : null;
      return { issue, investigation: generateInvestigation(issue), order, payment };
    }

    if (/^\/api\/orders\?/.test(url) || url === "/api/orders") {
      const q = (new URLSearchParams(url.split("?")[1] || "").get("q") || "").toLowerCase();
      const im = issueMap();
      let list = L.orders;
      if (q) list = list.filter((o) => o.order_id.toLowerCase().includes(q) || o.customer.toLowerCase().includes(q) || o.order_status.includes(q));
      return list.map((o) => {
        const iss = im.get(o.order_id);
        return Object.assign({}, o, {
          reconciliation_status: iss ? "Issue: " + iss.typeLabel : "Matched",
          issueId: iss ? iss.id : null,
          difference: iss && iss.type === "amount_mismatch" ? iss.difference : 0
        });
      });
    }

    if (/^\/api\/payments\?/.test(url) || url === "/api/payments") {
      const p = new URLSearchParams(url.split("?")[1] || "");
      const q = (p.get("q") || "").toLowerCase();
      const status = p.get("status") || "";
      const im = payIssueMap();
      let list = L.payments;
      if (status) list = list.filter((x) => x.status === status);
      if (q) list = list.filter((x) => x.payment_id.toLowerCase().includes(q) || x.order_id.toLowerCase().includes(q) || x.customer.toLowerCase().includes(q));
      return list.map((x) => {
        const iss = im.get(x.payment_id);
        return Object.assign({}, x, {
          match_status: iss ? "Issue: " + iss.typeLabel : (x.order_id ? "Matched" : "Unlinked"),
          issueId: iss ? iss.id : null
        });
      });
    }

    if (/^\/api\/search\?/.test(url)) {
      return tools.search({ issues: L.issues, orders: L.orders, payments: L.payments }, new URLSearchParams(url.split("?")[1]).get("q") || "");
    }

    if (url === "/api/report") {
      if (!L.summary) throw new Error("No reconciliation data yet. Load the demo dataset to generate a report.");
      const dates = L.orders.map((o) => o.order_date).filter(Boolean).sort();
      const breakdown = Object.entries(L.summary.byType).map(([type, count]) => ({ type, count }));
      return {
        period: { from: dates[0] || "", to: dates[dates.length - 1] || "" },
        totalOrders: L.summary.orders, totalPayments: L.summary.payments,
        matched: L.summary.matched, unmatched: L.summary.issues, discrepancies: L.summary.issues,
        unresolvedAmount: L.summary.unresolvedAmount, refundAmount: L.summary.refundAmount,
        breakdown, aiSummary: L.summary.aiSummary, generatedAt: new Date().toISOString(), issues: L.issues
      };
    }

    throw new Error("Unknown request: " + url);
  }

  const SETTLE_LOCAL = {
    handler, detectIssues, generateInvestigation, buildSummary,
    normalizeOrders, normalizePayments, parseCSV, fmtINR, agentReply, getState: () => L
  };

  if (typeof window !== "undefined") window.SETTLE_LOCAL = SETTLE_LOCAL;
  if (typeof module !== "undefined" && module.exports) module.exports = SETTLE_LOCAL;
})();