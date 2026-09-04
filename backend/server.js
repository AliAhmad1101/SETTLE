// SETTLE API server. Serves the frontend, keeps in-memory reconciliation
// state, and exposes the API used by the UI and the AI agent.

const path = require("path");
const fs = require("fs");
const express = require("express");
const demo = require("./demo");
const engine = require("./engine");
const ai = require("./ai");
const razorpay = require("./razorpay");

// ---------------------------------------------------------------------------
// Minimal .env loader (no dependency). Real values never leave the server.
// ---------------------------------------------------------------------------
try {
  const envFile = path.join(__dirname, "..", ".env");
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  }
} catch (e) { /* ignore */ }

const config = {
  aiApiKey: process.env.AI_API_KEY,
  aiBaseUrl: process.env.AI_BASE_URL,
  aiModel: process.env.AI_MODEL,
  razorpayKeyId: process.env.RAZORPAY_KEY_ID,
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  source: null,          // "demo" | "upload" | "razorpay"
  orders: [],
  payments: [],
  issues: [],
  summary: null,
  lastReconciledAt: null,
  history: []            // agent conversation
};

function reconcile() {
  state.issues = engine.detectIssues(state.orders, state.payments);
  state.summary = engine.buildSummary(state.orders, state.payments, state.issues);
  state.lastReconciledAt = new Date().toISOString();
}

function loadDemo() {
  const { orders, payments } = demo.buildDemo();
  state.orders = engine.normalizeOrders(orders);
  state.payments = engine.normalizePayments(payments);
  state.source = "demo";
  state.history = [];
  reconcile();
}

function payload() {
  return {
    source: state.source,
    lastReconciledAt: state.lastReconciledAt,
    summary: state.summary,
    issues: state.issues,
    orders: state.orders,
    payments: state.payments
  };
}

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------
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
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new Error("The file is empty");
  const headers = splitRow(lines[0]).map((h) => h.trim());
  return lines.slice(1).filter((l) => l.trim()).map((l) => {
    const cells = splitRow(l);
    const row = {};
    headers.forEach((h, i) => { row[h] = cells[i] !== undefined ? cells[i].trim() : ""; });
    return row;
  });
}

function importCsvs(ordersText, paymentsText) {
  const rawOrders = ordersText ? parseCSV(ordersText) : [];
  const rawPayments = paymentsText ? parseCSV(paymentsText) : [];
  if (rawOrders.length === 0 && rawPayments.length === 0) throw new Error("No records were found in the uploaded files");
  const orders = engine.normalizeOrders(rawOrders);
  const payments = engine.normalizePayments(rawPayments);
  if (!orders.length && !payments.length) throw new Error("The files contain no usable records");
  return { orders, payments };
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: "10mb" }));
// Permissive CORS so the frontend also works when opened from a different
// origin (for example file:// or a static file server on another port).
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.static(path.join(__dirname, "..", "frontend")));

const wrap = (fn) => (req, res) => {
  try {
    const out = fn(req, res);
    if (out && typeof out.catch === "function") out.catch((e) => res.status(400).json({ error: e.message || "Something went wrong. Please try again." }));
  } catch (e) {
    res.status(400).json({ error: e.message || "Something went wrong. Please try again." });
  }
};

app.get("/api/health", (req, res) => res.json({ ok: true, service: "settle" }));

app.get("/api/status", (req, res) => {
  res.json({
    dataSource: state.source,
    loaded: state.source !== null,
    lastReconciledAt: state.lastReconciledAt,
    aiConfigured: !!config.aiApiKey,
    aiMode: config.aiApiKey ? "live model with built in fallback" : "built in reasoning engine",
    razorpayConfigured: razorpay.isConfigured(config),
    counts: state.summary
      ? { orders: state.summary.orders, payments: state.summary.payments, issues: state.summary.issues, open: state.summary.open }
      : { orders: 0, payments: 0, issues: 0, open: 0 }
  });
});

app.post("/api/demo", (req, res) => {
  loadDemo();
  res.json(payload());
});

app.post("/api/import", wrap((req, res) => {
  const { orders: ordersText, payments: paymentsText } = req.body || {};
  const { orders, payments } = importCsvs(ordersText, paymentsText);
  state.orders = orders;
  state.payments = payments;
  state.source = "upload";
  state.history = [];
  state.summary = null;
  state.issues = [];
  state.lastReconciledAt = null;
  res.json({ orders: orders.length, payments: payments.length, source: state.source });
}));

app.post("/api/reconcile", wrap((req, res) => {
  if (!state.orders.length && !state.payments.length) throw new Error("No data loaded. Upload files or load the demo dataset first.");
  reconcile();
  res.json(payload());
}));

app.get("/api/reconciliation/summary", (req, res) => {
  if (!state.summary) return res.json({ empty: true });
  res.json(state.summary);
});

app.get("/api/issues", (req, res) => {
  const { q = "", status = "", severity = "", type = "" } = req.query;
  const term = q.toLowerCase();
  let list = state.issues.filter((i) =>
    (!status || i.state === status) &&
    (!severity || i.severity === severity) &&
    (!type || i.type === type) &&
    (!term || i.id.toLowerCase().includes(term) || i.typeLabel.toLowerCase().includes(term) ||
      (i.orderId || "").toLowerCase().includes(term) || (i.paymentId || "").toLowerCase().includes(term) ||
      (i.orderCustomer || "").toLowerCase().includes(term)));
  res.json(list);
});

app.get("/api/issues/:id", wrap((req, res) => {
  const issue = state.issues.find((i) => i.id === req.params.id);
  if (!issue) throw new Error("Issue not found");
  const order = issue.orderId ? state.orders.find((o) => o.order_id === issue.orderId) : null;
  const payment = issue.paymentId ? state.payments.find((p) => p.payment_id === issue.paymentId) : null;
  res.json({ issue, investigation: engine.generateInvestigation(issue), order, payment });
}));

app.post("/api/issues/:id/review", wrap((req, res) => {
  const issue = state.issues.find((i) => i.id === req.params.id);
  if (!issue) throw new Error("Issue not found");
  issue.state = "reviewed";
  if (req.body && req.body.note) issue.note = req.body.note;
  state.summary = engine.buildSummary(state.orders, state.payments, state.issues);
  res.json(issue);
}));

app.post("/api/issues/:id/resolve", wrap((req, res) => {
  const issue = state.issues.find((i) => i.id === req.params.id);
  if (!issue) throw new Error("Issue not found");
  issue.state = "resolved";
  if (req.body && req.body.note) issue.note = req.body.note;
  state.summary = engine.buildSummary(state.orders, state.payments, state.issues);
  res.json(issue);
}));

app.post("/api/issues/:id/note", wrap((req, res) => {
  const issue = state.issues.find((i) => i.id === req.params.id);
  if (!issue) throw new Error("Issue not found");
  issue.note = (req.body && req.body.note) || "";
  res.json(issue);
}));

app.get("/api/orders", (req, res) => {
  const { q = "" } = req.query;
  const term = q.toLowerCase();
  let list = state.orders;
  if (term) list = list.filter((o) => o.order_id.toLowerCase().includes(term) || o.customer.toLowerCase().includes(term) || o.order_status.includes(term));
  const issueMap = new Map(state.issues.map((i) => [i.orderId, i]));
  res.json(list.map((o) => {
    const iss = issueMap.get(o.order_id);
    return Object.assign({}, o, { reconciliation_status: iss ? "Issue: " + iss.typeLabel : "Matched", issueId: iss ? iss.id : null, difference: iss && iss.type === "amount_mismatch" ? iss.difference : 0 });
  }));
});

app.get("/api/payments", (req, res) => {
  const { q = "", status = "" } = req.query;
  const term = q.toLowerCase();
  let list = state.payments;
  if (status) list = list.filter((p) => p.status === status);
  if (term) list = list.filter((p) => p.payment_id.toLowerCase().includes(term) || p.order_id.toLowerCase().includes(term) || p.customer.toLowerCase().includes(term));
  const issueMap = new Map(state.issues.map((i) => [i.paymentId, i]));
  res.json(list.map((p) => {
    const iss = issueMap.get(p.payment_id);
    return Object.assign({}, p, { match_status: iss ? "Issue: " + iss.typeLabel : (p.order_id ? "Matched" : "Unlinked"), issueId: iss ? iss.id : null });
  }));
});

app.get("/api/search", (req, res) => {
  const term = (req.query.q || "").toLowerCase();
  if (!term) return res.json({ issues: [], orders: [], payments: [] });
  res.json(ai.tools.search({ issues: state.issues, orders: state.orders, payments: state.payments }, term));
});

app.post("/api/agent", wrap(async (req, res) => {
  const message = String((req.body && req.body.message) || "").trim();
  if (!message) throw new Error("Please enter a message");
  state.history.push({ role: "user", content: message, references: [] });
  const reply = await ai.agentReply({ orders: state.orders, payments: state.payments, issues: state.issues, summary: state.summary }, message, state.history, config);
  state.history.push({ role: "assistant", content: reply.answer, references: reply.references });
  if (state.history.length > 30) state.history = state.history.slice(-30);
  res.json(reply);
}));

app.get("/api/report", (req, res) => {
  if (!state.summary) return res.status(400).json({ error: "No reconciliation data yet. Load the demo dataset to generate a report." });
  const dates = state.orders.map((o) => o.order_date).filter(Boolean).sort();
  const breakdown = Object.entries(state.summary.byType).map(([type, count]) => ({ type, count }));
  res.json({
    period: { from: dates[0] || "", to: dates[dates.length - 1] || "" },
    totalOrders: state.summary.orders,
    totalPayments: state.summary.payments,
    matched: state.summary.matched,
    unmatched: state.summary.issues,
    discrepancies: state.summary.issues,
    unresolvedAmount: state.summary.unresolvedAmount,
    refundAmount: state.summary.refundAmount,
    breakdown,
    aiSummary: state.summary.aiSummary,
    generatedAt: new Date().toISOString(),
    issues: state.issues
  });
});

app.get("/api/razorpay/status", (req, res) => {
  res.json({ configured: razorpay.isConfigured(config), mode: "test mode" });
});

app.post("/api/razorpay/import", wrap(async (req, res) => {
  const payments = await razorpay.fetchPayments(config);
  if (!payments.length) throw new Error("No payments were returned by Razorpay for this account");
  state.payments = engine.normalizePayments(payments);
  state.orders = state.orders.length ? state.orders : [];
  state.source = "razorpay";
  state.history = [];
  reconcile();
  res.json(payload());
}));

// Start fresh with the demo dataset so the first click always works.
loadDemo();

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log("SETTLE running at http://localhost:" + PORT);
  console.log("AI mode: " + (config.aiApiKey ? "live model with built in fallback" : "built in reasoning engine (no API key needed)"));
  console.log("Razorpay: " + (razorpay.isConfigured(config) ? "configured" : "not configured, demo mode only"));
});