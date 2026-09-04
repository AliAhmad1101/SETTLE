// SETTLE reconciliation engine.
// Deterministic matching and issue detection. All arithmetic lives here;
// the AI layer only interprets these results and never invents numbers.

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

function norm(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    const key = k.toLowerCase().replace(/[\s_]/g, "").replace("paymentid", "pid");
    out[key] = typeof v === "string" ? v.trim() : v;
  }
  return out;
}

function normalizeOrders(raw) {
  return raw.map((r, i) => {
    const x = norm(r);
    return {
      order_id: String(x.orderid || x.id || "ORD-" + i),
      customer: String(x.customer || "Unknown customer"),
      expected_amount: num(x.expectedamount ?? x.amount),
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
      refund_amount: num(x.refundamount ?? x.refund)
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

// Deterministic rule based investigation. Used as the built in AI and as the
// offline fallback when a live model is configured but unreachable.
function generateInvestigation(iss) {
  const fmt = (n) => "₹" + Math.round(n).toLocaleString("en-IN");
  const orderId = iss.orderId || "no order";
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
    classification,
    severity: iss.severity,
    explanation: `${what} ${action}`,
    what_happened: what,
    why_it_matters: why,
    recommended_action: action,
    confidence: Math.round(confidence * 100),
    aiSource: "builtin",
    verified: {
      orderId: iss.orderId || null,
      paymentId: iss.paymentId || null,
      expectedAmount: iss.expectedAmount,
      receivedAmount: iss.receivedAmount,
      difference: iss.difference,
      refundAmount: iss.refundAmount,
      orderStatus: iss.orderStatus,
      paymentStatus: iss.paymentStatus,
      customer: iss.orderCustomer
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
    orders: orders.length,
    payments: payments.length,
    totalPaymentsAmount,
    matched,
    issues: issues.length,
    open: open.length,
    resolved: resolved.length,
    reviewed: reviewed.length,
    unresolvedAmount,
    refundAmount,
    healthScore,
    healthLabel: healthScore >= 90 ? "Healthy" : healthScore >= 70 ? "Needs attention" : "At risk",
    aiSummary,
    byType
  };
}

function fmtINR(n) { return "₹" + Math.round(n).toLocaleString("en-IN"); }

module.exports = { normalizeOrders, normalizePayments, detectIssues, generateInvestigation, buildSummary, TYPES, RECOMMENDATIONS, fmtINR, num };