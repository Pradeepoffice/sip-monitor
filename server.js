// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cron = require("node-cron");
const { pingSipEndpoint } = require("./sip-pinger");
const { triggerAlerts } = require("./alert-manager");

const app = express();
app.use(cors());
app.use(express.json());

// ─── Load endpoints from ENV ───────────────────────────────────────────────
function loadEndpoints() {
  const raw = process.env.SIP_ENDPOINTS || "";
  return raw.split(",").filter(Boolean).map((entry, idx) => {
    const [name, host, port] = entry.trim().split("|");
    return { id: idx + 1, name: name || `Endpoint ${idx + 1}`, host, port: parseInt(port || "5060") };
  });
}

// ─── In-memory state ────────────────────────────────────────────────────────
let endpoints = loadEndpoints();
let results = {};   // { endpointId: { status, latency, code, reason, lastChecked } }
let history = {};   // { endpointId: [ { time, status } ] }
let alertLog = [];  // [ { id, endpointId, name, status, reason, time } ]

endpoints.forEach((ep) => {
  results[ep.id] = { status: "UNKNOWN", latency: null, code: null, reason: null, lastChecked: null };
  history[ep.id] = [];
});

// ─── Core check function ────────────────────────────────────────────────────
async function checkEndpoint(ep) {
  console.log(`[CHECK] Pinging ${ep.name} (${ep.host}:${ep.port})`);
  const result = await pingSipEndpoint(ep.host, ep.port, 5000);

  results[ep.id] = {
    status: result.status,
    latency: result.latency,
    code: result.code,
    reason: result.reason,
    lastChecked: new Date().toISOString(),
  };

  history[ep.id] = [
    ...(history[ep.id] || []).slice(-99),
    { time: new Date().toISOString(), status: result.status, latency: result.latency },
  ];

  if (result.status !== "UP") {
    const alert = {
      id: `${ep.id}-${Date.now()}`,
      endpointId: ep.id,
      name: ep.name,
      host: ep.host,
      port: ep.port,
      status: result.status,
      code: result.code,
      reason: result.reason,
      time: new Date().toISOString(),
    };
    alertLog = [alert, ...alertLog].slice(0, 100);
    await triggerAlerts(ep, result);
  }

  console.log(`[CHECK] ${ep.name} → ${result.status} | ${result.latency ? result.latency + "ms" : "N/A"} | ${result.code || result.reason}`);
}

async function checkAll() {
  await Promise.all(endpoints.map(checkEndpoint));
}

// ─── Cron job ───────────────────────────────────────────────────────────────
const intervalSec = parseInt(process.env.CHECK_INTERVAL || "30");
const cronExpr = `*/${Math.max(1, Math.floor(intervalSec / 60))} * * * *`;

// For intervals < 60s use a JS interval instead
let cronJob = null;
if (intervalSec < 60) {
  setInterval(checkAll, intervalSec * 1000);
} else {
  cronJob = cron.schedule(cronExpr, checkAll);
}

// Run immediately on startup
checkAll();

// ─── REST API ───────────────────────────────────────────────────────────────

// GET /api/status — all endpoints + latest result
app.get("/api/status", (req, res) => {
  const data = endpoints.map((ep) => ({
    ...ep,
    ...results[ep.id],
    uptime: calcUptime(ep.id),
  }));
  res.json({ endpoints: data, checkedAt: new Date().toISOString() });
});

// GET /api/history/:id — history for one endpoint
app.get("/api/history/:id", (req, res) => {
  const id = parseInt(req.params.id);
  res.json({ history: history[id] || [] });
});

// GET /api/alerts — recent alert log
app.get("/api/alerts", (req, res) => {
  res.json({ alerts: alertLog });
});

// POST /api/check/:id — manual trigger for one endpoint
app.post("/api/check/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const ep = endpoints.find((e) => e.id === id);
  if (!ep) return res.status(404).json({ error: "Endpoint not found" });
  await checkEndpoint(ep);
  res.json({ result: results[ep.id] });
});

// POST /api/check — manual trigger all
app.post("/api/check", async (req, res) => {
  await checkAll();
  res.json({ message: "All endpoints checked" });
});

// GET /api/health — server health check for Render
app.get("/api/health", (req, res) => res.json({ ok: true }));

// ─── Helpers ────────────────────────────────────────────────────────────────
function calcUptime(id) {
  const h = history[id] || [];
  if (!h.length) return null;
  const up = h.filter((e) => e.status === "UP").length;
  return ((up / h.length) * 100).toFixed(2);
}

// ─── Start server ───────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`SIP Monitor backend running on port ${PORT}`);
  console.log(`Monitoring ${endpoints.length} endpoint(s) every ${intervalSec}s`);
  endpoints.forEach((ep) => console.log(`  - ${ep.name} → ${ep.host}:${ep.port}`));
});
