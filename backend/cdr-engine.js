// cdr-engine.js
const axios = require("axios");

let allCalls = [];
let lastFetched = null;
let fetchError = null;
let totalFetched = 0;

// ─── Fetch ALL pages from Exotel ─────────────────────────────────────────
async function fetchCDR() {
  const accountSid = process.env.EXOTEL_ACCOUNT_SID;
  const apiKey     = process.env.EXOTEL_API_KEY;
  const apiToken   = process.env.EXOTEL_API_TOKEN;
  const subdomain  = process.env.EXOTEL_SUBDOMAIN || "api.in.exotel.com";

  if (!accountSid || !apiKey || !apiToken) {
    console.log("[CDR] Credentials not set — skipping.");
    return;
  }

  try {
    // Build today's date range
    // Convert to IST (UTC+5:30)
const now = new Date();
const istOffset = 5.5 * 60 * 60 * 1000; // 5hrs 30mins in ms
const istNow = new Date(now.getTime() + istOffset);
const istTomorrow = new Date(istNow);
istTomorrow.setDate(istTomorrow.getDate() + 1);

const fmt = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
const dateFilter = `gte:${fmt(istNow)} 00:00:00;lte:${fmt(istTomorrow)} 00:00:00`;

console.log(`[CDR] Fetching calls for IST date: ${fmt(istNow)}`);

    const baseUrl = `https://${subdomain}/v1/Accounts/${accountSid}/Calls.json`;
    const auth    = { username: apiKey, password: apiToken };

    let fetchedCalls = [];
    let afterCursor  = null;
    let page         = 1;
    let totalCount   = 0;
    const MAX_PAGES  = 50; // safety limit (50 x 100 = 5000 calls max)

    console.log(`[CDR] Starting paginated fetch for ${fmt(now)}...`);

    while (page <= MAX_PAGES) {
      // Build query string
      let query = `PageSize=100&SortBy=DateCreated:desc&DateCreated=${encodeURIComponent(dateFilter)}`;
      if (afterCursor) {
        query += `&After=${encodeURIComponent(afterCursor)}`;
      }

      const res = await axios.get(`${baseUrl}?${query}`, { auth, timeout: 15000 });
      const data = res.data;

      if (!data?.Calls?.length) {
        console.log(`[CDR] Page ${page}: No more calls. Done.`);
        break;
      }

      // On first page, log total
      if (page === 1) {
        totalCount = data?.Metadata?.Total || 0;
        console.log(`[CDR] Total calls today: ${totalCount}. Fetching all pages...`);
      }

      fetchedCalls = [...fetchedCalls, ...data.Calls];
      console.log(`[CDR] Page ${page}: fetched ${data.Calls.length} calls (total so far: ${fetchedCalls.length})`);

      // Get next page cursor from NextPageUri
      const nextUri = data?.Metadata?.NextPageUri;
      if (!nextUri) {
        console.log(`[CDR] No next page. All ${fetchedCalls.length} calls fetched.`);
        break;
      }

      // Extract After cursor from NextPageUri
      const afterMatch = nextUri.match(/After=([^&]+)/);
      if (!afterMatch) {
        console.log(`[CDR] Could not extract cursor. Stopping.`);
        break;
      }

      afterCursor = decodeURIComponent(afterMatch[1]);
      page++;

      // Small delay to avoid hitting rate limits (200 calls/min)
      await sleep(300);
    }

    // Parse and store all calls
    allCalls = fetchedCalls.map((c) => ({
      sid:         c.Sid,
      to:          cleanNumber(c.To),
      from:        cleanNumber(c.From),
      did:         cleanNumber(c.PhoneNumber),
      status:      (c.Status || "").toLowerCase(),
      direction:   (c.Direction || "").toLowerCase(),
      startTime:   c.StartTime  ? new Date(c.StartTime)  : null,
      endTime:     c.EndTime    ? new Date(c.EndTime)     : null,
      duration:    parseInt(c.Duration || 0),
      price:       parseFloat(c.Price   || 0),
      dateCreated: c.DateCreated ? new Date(c.DateCreated) : null,
      answeredBy:  c.AnsweredBy || "",
    }));

    totalFetched = allCalls.length;
    lastFetched  = new Date();
    fetchError   = null;

    console.log(`[CDR] ✅ Done! Total fetched: ${totalFetched} / ${totalCount} calls`);

  } catch (err) {
    fetchError = err.response
      ? `HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}`
      : err.message;
    console.error("[CDR] Fetch failed:", fetchError);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function pad(n)    { return String(n).padStart(2, "0"); }

function cleanNumber(num) {
  if (!num) return "";
  return num.toString().replace(/^sip:/i, "").replace(/[^0-9+]/g, "");
}

function isSuccess(s) { return s === "completed"; }
function isFailure(s) { return ["failed", "busy", "no-answer", "canceled"].includes(s); }

function callsToday() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return allCalls.filter((c) => c.dateCreated && c.dateCreated >= start);
}

function callsInWindow(minutes) {
  const cutoff = new Date(Date.now() - minutes * 60 * 1000);
  return allCalls.filter((c) => c.dateCreated && c.dateCreated >= cutoff);
}

function connectivity(calls) {
  if (!calls.length) return 0;
  return parseFloat(((calls.filter((c) => isSuccess(c.status)).length / calls.length) * 100).toFixed(2));
}

function avgDuration(calls) {
  const done = calls.filter((c) => isSuccess(c.status) && c.duration > 0);
  if (!done.length) return 0;
  return Math.round(done.reduce((a, b) => a + b.duration, 0) / done.length);
}

function statusBreakdown(calls) {
  const map = {};
  calls.forEach((c) => { map[c.status] = (map[c.status] || 0) + 1; });
  return map;
}

// ─── Module 1: Overview ───────────────────────────────────────────────────
function getOverview() {
  const today = callsToday();
  const live  = allCalls.filter((c) => c.status === "in-progress");
  const bd    = statusBreakdown(today);
  return {
    totalToday:   today.length,
    totalFetched,
    connected:    bd["completed"]  || 0,
    failed:       bd["failed"]     || 0,
    busy:         bd["busy"]       || 0,
    noAnswer:     bd["no-answer"]  || 0,
    canceled:     bd["canceled"]   || 0,
    inProgress:   live.length,
    connectivity: connectivity(today),
    avgDuration:  avgDuration(today),
    inbound:      today.filter((c) => c.direction === "inbound").length,
    outbound:     today.filter((c) => c.direction.includes("outbound")).length,
    lastFetched,
    fetchError,
  };
}

// ─── Module 2: Client-wise ────────────────────────────────────────────────
function getClientStats() {
  const clientMap = parseClientMap();
  const today = callsToday();
  if (!Object.keys(clientMap).length) return [];
  return Object.entries(clientMap).map(([name, dids]) => {
    const calls = today.filter((c) => dids.includes(c.did));
    const bd    = statusBreakdown(calls);
    return {
      client:       name,
      dids,
      total:        calls.length,
      connected:    bd["completed"] || 0,
      failed:       (bd["failed"] || 0) + (bd["busy"] || 0) + (bd["no-answer"] || 0),
      connectivity: connectivity(calls),
      avgDuration:  avgDuration(calls),
      inbound:      calls.filter((c) => c.direction === "inbound").length,
      outbound:     calls.filter((c) => c.direction.includes("outbound")).length,
    };
  });
}

// ─── Module 3: DID Health ─────────────────────────────────────────────────
function getDIDHealth() {
  const today  = callsToday();
  const didMap = {};
  today.forEach((c) => {
    if (!c.did) return;
    if (!didMap[c.did]) didMap[c.did] = [];
    didMap[c.did].push(c);
  });
  return Object.entries(didMap).map(([did, calls]) => {
    const bd   = statusBreakdown(calls);
    const conn = connectivity(calls);
    return {
      did,
      total:        calls.length,
      connected:    bd["completed"] || 0,
      failed:       (bd["failed"] || 0) + (bd["busy"] || 0) + (bd["no-answer"] || 0),
      connectivity: conn,
      avgDuration:  avgDuration(calls),
      health:       conn >= 98 ? "GOOD" : conn >= 90 ? "WARNING" : "CRITICAL",
      client:       getClientForDID(did),
    };
  }).sort((a, b) => a.connectivity - b.connectivity);
}

// ─── Module 4: Hourly Traffic ─────────────────────────────────────────────
function getHourlyTraffic() {
  const today = callsToday();
  const hours = {};
  for (let h = 0; h < 24; h++) {
    hours[h] = { hour: h, label: `${pad(h)}:00`, total: 0, connected: 0, failed: 0, inbound: 0, outbound: 0 };
  }
  today.forEach((c) => {
    if (!c.dateCreated) return;
    const h = c.dateCreated.getHours();
    hours[h].total++;
    if (isSuccess(c.status))              hours[h].connected++;
    if (isFailure(c.status))              hours[h].failed++;
    if (c.direction === "inbound")        hours[h].inbound++;
    if (c.direction.includes("outbound")) hours[h].outbound++;
  });
  return Object.values(hours).map((h) => ({
    ...h,
    connectivity: h.total ? parseFloat(((h.connected / h.total) * 100).toFixed(1)) : 0,
  }));
}

// ─── Module 5: Failure Analysis ───────────────────────────────────────────
function getFailureAnalysis() {
  const today  = callsToday();
  const last15 = callsInWindow(15);
  const bd     = statusBreakdown(today);
  return {
    breakdown:      bd,
    totalFailed:    today.filter((c) => isFailure(c.status)).length,
    failedLast15:   last15.filter((c) => isFailure(c.status)).length,
    hourlyFailed:   getHourlyTraffic().map((h) => ({ label: h.label, failed: h.failed })),
    topFailingDIDs: getDIDHealth().filter((d) => d.connectivity < 98).slice(0, 5),
    failureRate:    today.length
      ? parseFloat(((today.filter((c) => isFailure(c.status)).length / today.length) * 100).toFixed(2))
      : 0,
  };
}

// ─── Module 6: KPI ────────────────────────────────────────────────────────
function getConnectivityKPI() {
  const today   = callsToday();
  const last7d  = callsInWindow(7 * 24 * 60);
  const last30d = callsInWindow(30 * 24 * 60);
  const dailyMap = {};
  last7d.forEach((c) => {
    if (!c.dateCreated) return;
    const day = c.dateCreated.toISOString().split("T")[0];
    if (!dailyMap[day]) dailyMap[day] = [];
    dailyMap[day].push(c);
  });
  return {
    today:       connectivity(today),
    last7d:      connectivity(last7d),
    last30d:     connectivity(last30d),
    target:      98,
    todayTotal:  today.length,
    last7dTotal: last7d.length,
    hourly:      getHourlyTraffic(),
    daily:       Object.entries(dailyMap)
      .map(([day, calls]) => ({ day, connectivity: connectivity(calls), total: calls.length }))
      .sort((a, b) => a.day.localeCompare(b.day)),
  };
}

// ─── Alert Conditions ─────────────────────────────────────────────────────
function checkAlertConditions() {
  const today  = callsToday();
  const last15 = callsInWindow(15);
  const last30 = callsInWindow(30);
  const alerts = [];
  const hour   = new Date().getHours();
  const conn   = connectivity(today);

  if (today.length > 10 && conn < 98) {
    alerts.push({ type: "CONNECTIVITY", severity: conn < 95 ? "CRITICAL" : "WARNING", message: `Overall connectivity dropped to ${conn}% (target: 98%)`, value: conn, time: new Date().toISOString() });
  }
  const failedLast15 = last15.filter((c) => isFailure(c.status)).length;
  if (failedLast15 > 100) {
    alerts.push({ type: "FAILURE_SPIKE", severity: "CRITICAL", message: `${failedLast15} failed calls in last 15 minutes!`, value: failedLast15, time: new Date().toISOString() });
  }
  if (hour >= 9 && hour <= 21 && last30.length === 0) {
    alerts.push({ type: "SILENCE", severity: "WARNING", message: "No calls received in last 30 minutes during business hours!", value: 0, time: new Date().toISOString() });
  }
  getDIDHealth().filter((d) => d.total > 5 && d.connectivity < 95).forEach((d) => {
    alerts.push({ type: "DID_HEALTH", severity: d.connectivity < 90 ? "CRITICAL" : "WARNING", message: `DID ${d.did} connectivity at ${d.connectivity}%`, value: d.connectivity, did: d.did, time: new Date().toISOString() });
  });
  return alerts;
}

// ─── Client map helpers ───────────────────────────────────────────────────
function parseClientMap() {
  const raw = process.env.CLIENT_DID_MAP || "";
  if (!raw) return {};
  const map = {};
  raw.split(";").forEach((entry) => {
    const [client, dids] = entry.split(":");
    if (client && dids) {
      map[client.trim()] = dids.split(",").map((d) => d.trim().replace(/[^0-9+]/g, ""));
    }
  });
  return map;
}

function getClientForDID(did) {
  const map = parseClientMap();
  for (const [client, dids] of Object.entries(map)) {
    if (dids.includes(did)) return client;
  }
  return "Unknown";
}

// ─── Full stats ───────────────────────────────────────────────────────────
function getAllStats() {
  return {
    overview:  getOverview(),
    clients:   getClientStats(),
    didHealth: getDIDHealth(),
    hourly:    getHourlyTraffic(),
    failures:  getFailureAnalysis(),
    kpi:       getConnectivityKPI(),
    alerts:    checkAlertConditions(),
    lastFetched,
    fetchError,
  };
}

module.exports = { fetchCDR, getAllStats, getOverview, checkAlertConditions };
