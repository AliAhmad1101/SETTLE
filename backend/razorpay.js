// Optional Razorpay integration layer.
// SETTLE runs completely without these credentials. When Razorpay test mode
// keys are present in .env the server can pull real payment records from the
// Razorpay API instead of the demo dataset.

const RAZORPAY_URL = "https://api.razorpay.com/v1";

function isConfigured(env) {
  return !!(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
}

async function fetchPayments(env) {
  if (!isConfigured(env)) throw new Error("Razorpay is not configured");
  const auth = "Basic " + Buffer.from(env.RAZORPAY_KEY_ID + ":" + env.RAZORPAY_KEY_SECRET).toString("base64");
  const res = await fetch(`${RAZORPAY_URL}/payments?count=100`, {
    headers: { Authorization: auth, "Content-Type": "application/json" }
  });
  if (!res.ok) throw new Error("Razorpay API returned " + res.status);
  const data = await res.json();
  return (data.items || []).map((p) => ({
    payment_id: p.id,
    order_id: p.order_id || "",
    amount: (p.amount || 0) / 100,
    status: p.status,
    customer: (p.notes && (p.notes.customer || p.notes.email)) || "Razorpay customer",
    timestamp: new Date((p.created_at || Date.now()) * 1000).toISOString(),
    refund_amount: (p.amount_refunded || 0) / 100
  }));
}

module.exports = { isConfigured, fetchPayments };