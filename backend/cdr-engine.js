// cdr-engine.js — Exotel CDR Fetcher + Analyzer
const axios = require("axios");

// ─── In-memory store ──────────────────────────────────────────────────────
let allCalls = [];         // raw CDR records
let lastFetched = null;
let fetchError = null;

// ─── Fetch CDR from Exotel ────────────────────────────────────────────────
async function fetchCDR() {
  const accountSid  = process.env.EXOTEL_ACCOUNT_SID;
  const apiKey      = process.env.EXOTEL_API_KEY;
  const apiToken    = process.env.EXOTEL_API_TOKEN;
  const subdomain   = process.env.EXOTEL_SUBDOMAIN || "api.in.exotel.com";

  if (!accountSid || !apiKey || !apiToken) {
    console.log("[CDR] Exotel credentials not set — skipping fetch.");
    return;
  }

  try {
    // Fetch last 500 calls sorted by latest first
    // Get today's date range in IST
const now = new Date();
const todayStart = new Date(now);
todayStart.setHours(0, 0, 0, 0);
const pad = (n) => String(n).padStart(2, "0");
const fmtDate = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

const dateFilter = `gte:${fmtDate(todayStart)}`;

const url = `https://${apiKey}:${apiToken}@${subdomain}/v1/Accounts/${accountSid}/Calls.json`;
const params = {
  PageSize: 500,
  SortBy: "DateCreated:desc",
  DateCreated: dateFilter,
};

const res = await axios.get(url, { params, timeout: 15000 });
    const calls = res.data?.Calls || [];

    allCalls = calls.map((c) => ({
      sid:        c.Sid,
      to:         normalizeNumber(c.To),
      from:       normalizeNumber(c.From),
      did:        normalizeNumber(c.PhoneNumberSid || c.To),
      status:     (c.Status || "").toLowerCase(),
      direction:  (c.Direction || "").toLowerCase(),
      startTime:  c.StartTime ? new Date(c.StartTime) : null,
      endTime:    c.EndTime   ? new Date(c.EndTime)   : null,
      duration:   parseInt(c.Duration || 0),
      price:      parseFloat(c.Price  || 0),
      dateCreated: c.DateCreated ? new Date(c.DateCreated) : null,
    }));

    lastFetched = new Date();
    fetchError  = null;
    console.log(`[CDR] Fetched ${allCalls.length} calls from Exotel`);
  } catch (err) {
    fetchError = err.message;
    console.error("[CDR] Fetch failed:", err.message);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function normalizeNumber(num) {
  if (!num) return "";
  return num.toString().replace(/[^0-9+]/g, "");
}

function isSuccess(status) {
  return status === "completed";
}

function isFailure(status) {
  return ["failed", "busy", "no-answer", "canceled"].includes(status);
}

function callsInWindow(minutes) {
  const cutoff = new Date(Date.now() - minutes * 60 * 1000);
  return allCalls.filter((c) => c.dateCreated && c.dateCreated >= cutoff);
}

function callsToday() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return allCalls.filter((c) => c.dateCreated && c.dateCreated >= start);
}

function connectivity(calls) {
  if (!calls.length) return 100;
  const completed = calls.filter((c) => isSuccess(c.status)).length;
  return parseFloat(((completed / calls.length) * 100).toFixed(2));
}

function avgDuration(calls) {
  const completed = calls.filter((c) => isSuccess(c.status) && c.duration > 0);
  if (!completed.length) return 0;
  const total = completed.reduce((a, b) => a + b.duration, 0);
  return Math.round(total / completed.length);
}

function statusBreakdown(calls) {
  const map = {};
  calls.forEach((c) => {
    map[c.status] = (map[c.status] || 0) + 1;
  });
  return map;
}

// ─── Module 1: Real-Time Overview ────────────────────────────────────────
function getOverview() {
  const today = callsToday();
  const live  = allCalls.filter((c) => c.status === "in-progress");
  const breakdown = statusBreakdown(today);

  return {
    totalToday:      today.length,
    connected:       breakdown["completed"]  || 0,
    failed:          breakdown["failed"]     || 0,
    busy:            breakdown["busy"]       || 0,
    noAnswer:        breakdown["no-answer"]  || 0,
    canceled:        breakdown["canceled"]   || 0,
    inProgress:      live.length,
    connectivity:    connectivity(today),
    avgDuration:     avgDuration(today),
    inbound:         today.filter((c) => c.direction.includes("inbound")).length,
    outbound:        today.filter((c) => c.direction.includes("outbound")).length,
    lastFetched,
    fetchError,
  };
}

// ─── Module 2: Client-wise Dashboard ─────────────────────────────────────
function getClientStats() {
  const clientMap = parseClientMap();
  const today = callsToday();

  return Object.entries(clientMap).map(([clientName, dids]) => {
    const clientCalls = today.filter((c) => dids.includes(c.did) || dids.includes(c.to));
    const breakdown = statusBreakdown(clientCalls);
    return {
      client:       clientName,
      dids,
      total:        clientCalls.length,
      connected:    breakdown["completed"] || 0,
      failed:       (breakdown["failed"] || 0) + (breakdown["busy"] || 0) + (breakdown["no-answer"] || 0),
      connectivity: connectivity(clientCalls),
      avgDuration:  avgDuration(clientCalls),
      inbound:      clientCalls.filter((c) => c.direction.includes("inbound")).length,
      outbound:     clientCalls.filter((c) => c.direction.includes("outbound")).length,
    };
  });
}

// ─── Module 3: DID Health ─────────────────────────────────────────────────
function getDIDHealth() {
  const today = callsToday();
  const didMap = {};

  today.forEach((c) => {
    const did = c.did || c.to;
    if (!did) return;
    if (!didMap[did]) didMap[did] = [];
    didMap[did].push(c);
  });

  return Object.entries(didMap).map(([did, calls]) => {
    const breakdown = statusBreakdown(calls);
    const conn = connectivity(calls);
    return {
      did,
      total:        calls.length,
      connected:    breakdown["completed"] || 0,
      failed:       (breakdown["failed"] || 0) + (breakdown["busy"] || 0) + (breakdown["no-answer"] || 0),
      connectivity: conn,
      avgDuration:  avgDuration(calls),
      health:       conn >= 98 ? "GOOD" : conn >= 90 ? "WARNING" : "CRITICAL",
      client:       getClientForDID(did),
    };
  }).sort((a, b) => a.connectivity - b.connectivity); // worst first
}

// ─── Module 4: Hourly Traffic ─────────────────────────────────────────────
function getHourlyTraffic() {
  const today = callsToday();
  const hours = {};

  for (let h = 0; h < 24; h++) {
    hours[h] = { hour: h, total: 0, connected: 0, failed: 0, inbound: 0, outbound: 0 };
  }

  today.forEach((c) => {
    if (!c.dateCreated) return;
    const h = c.dateCreated.getHours();
    hours[h].total++;
    if (isSuccess(c.status)) hours[h].connected++;
    if (isFailure(c.status)) hours[h].failed++;
    if (c.direction.includes("inbound"))  hours[h].inbound++;
    if (c.direction.includes("outbound")) hours[h].outbound++;
  });

  return Object.values(hours).map((h) => ({
    ...h,
    label: `${String(h.hour).padStart(2, "0")}:00`,
    connectivity: h.total ? parseFloat(((h.connected / h.total) * 100).toFixed(1)) : 0,
  }));
}

// ─── Module 5: Failure Analysis ───────────────────────────────────────────
function getFailureAnalysis() {
  const today = callsToday();
  const last15 = callsInWindow(15);
  const breakdown = statusBreakdown(today);

  // Failure trend per hour
  const hourlyFailed = getHourlyTraffic().map((h) => ({
    label: h.label,
    failed: h.failed,
  }));

  // Top failing DIDs
  const didHealth = getDIDHealth();
  const topFailing = didHealth.filter((d) => d.connectivity < 98).slice(0, 5);

  return {
    breakdown,
    totalFailed:   today.filter((c) => isFailure(c.status)).length,
    failedLast15:  last15.filter((c) => isFailure(c.status)).length,
    hourlyFailed,
    topFailingDIDs: topFailing,
    failureRate:   today.length ? parseFloat(((today.filter((c) => isFailure(c.status)).length / today.length) * 100).toFixed(2)) : 0,
  };
}

// ─── Module 6: Connectivity KPI ──────────────────────────────────────────
function getConnectivityKPI() {
  const today   = callsToday();
  const last7d  = callsInWindow(7 * 24 * 60);
  const last30d = callsInWindow(30 * 24 * 60);

  // Hourly connectivity for today
  const hourly = getHourlyTraffic().map((h) => ({
    label: h.label,
    connectivity: h.connectivity,
    total: h.total,
  }));

  // Daily breakdown for last 7 days
  const dailyMap = {};
  last7d.forEach((c) => {
    if (!c.dateCreated) return;
    const day = c.dateCreated.toISOString().split("T")[0];
    if (!dailyMap[day]) dailyMap[day] = [];
    dailyMap[day].push(c);
  });

  const daily = Object.entries(dailyMap).map(([day, calls]) => ({
    day,
    connectivity: connectivity(calls),
    total: calls.length,
  })).sort((a, b) => a.day.localeCompare(b.day));

  return {
    today:    connectivity(today),
    last7d:   connectivity(last7d),
    last30d:  connectivity(last30d),
    target:   98,
    todayTotal:  today.length,
    last7dTotal: last7d.length,
    hourly,
    daily,
  };
}

// ─── Module 7: Alerts ────────────────────────────────────────────────────
function checkAlertConditions() {
  const today   = callsToday();
  const last15  = callsInWindow(15);
  const last30  = callsInWindow(30);
  const alerts  = [];

  // 1. Connectivity < 98%
  const conn = connectivity(today);
  if (today.length > 10 && conn < 98) {
    alerts.push({
      type:     "CONNECTIVITY",
      severity: conn < 95 ? "CRITICAL" : "WARNING",
      message:  `Overall connectivity dropped to ${conn}% (target: 98%)`,
      value:    conn,
      time:     new Date().toISOString(),
    });
  }

  // 2. Failed > 100 in 15 mins
  const failedLast15 = last15.filter((c) => isFailure(c.status)).length;
  if (failedLast15 > 100) {
    alerts.push({
      type:     "FAILURE_SPIKE",
      severity: "CRITICAL",
      message:  `${failedLast15} failed calls in last 15 minutes!`,
      value:    failedLast15,
      time:     new Date().toISOString(),
    });
  }

  // 3. No calls in 30 mins (during business hours 9AM-9PM IST)
  const hour = new Date().getHours();
  if (hour >= 9 && hour <= 21 && last30.length === 0) {
    alerts.push({
      type:     "SILENCE",
      severity: "WARNING",
      message:  "No calls received in last 30 minutes during business hours!",
      value:    0,
      time:     new Date().toISOString(),
    });
  }

  // 4. Per DID connectivity < 95%
  const didHealth = getDIDHealth();
  didHealth.filter((d) => d.total > 5 && d.connectivity < 95).forEach((d) => {
    alerts.push({
      type:     "DID_HEALTH",
      severity: d.connectivity < 90 ? "CRITICAL" : "WARNING",
      message:  `DID ${d.did} connectivity at ${d.connectivity}%`,
      value:    d.connectivity,
      did:      d.did,
      time:     new Date().toISOString(),
    });
  });

  return alerts;
}

// ─── Helpers for client mapping ───────────────────────────────────────────
function parseClientMap() {
  const raw = process.env.CLIENT_DID_MAP || "";
  if (!raw) return {};
  const map = {};
  raw.split(";").forEach((entry) => {
    const [client, dids] = entry.split(":");
    if (client && dids) {
      map[client.trim()] = dids.split(",").map((d) => normalizeNumber(d.trim()));
    }
  });
  return map;
}

function getClientForDID(did) {
  const clientMap = parseClientMap();
  for (const [client, dids] of Object.entries(clientMap)) {
    if (dids.includes(did)) return client;
  }
  return "Unknown";
}

// ─── Full stats for API ───────────────────────────────────────────────────
function getAllStats() {
  return {
    overview:     getOverview(),
    clients:      getClientStats(),
    didHealth:    getDIDHealth(),
    hourly:       getHourlyTraffic(),
    failures:     getFailureAnalysis(),
    kpi:          getConnectivityKPI(),
    alerts:       checkAlertConditions(),
    lastFetched,
    fetchError,
  };
}

module.exports = { fetchCDR, getAllStats, getOverview, checkAlertConditions };
