// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { pingSipEndpoint } = require("./sip-pinger");
const { triggerAlerts, triggerCDRAlerts } = require("./alert-manager");
const { fetchCDR, getAllStats, checkAlertConditions } = require("./cdr-engine");

const app = express();
app.use(cors());
app.use(express.json());

// ─── SIP Endpoints ────────────────────────────────────────────────────────
function loadSipEndpoints() {
  const raw = process.env.SIP_ENDPOINTS || "";
  return raw.split(",").filter(Boolean).map((entry, idx) => {
    const [name, host, port] = entry.trim().split("|");
    return { id: idx + 1, name: name || `Endpoint ${idx + 1}`, host, port: parseInt(port || "5060") };
  });
}

let sipEndpoints = loadSipEndpoints();
let sipResults = {};
let sipHistory = {};
let sipAlertLog = [];

sipEndpoints.forEach((ep) => {
  sipResults[ep.id] = { status: "UNKNOWN", latency: null, code: null, reason: null, lastChecked: null };
  sipHistory[ep.id] = [];
});

async function checkSipEndpoint(ep) {
  const result = await pingSipEndpoint(ep.host, ep.port, 5000);
  sipResults[ep.id] = { status: result.status, latency: result.latency, code: result.code, reason: result.reason, lastChecked: new Date().toISOString() };
  sipHistory[ep.id] = [...(sipHistory[ep.id] || []).slice(-99), { time: new Date().toISOString(), status: result.status, latency: result.latency }];
  if (result.status !== "UP") {
    sipAlertLog = [{ id: `sip-${ep.id}-${Date.now()}`, type: "SIP Gateway", name: ep.name, status: result.status, reason: result.reason, time: new Date().toISOString() }, ...sipAlertLog].slice(0, 50);
    await triggerAlerts(ep, result);
  }
  console.log(`[SIP] ${ep.name} → ${result.status}`);
}

// ─── CDR Engine ───────────────────────────────────────────────────────────
let cdrAlertLog = [];

async function runCDRCheck() {
  await fetchCDR();
  const alerts = checkAlertConditions();
  if (alerts.length) {
    cdrAlertLog = [...alerts, ...cdrAlertLog].slice(0, 100);
    await triggerCDRAlerts(alerts);
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────────
const SIP_INTERVAL  = parseInt(process.env.CHECK_INTERVAL || "30") * 1000;
const CDR_INTERVAL  = parseInt(process.env.CDR_INTERVAL   || "300") * 1000; // 5 mins

setInterval(() => sipEndpoints.forEach(checkSipEndpoint), SIP_INTERVAL);
setInterval(runCDRCheck, CDR_INTERVAL);

// Startup
sipEndpoints.forEach(checkSipEndpoint);
runCDRCheck();

// ─── REST APIs ────────────────────────────────────────────────────────────

// SIP status
app.get("/api/sip/status", (req, res) => {
  res.json({
    endpoints: sipEndpoints.map((ep) => ({
      ...ep, ...sipResults[ep.id],
      history: (sipHistory[ep.id] || []).slice(-30),
      uptime: calcUptime(ep.id),
    })),
  });
});

// CDR stats — all modules in one call
app.get("/api/cdr/stats", (req, res) => {
  res.json(getAllStats());
});

// Individual modules
app.get("/api/cdr/overview",    (req, res) => res.json(getAllStats().overview));
app.get("/api/cdr/clients",     (req, res) => res.json(getAllStats().clients));
app.get("/api/cdr/did-health",  (req, res) => res.json(getAllStats().didHealth));
app.get("/api/cdr/hourly",      (req, res) => res.json(getAllStats().hourly));
app.get("/api/cdr/failures",    (req, res) => res.json(getAllStats().failures));
app.get("/api/cdr/kpi",         (req, res) => res.json(getAllStats().kpi));

// All alerts combined
app.get("/api/alerts", (req, res) => {
  res.json({ alerts: [...cdrAlertLog, ...sipAlertLog].sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 100) });
});

// Manual triggers
app.post("/api/sip/check",    async (req, res) => { await Promise.all(sipEndpoints.map(checkSipEndpoint)); res.json({ ok: true }); });
app.post("/api/cdr/refresh",  async (req, res) => { await runCDRCheck(); res.json({ ok: true }); });

// Health
app.get("/api/health", (req, res) => res.json({ ok: true }));

function calcUptime(id) {
  const h = sipHistory[id] || [];
  if (!h.length) return null;
  return ((h.filter((e) => e.status === "UP").length / h.length) * 100).toFixed(2);
}

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`[SERVER] Running on port ${PORT}`));
