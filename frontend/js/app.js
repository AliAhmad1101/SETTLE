"use strict";
/* SETTLE frontend. State, API client, hash router, page renderers, agent chat and actions. */

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
const $ = (sel, root) => (root || document).querySelector(sel);

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

const fmtINR = (n) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
const fmtNum = (n) => Number(n || 0).toLocaleString("en-IN");
const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : "";

const ISSUE_TYPES = {
  missing_payment: "Missing Payment",
  missing_order: "Missing Order",
  amount_mismatch: "Amount Mismatch",
  duplicate_payment: "Duplicate Payment",
  cancelled_order_paid: "Cancelled Order Paid",
  refund_mismatch: "Refund Mismatch",
  incorrect_status: "Incorrect Status",
  suspicious_mapping: "Suspicious Mapping"
};

function fmtDate(iso) {
  if (!iso) return "n/a";
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function relTime(iso) {
  if (!iso) return "never reconciled";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return m + " minutes ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + " hours ago";
  return Math.floor(h / 24) + " days ago";
}

function toast(msg, type) {
  const t = document.createElement("div");
  t.className = "toast" + (type ? " " + type : "");
  t.textContent = msg;
  $("#toastRoot").appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity 200ms"; }, 2600);
  setTimeout(() => t.remove(), 2900);
}

function animateValue(el, to, fmt, ms) {
  const from = 0, start = performance.now();
  fmt = fmt || ((v) => String(Math.round(v)));
  (function tick(now) {
    const p = Math.min(1, (now - start) / (ms || 450));
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(from + (to - from) * eased);
    if (p < 1) requestAnimationFrame(tick);
  })(start);
}

/* ------------------------------------------------------------------ */
/* API client and state                                                */
/* ------------------------------------------------------------------ */
/* The app talks to the backend server when it is reachable, from any
 * origin (file://, a static file server, or the server itself). When the
 * server is unreachable it switches to the standalone engine embedded in
 * local-engine.js so the demo keeps working with the same data. */
let MODE = "auto"; // "auto" | "local"
const API_BASE = (() => {
  const want = 4000;
  if (location.protocol === "file:") return "http://localhost:" + want;
  if (String(location.port) === String(want)) return "";
  return "http://" + (location.hostname || "localhost") + ":" + want;
})();

class HttpError extends Error { constructor(m) { super(m); this.http = true; } }

function switchToLocal() {
  if (MODE === "local") return;
  MODE = "local";
  const b = $("#localBanner");
  if (b) b.hidden = false;
  toast("Backend server not detected, running standalone with the built in demo data", "success");
}

async function request(method, url, body) {
  // Once the server is known to be unreachable, never touch the network again.
  if (MODE === "local") return window.SETTLE_LOCAL.handler(method, url, body);
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 7000) : null;
  try {
    const r = await fetch(API_BASE + url, {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new HttpError(j.error || "Request failed. Please try again.");
    return j;
  } catch (e) {
    if (e && e.http) throw e; // the server answered with an error message
    if (typeof window.SETTLE_LOCAL === "undefined") throw new Error("Could not reach the SETTLE server and no embedded engine is available.");
    switchToLocal();
    return window.SETTLE_LOCAL.handler(method, url, body);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const api = {
  get: (url) => request("GET", url),
  post: (url, body) => request("POST", url, body)
};

const state = {
  summary: null,
  issues: [],
  orders: [],
  payments: [],
  source: null,
  lastReconciledAt: null,
  period: null,
  uploads: { orders: "", payments: "", ordersName: "", paymentsName: "" },
  status: null
};

function adopt(data) {
  state.summary = data.summary || null;
  state.issues = data.issues || state.issues;
  state.orders = data.orders || state.orders;
  state.payments = data.payments || state.payments;
  state.source = data.source || state.source;
  state.lastReconciledAt = data.lastReconciledAt || state.lastReconciledAt;
  updateChrome();
}

function updateChrome() {
  $("#sideSource").textContent = state.source === "demo" ? "Demo Dataset" : state.source === "razorpay" ? "Razorpay" : state.source === "upload" ? "Uploaded files" : "No data loaded";
  $("#topSource").innerHTML = state.summary ? "<b>Data:</b> " + (state.source === "demo" ? "Demo Dataset" : cap(state.source)) : "";
  $("#topReconciled").innerHTML = state.summary ? "<b>Last reconciled:</b> " + relTime(state.lastReconciledAt) : "";
  const badge = $("#navIssues");
  const n = state.summary ? state.summary.open : 0;
  if (n > 0) { badge.textContent = n; badge.hidden = false; } else { badge.hidden = true; }
}

/* ------------------------------------------------------------------ */
/* Data actions                                                        */
/* ------------------------------------------------------------------ */
async function loadDemo() {
  const btn = document.querySelector('[data-action="load-demo"]');
  if (btn) { btn.disabled = true; btn.textContent = "Loading..."; }
  try {
    const data = await api.post("/api/demo");
    adopt(data);
    state.period = null;
    toast("Demo dataset loaded and reconciled", "success");
    navigate("dashboard");
  } catch (e) {
    toast(e.message, "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Load Demo Dataset"; }
  }
}

async function refresh() {
  try {
    const [st, sum] = await Promise.all([api.get("/api/status"), api.get("/api/reconciliation/summary")]);
    state.status = st;
    if (sum && !sum.empty) {
      state.summary = sum;
      state.issues = await api.get("/api/issues");
      try { state.orders = await api.get("/api/orders"); } catch (e) { /* optional */ }
      try { state.payments = await api.get("/api/payments"); } catch (e) { /* optional */ }
    } else {
      state.summary = null;
      state.issues = [];
    }
    state.source = st.dataSource;
    state.lastReconciledAt = st.lastReconciledAt;
    updateChrome();
    router();
    toast("Refreshed", "success");
  } catch (e) {
    toast(e.message, "error");
  }
}

async function runReconcile() {
  const box = document.getElementById("reconcileProgress");
  if (!box) return;
  box.innerHTML = "";
  const steps = [
    "Loading orders and payments",
    "Matching records by order id",
    "Checking amounts and statuses",
    "Detecting discrepancies",
    "Building AI explanations"
  ];
  steps.forEach((s, i) => {
    const row = document.createElement("div");
    row.className = "progress-step";
    row.id = "step" + i;
    row.innerHTML = '<span class="spinner"></span><span>' + esc(s) + "</span>";
    box.appendChild(row);
  });
  let i = 0;
  const interval = setInterval(() => {
    const cur = document.getElementById("step" + i);
    if (cur) { cur.classList.add("done"); cur.innerHTML = '<span class="check">✓</span><span>' + esc(steps[i]) + "</span>"; i++; }
    if (i >= steps.length) clearInterval(interval);
  }, 380);
  try {
    const data = await api.post("/api/reconcile");
    clearInterval(interval);
    adopt(data);
    box.innerHTML = '<div class="progress-step done"><span class="check">✓</span><span><b>Analysis complete.</b> ' +
      data.summary.matched + " records matched, " + data.summary.issues + " issues found.</span></div>" +
      '<div class="flex" style="margin-top:14px"><button class="btn primary small" data-action="nav" data-route="issues">View issues</button>' +
      '<button class="btn ghost small" data-action="nav" data-route="dashboard">Go to dashboard</button></div>';
    toast("Reconciliation complete", "success");
  } catch (e) {
    clearInterval(interval);
    box.innerHTML = '<div class="progress-step" style="color:var(--danger)">' + esc(e.message) + "</div>";
  }
}

async function importFiles() {
  const { orders, payments } = state.uploads;
  if (!orders && !payments) { toast("Choose at least one CSV file first", "error"); return; }
  try {
    const r = await api.post("/api/import", { orders, payments });
    state.uploads = { orders: "", payments: "", ordersName: "", paymentsName: "" };
    state.summary = null;
    state.issues = [];
    state.source = "upload";
    state.lastReconciledAt = null;
    state.status = await api.get("/api/status");
    updateChrome();
    toast("Imported " + fmtNum(r.orders) + " orders and " + fmtNum(r.payments) + " payments", "success");
    router();
  } catch (e) {
    toast(e.message, "error");
  }
}

async function razorpayImport() {
  try {
    const data = await api.post("/api/razorpay/import");
    adopt(data);
    toast("Razorpay payments imported", "success");
    router();
  } catch (e) {
    toast(e.message, "error");
  }
}

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */
const TITLES = {
  dashboard: "Overview", reconcile: "Reconcile", issues: "Issues", payments: "Payments",
  orders: "Orders", agent: "AI Agent", reports: "Reports", settings: "Settings"
};

function navigate(route) { location.hash = "#/" + route; }

function currentRoute() {
  return (location.hash.replace(/^#\//, "") || "dashboard").split("?")[0];
}

function router() {
  const route = currentRoute();
  const view = $("#view");
  const renderer = { dashboard: renderDashboard, reconcile: renderReconcile, issues: renderIssues,
    payments: renderPayments, orders: renderOrders, agent: renderAgent, reports: renderReports,
    settings: renderSettings }[route] || renderDashboard;
  view.innerHTML = "";
  document.querySelectorAll(".nav-item").forEach((a) => a.classList.toggle("active", a.dataset.route === route));
  $("#pageTitle").textContent = TITLES[route] || "Overview";
  renderer(view);
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */
function renderDashboard(view) {
  if (!state.summary) {
    view.innerHTML =
      '<div class="card"><div class="empty">' +
      '<div class="empty-icon">⧗</div>' +
      "<h3>No reconciliation data yet</h3>" +
      "<p>Load a demo dataset or upload your payment records to begin.</p>" +
      '<div class="flex" style="justify-content:center">' +
      '<button class="btn primary" data-action="load-demo">Load Demo Dataset</button>' +
      '<button class="btn ghost" data-action="nav" data-route="reconcile">Upload files</button></div></div></div>';
    return;
  }
  const s = state.summary;
  const stat = (label, value, cls, fmt) =>
    '<div class="stat"><div class="stat-label">' + label + '</div><div class="stat-value ' + (cls || "") + '" data-count="' + value + '">' + (fmt ? fmt(value) : fmtNum(value)) + "</div></div>";

  view.innerHTML =
    '<div class="stats">' +
    stat("Total payments", s.totalPaymentsAmount, "", fmtINR) +
    stat("Orders", s.orders) +
    stat("Matched", s.matched, "good") +
    stat("Issues", s.issues, s.issues ? "bad" : "good") +
    stat("Unresolved", s.open, s.open ? "warn" : "good") +
    stat("Refunds", s.refundAmount, "", fmtINR) +
    "</div>" +
    '<div class="grid-2 section-gap">' +
    '<div class="card"><div class="card-head"><div><div class="card-title">Reconciliation Health</div>' +
    '<div class="card-sub">Share of orders that matched cleanly</div></div>' +
    '<span class="badge ' + (s.healthScore >= 90 ? "healthy" : s.healthScore >= 70 ? "sev-medium" : "sev-critical") + '">' + esc(s.healthLabel) + "</span></div>" +
    '<div class="health-num">' + s.healthScore + "%</div>" +
    '<div class="health-label ' + (s.healthScore >= 90 ? "good" : s.healthScore >= 70 ? "warn" : "bad") + '">' + esc(s.healthLabel) + "</div>" +
    '<div class="bar"><div class="bar-fill ' + (s.healthScore >= 90 ? "" : s.healthScore >= 70 ? "warn" : "bad") + '" style="width:' + s.healthScore + '%"></div></div>' +
    '<p class="small muted" style="margin-top:12px">' + s.matched + " of " + s.orders + " orders matched automatically. " +
    s.open + ' open issues worth ' + fmtINR(s.unresolvedAmount) + " need review.</p></div>" +
    '<div class="card"><div class="card-head"><div><div class="card-title">AI Reconciliation Summary</div>' +
    '<div class="card-sub">Generated from the current dataset</div></div>' +
    '<button class="arrow-link" data-action="nav" data-route="agent">Ask SETTLE →</button></div>' +
    '<p style="font-size:13.5px;line-height:1.6">' + esc(s.aiSummary) + "</p>" +
    '<div class="flex" style="margin-top:16px"><button class="btn primary small" data-action="nav" data-route="issues">View issues →</button>' +
    '<button class="btn ghost small" data-action="nav" data-route="reports">Open report</button></div></div>' +
    "</div>" +
    '<div class="grid-2 section-gap">' +
    '<div class="card"><div class="card-head"><div><div class="card-title">Issue Breakdown</div>' +
    '<div class="card-sub">Discrepancies by type</div></div></div>' +
    breakdownHtml(s.byType) +
    "</div>" +
    '<div class="card"><div class="card-head"><div><div class="card-title">Open Issues by Severity</div>' +
    '<div class="card-sub">Where to focus first</div></div>' +
    '<button class="arrow-link" data-action="nav" data-route="issues">All issues →</button></div>' +
    severityHtml(s) +
    "</div></div>" +
    topIssuesTable(state.issues.filter((i) => i.state === "open").slice(0, 6));

  requestAnimationFrame(() => {
    view.querySelectorAll(".stat-value[data-count]").forEach((el) => {
      const target = parseFloat(el.dataset.count);
      const isMoney = el.textContent.indexOf("₹") === 0;
      animateValue(el, target, (v) => (isMoney ? fmtINR(v) : fmtNum(v)), 500);
    });
  });
}

function breakdownHtml(byType) {
  const entries = Object.entries(byType || {}).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return '<p class="small muted">No discrepancies found.</p>';
  const max = entries[0][1];
  return entries.map(([t, n]) =>
    '<div class="breakdown-item"><span>' + esc(t) + '</span><span class="flex"><span class="bi-count">' + n + "</span>" +
    '<span style="width:60px;height:6px;background:var(--bg-subtle);border-radius:3px;overflow:hidden"><span style="display:block;height:100%;width:' + (n / max * 100) + '%;background:var(--ink)"></span></span></span></div>'
  ).join("");
}

function severityHtml(s) {
  const groups = [
    ["critical", "Critical", "sev-critical"],
    ["high", "High", "sev-high"],
    ["medium", "Medium", "sev-medium"],
    ["low", "Low", "sev-low"]
  ];
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  state.issues.forEach((i) => { if (i.state === "open" && counts[i.severity] !== undefined) counts[i.severity]++; });
  return groups.map(([key, label, cls]) =>
    '<div class="status-row" style="padding:10px 0"><span class="sr-label"><span class="badge ' + cls + '">' + label + "</span></span>" +
    '<span class="sr-value" style="font-weight:600;color:var(--ink)">' + counts[key] + " open</span></div>"
  ).join("");
}

function topIssuesTable(list) {
  if (!list.length) return "";
  return '<div class="card section-gap"><div class="card-head"><div><div class="card-title">Highest Value Open Issues</div>' +
    '<div class="card-sub">Click a row to open the AI investigation</div></div></div>' +
    '<div class="table-wrap"><table><thead><tr><th>Issue</th><th>Order</th><th class="num">Amount</th><th>Type</th><th>Severity</th></tr></thead><tbody>' +
    list.map((i) =>
      '<tr class="clickable" data-action="open-issue" data-id="' + i.id + '">' +
      '<td class="td-mono">' + i.id + "</td>" +        '<td class="td-mono">' + esc(i.orderId || "None") + "</td>" +
        '<td class="num amount">' + fmtINR(i.amount) + "</td>" +
        '<td><span class="badge type">' + esc(i.typeLabel) + "</span></td>" +
        '<td><span class="badge sev-' + i.severity + '">' + cap(i.severity) + "</span></td></tr>"
    ).join("") +
    "</tbody></table></div></div>";
}

/* ------------------------------------------------------------------ */
/* Reconcile                                                           */
/* ------------------------------------------------------------------ */
function renderReconcile(view) {
  const st = state.status;
  const rzpConfigured = !!(st && st.razorpayConfigured);
  view.innerHTML =
    '<div class="card"><div class="card-head"><div><div class="card-title">Data Source</div>' +
    '<div class="card-sub">The application works fully offline with the demo dataset</div></div>' +
    '<span class="badge source">' + (state.source === "demo" ? "Demo Dataset" : state.source === "upload" ? "Uploaded files" : state.source === "razorpay" ? "Razorpay" : "Nothing loaded") + "</span></div>" +
    '<div class="flex" style="flex-wrap:wrap">' +
    '<button class="btn primary" data-action="load-demo">Load Demo Dataset</button>' +
    '<button class="btn ghost" data-action="razorpay-import" ' + (rzpConfigured ? "" : "disabled") + ">Import from Razorpay</button>" +
    '<span class="small muted">' + (rzpConfigured ? "Razorpay test mode configured" : "Razorpay not configured, demo mode only") + "</span></div></div>" +

    '<div class="card section-gap"><div class="card-head"><div><div class="card-title">Upload Your Own Files</div>' +
    '<div class="card-sub">Upload orders and payments as CSV. Headers are detected automatically.</div></div>' +
    '<button class="btn ghost small" data-action="import-files">Import files</button></div>' +
    '<div class="upload-zone' + (state.uploads.orders || state.uploads.payments ? " has-file" : "") + '" id="uploadZone">' +
    '<div class="file-row"><span class="file-label">Orders CSV</span>' +
    '<input type="file" id="fileOrders" accept=".csv,text/csv" class="file-input">' +
    '<span class="file-name" id="ordersFileName">' + (state.uploads.ordersName ? esc(state.uploads.ordersName) : "orders.csv") + "</span></div>" +
    '<div class="file-row"><span class="file-label">Payments CSV</span>' +
    '<input type="file" id="filePayments" accept=".csv,text/csv" class="file-input">' +
    '<span class="file-name" id="paymentsFileName">' + (state.uploads.paymentsName ? esc(state.uploads.paymentsName) : "payments.csv") + "</span></div></div>" +
    '<p class="small muted" style="margin-top:10px">Expected columns. Orders: order_id, customer, expected_amount, order_status, order_date. Payments: payment_id, order_id, amount, status, customer, timestamp, refund_amount.</p></div>' +

    '<div class="card section-gap"><div class="card-head"><div><div class="card-title">Reconciliation Preview</div>' +
    '<div class="card-sub" id="previewSub">' + (state.summary ? "Last run " + relTime(state.lastReconciledAt) : "Load data above, then run") + "</div></div>" +
    (state.summary ? '<button class="btn ghost small" data-action="run-reconcile">Re run reconciliation</button>' : '<button class="btn primary" data-action="run-reconcile">Run Reconciliation</button>') + "</div>" +
    (state.summary
      ? '<div class="preview-counts">' +
        countBox(state.summary.orders, "Orders detected") +
        countBox(state.summary.payments, "Payments detected") +
        countBox(state.summary.matched, "Records matched") +
        countBox(state.summary.issues, "Potential issues") +
        countBox(state.summary.unresolvedAmount, "Unresolved", fmtINR) +
        "</div>"
      : (state.source === "upload"
        ? '<div class="preview-counts">' +
          countBox((state.status && state.status.counts.orders) || 0, "Orders detected") +
          countBox((state.status && state.status.counts.payments) || 0, "Payments detected") +
          "</div><p class=\"small muted\">Run reconciliation to match records and detect issues.</p>"
        : '<p class="small muted">No data loaded yet. Load the demo dataset or upload your files.</p>')) +
    '<div id="reconcileProgress" class="progress"></div></div>';

  const ord = $("#fileOrders"), pay = $("#filePayments");
  ord.addEventListener("change", () => {
    const f = ord.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      state.uploads.orders = String(reader.result || "");
      state.uploads.ordersName = f.name;
      $("#ordersFileName").textContent = f.name + " (" + fmtNum(state.uploads.orders.split(/\r?\n/).length - 1) + " rows)";
      $("#uploadZone").classList.add("has-file");
    };
    reader.readAsText(f);
  });
  pay.addEventListener("change", () => {
    const f = pay.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      state.uploads.payments = String(reader.result || "");
      state.uploads.paymentsName = f.name;
      $("#paymentsFileName").textContent = f.name + " (" + fmtNum(state.uploads.payments.split(/\r?\n/).length - 1) + " rows)";
      $("#uploadZone").classList.add("has-file");
    };
    reader.readAsText(f);
  });
}

function countBox(n, label, fmt) {
  return '<div class="pc"><b>' + (fmt ? fmt(n) : fmtNum(n)) + "</b><span>" + esc(label) + "</span></div>";
}

/* ------------------------------------------------------------------ */
/* Issues                                                              */
/* ------------------------------------------------------------------ */
function renderIssues(view) {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const q = params.get("q") || "";
  const status = params.get("status") || "";
  const severity = params.get("severity") || "";
  const type = params.get("type") || "";

  view.innerHTML =
    '<div class="filters">' +
    '<input type="search" id="issueSearch" placeholder="Search issues, orders, customers" value="' + esc(q) + '">' +
    '<select id="issueStatus"><option value="">All statuses</option><option value="open"' + (status === "open" ? " selected" : "") + ">Open</option><option value=\"reviewed\"" + (status === "reviewed" ? " selected" : "") + ">Reviewed</option><option value=\"resolved\"" + (status === "resolved" ? " selected" : "") + ">Resolved</option></select>" +
    '<select id="issueSeverity"><option value="">All severities</option>' + ["critical", "high", "medium", "low"].map((s) => '<option value="' + s + '"' + (severity === s ? " selected" : "") + ">" + cap(s) + "</option>").join("") + "</select>" +
    '<select id="issueType"><option value="">All types</option>' +
    Object.keys(ISSUE_TYPES).map((t) => '<option value="' + t + '"' + (type === t ? " selected" : "") + ">" + esc(ISSUE_TYPES[t]) + "</option>").join("") + "</select>" +
    '<div class="spacer"></div><span class="small muted" id="issueCount"></span></div>' +
    '<div id="issueTable"></div>';

  // Filter changes update the hash so filters survive navigation.
  const applyFilters = () => {
    const p = new URLSearchParams();
    const f = {
      q: $("#issueSearch").value.trim(),
      status: $("#issueStatus").value,
      severity: $("#issueSeverity").value,
      type: $("#issueType").value
    };
    if (f.q) p.set("q", f.q);
    if (f.status) p.set("status", f.status);
    if (f.severity) p.set("severity", f.severity);
    if (f.type) p.set("type", f.type);
    location.hash = "#/issues?" + p.toString();
  };
  $("#issueSearch").addEventListener("keydown", (e) => { if (e.key === "Enter") applyFilters(); });
  ["issueStatus", "issueSeverity", "issueType"].forEach((id) => { $("#" + id).addEventListener("change", applyFilters); });

  const query = new URLSearchParams();
  if (q) query.set("q", q);
  if (status) query.set("status", status);
  if (severity) query.set("severity", severity);
  if (type) query.set("type", type);
  api.get("/api/issues?" + query.toString()).then((list) => {
    state.issues = list;
    updateChrome();
    $("#issueCount").textContent = list.length + " issues";
    $("#issueTable").innerHTML =
      '<div class="table-wrap"><table><thead><tr>' +
      "<th>Issue</th><th>Order</th><th class=\"num\">Amount</th><th>Type</th><th>Severity</th><th>AI Recommendation</th><th>Status</th>" +
      "</tr></thead><tbody>" +
      (list.length ? list.map(issueRow).join("") :
        '<tr><td colspan="7" style="text-align:center;color:var(--ink-2);padding:30px">No issues match these filters.</td></tr>') +
      "</tbody></table></div>";
  }).catch((e) => { $("#issueTable").innerHTML = '<p class="muted">' + esc(e.message) + "</p>"; });
}

function issueRow(i) {
  return '<tr class="clickable" data-action="open-issue" data-id="' + i.id + '">' +
    '<td class="td-mono">' + i.id + "</td>" +
    '<td class="td-mono">' + esc(i.orderId || "None") + '<span class="td-sub">' + esc(i.orderCustomer || "") + "</span></td>" +
    '<td class="num amount">' + fmtINR(i.amount) + "</td>" +
    '<td><span class="badge type">' + esc(i.typeLabel) + "</span></td>" +
    '<td><span class="badge sev-' + i.severity + '">' + cap(i.severity) + "</span></td>" +
    '<td>' + esc(i.recommendation) + "</td>" +
    '<td><span class="badge state-' + i.state + '">' + cap(i.state) + "</span></td></tr>";
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* ------------------------------------------------------------------ */
/* Issue detail modal                                                  */
/* ------------------------------------------------------------------ */
async function openIssue(id) {
  try {
    const data = await api.get("/api/issues/" + encodeURIComponent(id));
    const i = data.issue, inv = data.investigation;
    const fact = (label, value, mono) =>
      '<div class="fact"><div class="fact-label">' + label + '</div><div class="fact-value' + (mono ? " mono" : "") + '">' + value + "</div></div>";
    const v = inv.verified || {};
    const body =
      '<div class="kicker">' + i.id + " · " + esc(i.typeLabel) + "</div>" +
      '<div class="fact-grid">' +
      fact("Order", esc(v.orderId || "None")) +
      fact("Customer", esc(v.customer || "Unknown")) +
      fact("Expected amount", fmtINR(v.expectedAmount || 0)) +
      fact("Received", fmtINR(v.receivedAmount || 0)) +
      fact("Difference", (v.difference || 0) !== 0 ? fmtINR(Math.abs(v.difference)) : "₹0") +
      fact("Payment", esc(v.paymentId || "None"), true) +
      fact("Payment status", cap(v.paymentStatus || "None")) +
      fact("Order status", cap(v.orderStatus || "None")) +
      (i.extraPaymentIds && i.extraPaymentIds.length ? fact("Extra payments", esc(i.extraPaymentIds.join(", ")), true) : "") +
      (i.matchedOrderId ? fact("Amount matches order", esc(i.matchedOrderId), true) : "") +
      "</div>" +
      '<div class="inv-section"><span class="inv-tag">AI generated recommendation</span>' +
      "<h4>AI Investigation</h4>" +
      '<p><b>What happened?</b> ' + esc(inv.what_happened) + "</p>" +
      '<p style="margin-top:8px"><b>Why it matters</b> ' + esc(inv.why_it_matters) + "</p>" +
      '<p style="margin-top:8px"><b>Recommended action</b> ' + esc(inv.recommended_action) + "</p>" +
      '<div class="flex" style="margin-top:10px"><span class="badge sev-' + i.severity + '">' + cap(i.severity) + " severity</span>" +
      '<span class="inv-tag">Confidence ' + inv.confidence + "%</span>" +
      '<span class="inv-tag">' + esc(inv.aiSource === "builtin" ? "Built in reasoning engine" : "Live model") + "</span></div></div>" +
      (i.note ? '<div class="inv-section"><h4>Note</h4><p>' + esc(i.note) + "</p></div>" : "") +
      '<div class="trust-note">Financial records are calculated by SETTLE\'s reconciliation engine. The AI interpretation above is a recommendation, not a financial fact.</div>';

    const foot =
      '<button class="btn ghost" data-action="apply" data-id="' + i.id + '" title="Adds the recommendation as a note and marks reviewed">Apply Recommendation</button>' +
      '<button class="btn ghost" data-action="note" data-id="' + i.id + '">Add Note</button>' +
      '<div class="grow"></div>' +
      (i.state !== "reviewed" ? '<button class="btn ghost" data-action="review" data-id="' + i.id + '">Mark Reviewed</button>' : "") +
      (i.state !== "resolved" ? '<button class="btn success" data-action="resolve" data-id="' + i.id + '">Resolve</button>' : "");

    showModal(cap(i.typeLabel) + " · " + i.id, "Opened from the issues list", body, foot);
  } catch (e) {
    toast(e.message, "error");
  }
}

function showModal(title, sub, bodyHtml, footHtml) {
  closeModal();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.dataset.action = "close-modal";
  overlay.innerHTML =
    '<div class="modal" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
    '<div class="modal-head"><div><h2>' + esc(title) + '</h2><div class="mh-sub">' + esc(sub) + "</div></div>" +
    '<button class="modal-close" data-action="close-modal" aria-label="Close">×</button></div>' +
    '<div class="modal-body">' + bodyHtml + "</div>" +
    (footHtml ? '<div class="modal-foot">' + footHtml + "</div>" : "") +
    "</div>";
  $("#modalRoot").appendChild(overlay);
  const closeBtn = overlay.querySelector(".modal-close");
  if (closeBtn) closeBtn.focus();
}

function closeModal() { $("#modalRoot").innerHTML = ""; }

async function setIssueState(id, action, extra) {
  try {
    const body = extra || {};
    const issue = await api.post("/api/issues/" + encodeURIComponent(id) + "/" + action, body);
    const idx = state.issues.findIndex((x) => x.id === id);
    if (idx >= 0) state.issues[idx] = issue;
    const sum = await api.get("/api/reconciliation/summary");
    state.summary = sum.empty ? null : sum;
    updateChrome();
    toast(issue.id + " marked " + issue.state, "success");
    closeModal();
    router();
  } catch (e) {
    toast(e.message, "error");
  }
}

/* ------------------------------------------------------------------ */
/* Payments and Orders                                                 */
/* ------------------------------------------------------------------ */
function statusBadge(status) {
  const cls = status === "captured" ? "sev-low" : status === "failed" ? "sev-critical" : status === "refunded" ? "sev-medium" : "sev-low";
  return '<span class="badge ' + cls + '">' + cap(status) + "</span>";
}

function renderPayments(view) {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const q = params.get("q") || "";
  const status = params.get("status") || "";
  view.innerHTML =
    '<div class="filters">' +
    '<input type="search" id="paySearch" placeholder="Search payment id, order id, customer" value="' + esc(q) + '">' +
    '<select id="payStatus"><option value="">All statuses</option>' +
    ["captured", "pending", "failed", "refunded"].map((s) => '<option value="' + s + '"' + (status === s ? " selected" : "") + ">" + cap(s) + "</option>").join("") + "</select>" +
    '<div class="spacer"></div><span class="small muted" id="payCount"></span></div>' +
    '<div id="payTable"></div>';
  $("#paySearch").addEventListener("keydown", (e) => { if (e.key === "Enter") payApply(); });
  $("#payStatus").addEventListener("change", payApply);
  function payApply() {
    const p = new URLSearchParams();
    if ($("#paySearch").value) p.set("q", $("#paySearch").value);
    if ($("#payStatus").value) p.set("status", $("#payStatus").value);
    location.hash = "#/payments?" + p.toString();
  }
  const query = new URLSearchParams();
  if (q) query.set("q", q);
  if (status) query.set("status", status);
  api.get("/api/payments?" + query.toString()).then((list) => {
    state.payments = list;
    $("#payCount").textContent = list.length + " payments";
    $("#payTable").innerHTML =
      '<div class="table-wrap"><table><thead><tr>' +
      "<th>Payment ID</th><th>Order ID</th><th class=\"num\">Amount</th><th>Status</th><th>Customer</th><th>Date</th><th class=\"num\">Refund</th><th>Match</th>" +
      "</tr></thead><tbody>" +
      (list.length ? list.map((p) =>
        '<tr class="' + (p.issueId ? "clickable" : "") + '"' + (p.issueId ? ' data-action="open-issue" data-id="' + p.issueId + '"' : "") + ">" +
        '<td class="td-mono">' + esc(p.payment_id) + "</td>" +
        '<td class="td-mono">' + esc(p.order_id || "None") + "</td>" +
        '<td class="num amount">' + fmtINR(p.amount) + "</td>" +
        "<td>" + statusBadge(p.status) + "</td>" +
        "<td>" + esc(p.customer) + "</td>" +
        "<td>" + fmtDate(p.timestamp) + "</td>" +
        '<td class="num">' + (p.refund_amount ? fmtINR(p.refund_amount) : "n/a") + "</td>" +
        "<td>" + (p.match_status === "Matched" || p.match_status === "Unlinked" ? '<span class="badge ' + (p.match_status === "Matched" ? "healthy" : "sev-low") + '">' + p.match_status + "</span>" : '<span class="badge sev-high">' + esc(p.match_status) + "</span>") + "</td></tr>"
      ).join("") :
        '<tr><td colspan="8" style="text-align:center;color:var(--ink-2);padding:30px">No payments found.</td></tr>') +
      "</tbody></table></div>";
  }).catch((e) => { $("#payTable").innerHTML = '<p class="muted">' + esc(e.message) + "</p>"; });
}

function renderOrders(view) {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const q = params.get("q") || "";
  view.innerHTML =
    '<div class="filters">' +
    '<input type="search" id="orderSearch" placeholder="Search order id, customer" value="' + esc(q) + '">' +
    '<div class="spacer"></div><span class="small muted" id="orderCount"></span></div>' +
    '<div id="orderTable"></div>';
  $("#orderSearch").addEventListener("keydown", (e) => { if (e.key === "Enter") orderApply(); });
  function orderApply() {
    const p = new URLSearchParams();
    if ($("#orderSearch").value) p.set("q", $("#orderSearch").value);
    location.hash = "#/orders?" + p.toString();
  }
  const query = new URLSearchParams();
  if (q) query.set("q", q);
  api.get("/api/orders?" + query.toString()).then((list) => {
    state.orders = list;
    const payMap = new Map(state.payments.map((p) => [p.order_id, p]));
    $("#orderCount").textContent = list.length + " orders";
    $("#orderTable").innerHTML =
      '<div class="table-wrap"><table><thead><tr>' +
      "<th>Order ID</th><th>Customer</th><th class=\"num\">Expected</th><th>Order Status</th><th>Payment Status</th><th class=\"num\">Difference</th><th>Reconciliation</th>" +
      "</tr></thead><tbody>" +
      (list.length ? list.map((o) => {
        const p = payMap.get(o.order_id);
        const hasIssue = !!o.issueId;
        return '<tr class="' + (hasIssue ? "clickable" : "") + '"' + (hasIssue ? ' data-action="open-issue" data-id="' + o.issueId + '"' : "") + ">" +
          '<td class="td-mono">' + esc(o.order_id) + "</td>" +
          "<td>" + esc(o.customer) + "</td>" +
          '<td class="num amount">' + fmtINR(o.expected_amount) + "</td>" +
          "<td>" + (o.order_status === "cancelled" ? '<span class="badge sev-critical">Cancelled</span>' : o.order_status === "pending" ? '<span class="badge sev-medium">Pending</span>' : '<span class="badge healthy">Paid</span>') + "</td>" +
          "<td>" + (p ? statusBadge(p.status) : '<span class="badge sev-critical">No payment</span>') + "</td>" +
          '<td class="num">' + (o.difference ? fmtINR(Math.abs(o.difference)) : "n/a") + "</td>" +
          "<td>" + (hasIssue ? '<span class="badge sev-high">' + esc(o.reconciliation_status) + "</span>" : '<span class="badge healthy">Matched</span>') + "</td></tr>";
      }).join("") :
        '<tr><td colspan="7" style="text-align:center;color:var(--ink-2);padding:30px">No orders found.</td></tr>') +
      "</tbody></table></div>";
  }).catch((e) => { $("#orderTable").innerHTML = '<p class="muted">' + esc(e.message) + "</p>"; });
}

/* ------------------------------------------------------------------ */
/* AI Agent                                                            */
/* ------------------------------------------------------------------ */
function renderAgent(view) {
  view.innerHTML =
    '<div class="agent-layout">' +
    '<div class="agent-chat">' +
    '<div class="agent-head"><div class="flex" style="justify-content:space-between">' +
    '<div><h2>SETTLE Agent</h2><p>Payment operations copilot</p></div>' +
    '<span class="badge source">' + (state.status && state.status.aiMode ? esc(state.status.aiMode) : "Built in reasoning engine") + "</span></div></div>" +
    '<div class="agent-body" id="agentBody"></div>' +
    '<div class="agent-suggest" id="agentSuggest">' +
    ["What needs my attention?", "Where is the largest mismatch?", "Give me a reconciliation summary.", "Show me suspicious payments.", "Which issues can be resolved quickly?"]
      .map((s) => '<button class="suggest-chip" data-action="agent-prompt" data-q="' + esc(s) + '">' + esc(s) + "</button>").join("") +
    "</div>" +
    '<form class="agent-input" id="agentForm">' +
    '<textarea id="agentInput" rows="1" placeholder="Ask about your reconciliation data..." aria-label="Message the agent"></textarea>' +
    '<button class="btn primary" type="submit" id="agentSend">Send</button></form></div>' +
    '<div class="agent-notes">' +
    '<div class="card"><div class="note-title">How the agent works</div>' +
    '<div class="note-text">' +
    "<p><b>Observe.</b> Reads the reconciliation state.</p>" +
    '<p style="margin-top:6px"><b>Reason.</b> Identifies important discrepancies.</p>' +
    '<p style="margin-top:6px"><b>Investigate.</b> Retrieves the records behind each case.</p>' +
    '<p style="margin-top:6px"><b>Recommend.</b> Suggests the next operational step.</p>' +
    '<p style="margin-top:6px"><b>Act.</b> Prepares actions that humans approve.</p></div></div>' +
    '<div class="card"><div class="note-title">Current dataset</div>' +
    '<div class="note-text">' + (state.summary ?
      state.summary.orders + " orders, " + state.summary.payments + " payments, " + state.summary.matched + " matched, " +
      state.summary.open + " open issues worth " + fmtINR(state.summary.unresolvedAmount) + "."
      : "No reconciliation data loaded yet.") + "</div></div>" +
    '<div class="card"><div class="note-title">Session context</div>' +
    '<div class="note-text grey">The agent remembers the conversation. Ask a follow up such as "Explain the largest issue" and it will keep the context.</div></div>' +
    '<div class="card"><div class="note-title">Trust</div>' +
    '<div class="note-text grey">The agent never invents financial facts. All numbers come from the reconciliation engine. If an answer is not in the data, it says so.</div></div>' +
    "</div></div>";

  $("#agentForm").addEventListener("submit", (e) => { e.preventDefault(); sendAgentMessage(); });
  const input = $("#agentInput");
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendAgentMessage(); }
  });
  if (!state.agentMessages) state.agentMessages = [];
  if (!state.agentMessages.length) {
    state.agentMessages.push({
      role: "agent",
      text: "I am SETTLE, your payment operations copilot. I can read the loaded reconciliation data, explain discrepancies and recommend next steps. Try one of the suggested questions below."
    });
  }
  renderAgentMessages();
}

function renderAgentMessages() {
  const body = $("#agentBody");
  if (!body) return;
  body.innerHTML = state.agentMessages.map((m) => {
    if (m.role === "user") return '<div class="msg user">' + esc(m.text) + "</div>";
    let html = '<div class="msg agent">' + esc(m.text) + "</div>";
    const meta = [];
    if (m.toolsUsed && m.toolsUsed.length) meta.push('<span class="tool-chip">' + m.toolsUsed.map(esc).join(" · ") + "</span>");
    if (m.fallbackUsed) meta.push('<span class="fallback-chip">AI unavailable, using rule based explanation</span>');
    if (m.aiSource === "builtin" && !m.fallbackUsed) meta.push('<span class="tool-chip">Built in reasoning engine</span>');
    if (meta.length) html += '<div class="msg-agent-meta">' + meta.join("") + "</div>";
    if (m.references && m.references.length) {
      html += '<div class="ref-row">' + m.references.map((r) =>
        '<button class="ref-chip" data-action="' + (r.startsWith("ISS") ? "open-issue" : "open-record") + '" data-id="' + esc(r) + '">' + esc(r) + "</button>").join("") + "</div>";
    }
    return html;
  }).join("");
  body.scrollTop = body.scrollHeight;
}

async function sendAgentMessage(text) {
  const input = $("#agentInput");
  const msg = (text || input.value).trim();
  if (!msg || state.agentBusy) return;
  input.value = "";
  state.agentMessages.push({ role: "user", text: msg });
  renderAgentMessages();
  state.agentBusy = true;
  $("#agentSend").disabled = true;
  $("#agentBody").insertAdjacentHTML("beforeend", '<div class="msg agent thinking" id="agentThinking"><span class="typing"><span></span><span></span><span></span></span></div>');
  $("#agentBody").scrollTop = $("#agentBody").scrollHeight;
  try {
    const r = await api.post("/api/agent", { message: msg });
    state.agentMessages.push({
      role: "agent", text: r.answer || "", references: r.references || [],
      toolsUsed: r.toolsUsed || [], fallbackUsed: r.fallbackUsed || false, aiSource: r.aiSource || "builtin"
    });
    const think = $("#agentThinking"); if (think) think.remove();
    renderAgentMessages();
  } catch (e) {
    const think = $("#agentThinking"); if (think) think.remove();
    state.agentMessages.push({ role: "agent", text: "I hit a problem reaching the server. " + e.message });
    renderAgentMessages();
  } finally {
    state.agentBusy = false;
    $("#agentSend").disabled = false;
  }
}

async function openRecord(id) {
  let order = state.orders.find((o) => o.order_id === id);
  let pay = state.payments.find((p) => p.payment_id === id);
  if (!order && !pay) {
    try {
      const r = await api.get("/api/search?q=" + encodeURIComponent(id));
      order = r.orders.find((o) => o.order_id === id);
      pay = r.payments.find((p) => p.payment_id === id);
    } catch (e) { /* ignore */ }
  }
  if (order) {
    const iss = state.issues.find((i) => i.orderId === order.order_id);
    showModal("Order " + order.order_id, order.customer,
      '<div class="fact-grid">' +
      factRow("Customer", esc(order.customer)) +
      factRow("Expected amount", fmtINR(order.expected_amount)) +
      factRow("Order status", cap(order.order_status)) +
      factRow("Order date", fmtDate(order.order_date)) +
      "</div>",
      iss ? '<button class="btn primary" data-action="open-issue" data-id="' + iss.id + '">Open related issue</button>' : "");
  } else if (pay) {
    const iss = state.issues.find((i) => i.paymentId === pay.payment_id);
    showModal("Payment " + pay.payment_id, pay.customer,
      '<div class="fact-grid">' +
      factRow("Amount", fmtINR(pay.amount)) +
      factRow("Status", cap(pay.status)) +
      factRow("Linked order", esc(pay.order_id || "None")) +
      factRow("Date", fmtDate(pay.timestamp)) +
      (pay.refund_amount ? factRow("Refund", fmtINR(pay.refund_amount)) : "") +
      "</div>",
      iss ? '<button class="btn primary" data-action="open-issue" data-id="' + iss.id + '">Open related issue</button>' : "");
  } else {
    toast("No record found for " + id, "error");
  }
}

const factRow = (label, value) =>
  '<div class="fact"><div class="fact-label">' + label + '</div><div class="fact-value">' + value + "</div></div>";

/* ------------------------------------------------------------------ */
/* Reports                                                             */
/* ------------------------------------------------------------------ */
function renderReports(view) {
  view.innerHTML = '<div class="card"><div class="card-head"><div><div class="card-title">Reconciliation Report</div>' +
    '<div class="card-sub">Generating...</div></div></div>' +
    '<div class="skel-row" style="grid-template-columns:1fr 1fr"><div class="skeleton" style="height:200px"></div><div class="skeleton" style="height:200px"></div></div></div>';
  api.get("/api/report").then((r) => {
    state.period = r.period;
    const line = (label, value) => '<div class="report-line"><span class="rl-label">' + label + '</span><span class="rl-value">' + value + "</span></div>";
    view.innerHTML =
      '<div class="grid-2">' +
      '<div class="card"><div class="card-head"><div><div class="card-title">Summary</div>' +
      '<div class="card-sub">' + (r.period.from ? fmtDate(r.period.from) + " to " + fmtDate(r.period.to) : "No period available") + "</div></div>" +
      '<button class="btn ghost small" data-action="copy-report">Copy Report</button></div>' +
      line("Total orders", fmtNum(r.totalOrders)) +
      line("Total payments", fmtNum(r.totalPayments)) +
      line("Matched records", fmtNum(r.matched)) +
      line("Unmatched records", fmtNum(r.unmatched)) +
      line("Total discrepancies", fmtNum(r.discrepancies)) +
      line("Unresolved amount", fmtINR(r.unresolvedAmount)) +
      line("Refund amount", fmtINR(r.refundAmount)) +
      "</div>" +
      '<div class="card"><div class="card-head"><div><div class="card-title">Issue Breakdown</div>' +
      '<div class="card-sub">All discrepancies by type</div></div></div>' +
      breakdownHtml(Object.fromEntries(r.breakdown.map((b) => [b.type, b.count]))) +
      "</div></div>" +
      '<div class="card section-gap"><div class="card-head"><div><div class="card-title">AI Executive Summary</div>' +
      '<div class="card-sub">Generated from deterministic totals</div></div></div>' +
      '<p style="font-size:13.5px;line-height:1.6">' + esc(r.aiSummary) + "</p>" +
      '<div class="flex" style="margin-top:16px">' +
      '<button class="btn primary small" data-action="export-csv">Export CSV</button>' +
      '<button class="btn ghost small" data-action="copy-report">Copy Report</button></div></div>' +
      '<p class="small muted" style="margin-top:14px">Generated ' + new Date(r.generatedAt).toLocaleString("en-IN") + ". Numbers are calculated by the reconciliation engine. The narrative is an AI interpretation.</p>";
  }).catch((e) => {
    view.innerHTML = '<div class="card"><div class="empty"><div class="empty-icon">⧗</div>' +
      "<h3>No report yet</h3><p>" + esc(e.message) + "</p>" +
      '<button class="btn primary" data-action="load-demo">Load Demo Dataset</button></div></div>';
  });
}

function copyReport() {
  api.get("/api/report").then((r) => {
    const lines = [
      "SETTLE Reconciliation Report",
      "Period: " + (r.period.from ? fmtDate(r.period.from) + " to " + fmtDate(r.period.to) : "n/a"),
      "Total orders: " + r.totalOrders,
      "Total payments: " + r.totalPayments,
      "Matched: " + r.matched,
      "Unmatched: " + r.unmatched,
      "Discrepancies: " + r.discrepancies,
      "Unresolved amount: " + fmtINR(r.unresolvedAmount),
      "Refund amount: " + fmtINR(r.refundAmount),
      "",
      "AI Executive Summary:",
      r.aiSummary
    ].join("\n");
    navigator.clipboard.writeText(lines).then(
      () => toast("Report copied to clipboard", "success"),
      () => toast("Could not copy. Select the text manually.", "error"));
  }).catch((e) => toast(e.message, "error"));
}

function exportCsv() {
  api.get("/api/report").then((r) => {
    const rows = [["issue_id", "type", "order_id", "payment_id", "amount", "severity", "state", "recommendation", "note"]];
    r.issues.forEach((i) => rows.push([i.id, i.typeLabel, i.orderId || "", i.paymentId || "", i.amount, i.severity, i.state, i.recommendation, (i.note || "").replace(/\n/g, " ") ]));
    const csv = rows.map((row) => row.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "settle-issues.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }).catch((e) => toast(e.message, "error"));
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */
function renderSettings(view) {
  api.get("/api/status").then((st) => {
    state.status = st;
    const row = (label, valueHtml) =>
      '<div class="status-row"><span class="sr-label">' + label + '</span><span class="sr-value">' + valueHtml + "</span></div>";
    view.innerHTML =
      '<div class="grid-2">' +
      '<div class="card"><div class="card-head"><div><div class="card-title">Data Source</div>' +
      '<div class="card-sub">Where the current records came from</div></div></div>' +
      '<div class="status-list">' +
      row("Current source", '<span class="badge source">' + (state.source === "demo" ? "Demo Dataset" : cap(state.source || "Nothing loaded")) + "</span>") +
      row("Records loaded", (st.counts.orders || 0) + " orders, " + (st.counts.payments || 0) + " payments") +
      row("Last reconciled", relTime(state.lastReconciledAt)) +
      "</div></div>" +
      '<div class="card"><div class="card-head"><div><div class="card-title">AI Configuration</div>' +
      '<div class="card-sub">How the agent answers</div></div></div>' +
      '<div class="status-list">' +
      row("AI mode", '<span class="badge source">' + esc(st.aiMode) + "</span>") +
      row("API key", st.aiConfigured ? '<span class="badge healthy">Configured</span>' : '<span class="badge sev-low">Not set, built in engine</span>') +
      row("Fallback", "Rule based explanations when the model is unavailable") +
      "</div></div>" +
      '<div class="card"><div class="card-head"><div><div class="card-title">Demo Mode</div>' +
      '<div class="card-sub">Fastest path to the wow moment</div></div></div>' +
      '<p class="small" style="margin-bottom:14px">Loads 127 orders and 124 payments with 27 deliberately designed reconciliation problems, then runs the engine and the agent.</p>' +
      '<button class="btn primary" data-action="load-demo">Load Demo Dataset</button></div>' +
      '<div class="card"><div class="card-head"><div><div class="card-title">System Status</div>' +
      '<div class="card-sub">Service health</div></div></div>' +
      '<div class="status-list">' +
      row("Reconciliation Engine", '<span class="badge healthy"><span class="dot dot-green"></span>Operational</span>') +
      row("AI Agent", '<span class="badge healthy"><span class="dot dot-green"></span>Operational</span>') +
      row("Data Source", '<span class="badge source">' + (state.source === "demo" ? "Demo Dataset" : cap(state.source || "None")) + "</span>") +
      row("Razorpay Connection", st.razorpayConfigured ? '<span class="badge healthy"><span class="dot dot-green"></span>Configured, test mode</span>' : '<span class="badge sev-low"><span class="dot dot-grey"></span>Not configured</span>') +
      "</div></div></div>";
  }).catch((e) => {
    view.innerHTML = '<div class="card"><p class="muted">' + esc(e.message) + "</p></div>";
  });
}

/* ------------------------------------------------------------------ */
/* Global search                                                       */
/* ------------------------------------------------------------------ */
async function globalSearch(q) {
  const box = $("#searchResults");
  if (!q) { box.hidden = true; return; }
  try {
    const r = await api.get("/api/search?q=" + encodeURIComponent(q));
    const groups = [
      ["Issues", r.issues.map((i) => ({ id: i.id, sub: i.typeLabel + " · " + (i.orderId || i.paymentId), action: "open-issue" }))],
      ["Orders", r.orders.map((o) => ({ id: o.order_id, sub: o.customer, action: "open-record" }))],
      ["Payments", r.payments.map((p) => ({ id: p.payment_id, sub: p.customer + " · " + cap(p.status), action: "open-record" }))]
    ].filter(([, list]) => list.length);
    if (!groups.length) { box.innerHTML = '<div class="search-row" style="color:var(--ink-2)">No matches for "' + esc(q) + '"</div>'; box.hidden = false; return; }
    box.innerHTML = groups.map(([title, list]) =>
      "<h5>" + title + "</h5>" + list.slice(0, 6).map((x) =>
        '<button class="search-row" data-action="' + x.action + '" data-id="' + esc(x.id) + '">' +
        '<span class="td-mono">' + esc(x.id) + '</span><span class="sr-sub">' + esc(x.sub) + "</span></button>"
      ).join("")).join("");
    box.hidden = false;
  } catch (e) {
    box.innerHTML = '<div class="search-row" style="color:var(--ink-2)">' + esc(e.message) + "</div>";
    box.hidden = false;
  }
}

/* ------------------------------------------------------------------ */
/* Actions dispatcher and global listeners                             */
/* ------------------------------------------------------------------ */
async function handleAction(a, d) {
  switch (a) {
    case "nav": navigate(d.route); break;
    case "open-issue": openIssue(d.id); break;
    case "open-record": openRecord(d.id); break;
    case "load-demo": loadDemo(); break;
    case "refresh": refresh(); break;
    case "run-reconcile": runReconcile(); break;
    case "import-files": importFiles(); break;
    case "razorpay-import": razorpayImport(); break;
    case "close-modal": closeModal(); break;
    case "review": setIssueState(d.id, "review"); break;
    case "resolve": setIssueState(d.id, "resolve"); break;
    case "note": {
      const note = prompt("Add a note for this issue");
      if (note !== null && note.trim()) setIssueState(d.id, "note", { note: note.trim() });
      break;
    }
    case "apply": {
      const iss = state.issues.find((x) => x.id === d.id);
      if (!iss) return;
      setIssueState(d.id, "note", { note: "Applied recommendation: " + iss.recommendation });
      setTimeout(() => setIssueState(d.id, "review"), 250);
      break;
    }
    case "agent-prompt": sendAgentMessage(d.q); break;
    case "copy-report": copyReport(); break;
    case "export-csv": exportCsv(); break;
  }
}

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (el) {
    const a = el.dataset.action;
    if (a === "open-issue" || a === "open-record" || a === "nav") $("#searchResults").hidden = true;
    handleAction(a, el.dataset);
    return;
  }
  if (!e.target.closest(".search-wrap")) { $("#searchResults").hidden = true; }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

$("#globalSearch").addEventListener("keydown", (e) => {
  if (e.key === "Enter") globalSearch(e.target.value.trim());
});
$("#globalSearch").addEventListener("input", debounce((e) => globalSearch(e.target.value.trim()), 350));
$("#refreshBtn").addEventListener("click", refresh);
$("#agentBtn").addEventListener("click", () => navigate("agent"));

window.addEventListener("hashchange", router);

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */
async function init() {
  try {
    const st = await api.get("/api/status");
    state.status = st;
    state.source = st.dataSource;
    state.lastReconciledAt = st.lastReconciledAt;
    if (st.loaded) {
      const sum = await api.get("/api/reconciliation/summary");
      if (sum && !sum.empty) {
        state.summary = sum;
        state.issues = await api.get("/api/issues");
      }
      try { state.orders = await api.get("/api/orders"); } catch (e) { /* optional */ }
      try { state.payments = await api.get("/api/payments"); } catch (e) { /* optional */ }
    }
  } catch (e) {
    toast(e.message, "error");
  }
  updateChrome();
  if (!location.hash) location.hash = "#/dashboard";
  router();
}

init();