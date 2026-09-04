// Deterministic demo dataset for SETTLE.
// Generates 127 orders and 124 payments with 27 deliberately designed
// reconciliation problems. Same seed, same data, every run.

const NAMES = [
  "Rahul Sharma", "Priya Patel", "Amit Verma", "Sneha Iyer", "Vikram Singh",
  "Ananya Gupta", "Rohan Mehta", "Kavya Nair", "Arjun Reddy", "Pooja Kulkarni",
  "Sanjay Das", "Meera Krishnan", "Nikhil Joshi", "Divya Menon", "Karan Malhotra",
  "Ishita Bose", "Aditya Kulkarni", "Neha Agarwal", "Suresh Babu", "Lakshmi Rao",
  "Manish Tiwari", "Ritu Saxena", "Deepak Choudhary", "Shruti Kapoor", "Harsha Vardhan",
  "Anjali Desai", "Gaurav Khanna", "Tanya Bhatia", "Ravi Shankar", "Nidhi Verma",
  "Kunal Shah", "Pallavi Iyer", "Ramesh Iyer", "Aishwarya Nair", "Siddharth Pillai",
  "Farah Khan", "Mohit Agarwal", "Geeta Devi", "Prakash Yadav", "Swati Mishra"
];

const AMOUNTS = [
  499, 649, 799, 899, 999, 1099, 1299, 1499, 1749, 1849, 1999, 2150, 2499,
  2999, 3299, 3499, 3999, 4499, 4999, 5499, 5999, 6499, 6999, 7999, 8999,
  9499, 9999, 11249, 12499, 13999, 14999, 17999, 18999, 24999
];

// Small deterministic PRNG so the dataset is identical on every run.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pad(n, w) { return String(n).padStart(w, "0"); }

function buildDemo() {
  const rng = mulberry32(20260904);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const pickN = (n) => {
    const arr = [];
    for (let i = 0; i < n; i++) arr.push(pick(AMOUNTS));
    return arr;
  };
  const hex8 = () => {
    let s = "";
    for (let i = 0; i < 8; i++) s += "0123456789abcdef"[Math.floor(rng() * 16)];
    return s;
  };
  // Orders land across the last 30 days before Sep 3 2026.
  const base = Date.UTC(2026, 7, 5);
  const dayMs = 86400000;
  const orderDate = (i) => new Date(base + Math.floor(rng() * 30) * dayMs + Math.floor(rng() * 12) * 3600000);

  // Scenario sizes (27 issues total, 7 of the 8 supported types present).
  const N = 127;
  const CANCELLED = 3;   // amounts 7999, 5999, 4499 sum to 18497
  const MISSING_PAY = 9; // 8 planned + 1 exposed by the suspicious mapping case
  const MISMATCH = 5;
  const DUPLICATE = 3;
  const REFUND = 2;
  const SUSPICIOUS = 1;
  const INCORRECT = 1;
  const PENDING = 3;

  // ORD1099 (index 98) must be the order whose payment got mislinked, so it
  // ends up in the missing payment set.
  const RESERVED = 98;
  const pool = Array.from({ length: N }, (_, i) => i).filter((i) => i !== RESERVED);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const take = (n) => pool.splice(0, n);

  const cancelledIds = take(CANCELLED);
  const missingPayIds = take(MISSING_PAY - 1).concat(RESERVED);
  const mismatchIds = take(MISMATCH);
  const duplicateIds = take(DUPLICATE);
  const refundIds = take(REFUND);
  const suspiciousId = take(SUSPICIOUS)[0];
  const incorrectId = take(INCORRECT)[0];
  const pendingIds = take(PENDING);
  const cleanIds = pool; // everything left

  const orders = [];
  const payments = [];
  let paySeq = 0;
  const payment = (orderId, amount, status, customer, ts, refund) => {
    paySeq++;
    payments.push({
      payment_id: "pay_" + hex8(),
      order_id: orderId || "",
      amount,
      status,
      customer: customer || pick(NAMES),
      timestamp: (ts || orderDate(paySeq)).toISOString(),
      refund_amount: refund || 0
    });
  };

  for (let i = 0; i < N; i++) {
    const id = "ORD" + (1001 + i);
    let expected = pick(AMOUNTS);
    let status = "paid";
    if (cancelledIds.includes(i)) status = "cancelled";
    else if (pendingIds.includes(i)) status = "pending";
    orders.push({ order_id: id, customer: pick(NAMES), expected_amount: expected, order_status: status, order_date: orderDate(i).toISOString() });
  }

  const orderById = (id) => orders.find((o) => o.order_id === id);

  // Clean orders: one captured payment matching the expected amount.
  cleanIds.forEach((i) => {
    const o = orderById("ORD" + (1001 + i));
    payment(o.order_id, o.expected_amount, "captured", o.customer);
  });

  // Pending orders: a pending payment, consistent with the order status.
  pendingIds.forEach((i) => {
    const o = orderById("ORD" + (1001 + i));
    payment(o.order_id, o.expected_amount, "pending", o.customer);
  });

  // Missing payment: order exists, no payment record at all.
  missingPayIds.forEach((i) => { /* intentionally no payment */ });

  // Amount mismatch: captured payment is lower than the expected amount.
  // Odd deltas keep the received amounts outside the standard price pool so
  // the engine never confuses them for a suspicious mapping.
  const deltas = [555, 555, 333, 444, 222];
  mismatchIds.forEach((i, k) => {
    const o = orderById("ORD" + (1001 + i));
    payment(o.order_id, o.expected_amount - deltas[k], "captured", o.customer);
  });

  // Duplicate payment: two captured payments for one order.
  pickN(DUPLICATE).forEach((amt, k) => {
    const o = orderById("ORD" + (1001 + duplicateIds[k]));
    payment(o.order_id, amt, "captured", o.customer);
    payment(o.order_id, amt, "captured", o.customer);
  });

  // Cancelled order paid: money captured after the order was cancelled.
  [7999, 5999, 4499].forEach((amt, k) => {
    const o = orderById("ORD" + (1001 + cancelledIds[k]));
    o.expected_amount = amt;
    payment(o.order_id, amt, "captured", o.customer);
  });

  // Refund mismatch: payment refunded but the order is still marked paid.
  [1999, 2499].forEach((amt, k) => {
    const o = orderById("ORD" + (1001 + refundIds[k]));
    o.expected_amount = amt;
    payment(o.order_id, amt, "refunded", o.customer, null, k === 0 ? 499 : 799);
  });

  // Suspicious mapping: payment linked to ORD1120 but its amount exactly
  // matches ORD1099, which then correctly shows up as a missing payment.
  const target = orderById("ORD1099");
  const source = orderById("ORD" + (1001 + suspiciousId));
  source.expected_amount = 5499;
  payment(source.order_id, target.expected_amount, "captured", source.customer);

  // Incorrect status: order marked paid but the linked payment failed.
  const bad = orderById("ORD" + (1001 + incorrectId));
  bad.expected_amount = 1499;
  payment(bad.order_id, 1499, "failed", bad.customer);

  // Missing order: captured payments with no order anywhere in the dataset.
  [4999, 2499, 1299].forEach((amt) => payment("", amt, "captured", pick(NAMES)));

  return { orders, payments };
}

function toCsv(orders, payments) {
  const esc = (v) => '"' + String(v).replace(/"/g, '""') + '"';
  const orderCsv = ["order_id,customer,expected_amount,order_status,order_date"]
    .concat(orders.map((o) => [o.order_id, esc(o.customer), o.expected_amount, o.order_status, o.order_date].join(",")))
    .join("\n");
  const payCsv = ["payment_id,order_id,amount,status,customer,timestamp,refund_amount"]
    .concat(payments.map((p) => [p.payment_id, p.order_id, p.amount, p.status, esc(p.customer), p.timestamp, p.refund_amount].join(",")))
    .join("\n");
  return { orderCsv, payCsv };
}

module.exports = { buildDemo, toCsv, NAMES, AMOUNTS };