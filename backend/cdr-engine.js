// cdr-engine.js
const axios = require("axios");

let allCalls     = [];
let lastFetched  = null;
let fetchError   = null;
let totalFetched = 0;

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
    const now         = new Date();
    const istOffset   = 5.5 * 60 * 60 * 1000;
    const istNow      = new Date(now.getTime() + istOffset);
    const istTomorrow = new Date(istNow);
    istTomorrow.setDate(istTomorrow.getDate() + 1);
    const fmt        = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
    const dateFilter = `gte:${fmt(istNow)} 00:00:00;lte:${fmt(istTomorrow)} 00:00:00`;

    const baseUrl = `https://${subdomain}/v1/Accounts/${accountSid}/Calls.json`;
    const auth    = { username: apiKey, password: apiToken };

    let fetchedCalls = [];
    let afterCursor  = null;
    let page         = 1;
    let totalCount   = 0;
    const MAX_PAGES  = 50;

    console.log(`[CDR] Fetching IST date: ${fmt(istNow)}...`);

    while (page <= MAX_PAGES) {
      let query = `PageSize=100&SortBy=DateCreated:desc&DateCreated=${encodeURIComponent(dateFilter)}`;
      if (afterCursor) query += `&After=${encodeURIComponent(afterCursor)}`;

      const res  = await axios.get(`${baseUrl}?${query}`, { auth, timeout: 15000 });
      const data = res.data;

      if (!data?.Calls?.length) {
        console.log(`[CDR] Page ${page}: No more calls.`);
        break;
      }

      if (page === 1) {
        totalCount = data?.Metadata?.Total || 0;
        console.log(`[CDR] Total today: ${totalCount}. Paginating...`);
      }

      fetchedCalls = [...fetchedCalls, ...data.Calls];
      console.log(`[CDR] Page ${page}: ${data.Calls.length} calls (so far: ${fetchedCalls.length})`);

      const nextUri = data?.Metadata?.NextPageUri;
      if (!nextUri) {
        console.log(`[CDR] Done. All ${fetchedCalls.length} fetched.`);
        break;
      }

      const afterMatch = nextUri.match(/After=([^&]+)/);
      if (!afterMatch) break;
      afterCursor = decodeURIComponent(afterMatch[1]);
      page++;
      await sleep(300);
    }

    allCalls = fetchedCalls.map((c) => ({
      sid:         c.Sid,
      to:          c.To || "",
      toClean:     cleanNumber(c.To),
      from:        cleanNumber(c.From),
      did:         cleanNumber(c.PhoneNumber),
      status:      (c.Status || "").toLowerCase(),
      direction:   (c.Direction || "").toLowerCase(),
      startTime:   c.StartTime   ? new Date(c.StartTime)   : null,
      endTime:     c.EndTime     ? new Date(c.EndTime)     : null,
      duration:    parseInt(c.Duration || 0),
      price:       parseFloat(c.Price   || 0),
      dateCreated: c.DateCreated ? new Date(c.DateCreated) : null,
      answeredBy:  c.AnsweredBy  || "",
      isAgentCall: (c.To || "").toLowerCase().startsWith("sip:tr"),
    }));

    totalFetched = allCalls.length;
    lastFetched  = new Date();
    fetchError   = null;
    console.log(`[CDR] Done! ${totalFetched} / ${totalCount} calls fetched.`);

  } catch (err) {
    fetchError = err.response
      ? `HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}`
      : err.message;
    console.error("[CDR] Fetch failed:", fetchError);
  }
}

function sleep(ms)  { return new Promise((r) => setTimeout(r, ms)); }
function pad(n)     { return String(n).padStart(2, "0"); }
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

function getOverview() {
  const today      = callsToday();
  const live       = allCalls.filter((c) => c.status === "in-progress");
  const bd         = statusBreakdown(today);
  const agentCalls = today.filter((c) => c.isAgentCall);
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
    agentCalls:   agentCalls.length,
    lastFetched,
    fetchError,
  };
}

function getClientStats() {
  const clientMap = parseClientMap();
  const today     = callsToday();
  if (!Object.keys(clientMap).length) return [];
  return Object.entries(clientMap).map(([name, config]) => {
    const { did, trunkId } = config;
    const calls      = today.filter((c) => c.did === did);
    const agentCalls = calls.filter((c) => trunkId ? c.to === trunkId : c.isAgentCall);
    const bd         = statusBreakdown(calls);
    return {
      client:       name,
      did,
      trunkId:      trunkId || "",
      total:        calls.length,
      connected:    bd["completed"] || 0,
      failed:       (bd["failed"] || 0) + (bd["busy"] || 0) + (bd["no-answer"] || 0),
      connectivity: connectivity(calls),
      avgDuration:  avgDuration(calls),
      inbound:      calls.filter((c) => c.direction === "inbound").length,
      outbound:     calls.filter((c) => c.direction.includes("outbound")).length,
      agentCalls:   agentCalls.length,
    };
  });
}

function getDIDHealth() {
  const today     = callsToday();
  const clientMap = parseClientMap();
  const didMap    = {};
  const didTrunkMap = {};
  Object.values(clientMap).forEach(({ did, trunkId }) => {
    if (did && trunkId) didTrunkMap[did] = trunkId;
  });
  today.forEach((c) => {
    if (!c.did) return;
    if (!didMap[c.did]) didMap[c.did] = [];
    didMap[c.did].push(c);
  });
  return Object.entries(didMap).map(([did, calls]) => {
    const bd         = statusBreakdown(calls);
    const conn       = connectivity(calls);
    const trunkId    = didTrunkMap[did];
    const agentCalls = calls.filter((c) => trunkId ? c.to === trunkId : c.isAgentCall);
    return {
      did,
      total:        calls.length,
      connected:    bd["completed"] || 0,
      failed:       (bd["failed"] || 0) + (bd["busy"] || 0) + (bd["no-answer"] || 0),
      connectivity: conn,
      avgDuration:  avgDuration(calls),
      health:       conn >= 98 ? "GOOD" : conn >= 90 ? "WARNING" : "CRITICAL",
      client:       getClientForDID(did),
      agentCalls:   agentCalls.length,
      trunkId:      trunkId || "",
    };
  }).sort((a, b) => a.connectivity - b.connectivity);
}

function getHourlyTraffic() {
  const today = callsToday();
  const hours = {};
  for (let h = 0; h < 24; h++) {
    hours[h] = { hour: h, label: `${pad(h)}:00`, total: 0, connected: 0, failed: 0, inbound: 0, outbound: 0, agentCalls: 0 };
  }
  today.forEach((c) => {
    if (!c.dateCreated) return;
    const h = c.dateCreated.getHours();
    hours[h].total++;
    if (isSuccess(c.status))              hours[h].connected++;
    if (isFailure(c.status))              hours[h].failed++;
    if (c.direction === "inbound")        hours[h].inbound++;
    if (c.direction.includes("outbound")) hours[h].outbound++;
    if (c.isAgentCall)                    hours[h].agentCalls++;
  });
  return Object.values(hours).map((h) => ({
    ...h,
    connectivity: h.total ? parseFloat(((h.connected / h.total) * 100).toFixed(1)) : 0,
  }));
}

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
    alerts.push({ type: "SILENCE", severity: "WARNING", message: "No calls in last 30 minutes during business hours!", value: 0, time: new Date().toISOString() });
  }
  getDIDHealth().filter((d) => d.total > 5 && d.connectivity < 95).forEach((d) => {
    alerts.push({ type: "DID_HEALTH", severity: d.connectivity < 90 ? "CRITICAL" : "WARNING", message: `DID ${d.did} connectivity at ${d.connectivity}%`, value: d.connectivity, did: d.did, time: new Date().toISOString() });
  });
  return alerts;
}

// ENV: CLIENT_DID_MAP=Atomberg:01585580321:sip:trmum1xxx;Spinny:01585580322:sip:trmum2xxx
function parseClientMap() {
  const raw = process.env.CLIENT_DID_MAP || "";
  if (!raw) return {};
  const map = {};
  raw.split(";").forEach((entry) => {
    const firstColon  = entry.indexOf(":");
    const secondColon = entry.indexOf(":", firstColon + 1);
    if (firstColon === -1 || secondColon === -1) return;
    const client  = entry.substring(0, firstColon).trim();
    const did     = entry.substring(firstColon + 1, secondColon).trim().replace(/[^0-9+]/g, "");
    const trunkId = entry.substring(secondColon + 1).trim();
    if (client && did) map[client] = { did, trunkId: trunkId || null };
  });
  return map;
}

function getClientForDID(did) {
  const map = parseClientMap();
  for (const [client, config] of Object.entries(map)) {
    if (config.did === did) return client;
  }
  return "Unknown";
}

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
// ─── Live Voicebot Streams ─────────────────────────────────────────────────
let liveStreamData = { active: 0, limit: 0, utilization: 0, lastChecked: null, error: null };

async function fetchActiveStreams() {
  const accountSid = process.env.EXOTEL_ACCOUNT_SID;
  const apiKey     = process.env.EXOTEL_API_KEY;
  const apiToken   = process.env.EXOTEL_API_TOKEN;
  const subdomain  = process.env.EXOTEL_SUBDOMAIN || "api.in.exotel.com";

  if (!accountSid || !apiKey || !apiToken) return;

  try {
    const url = `https://${subdomain}/v1/Accounts/${accountSid}/ActiveStreams`;
    const res = await axios.get(url, {
      auth: { username: apiKey, password: apiToken },
      timeout: 10000,
    });

    const xml = res.data;
    const activeMatch = xml.match(/<ActiveStreamCount>(\d+)<\/ActiveStreamCount>/);
    const limitMatch  = xml.match(/<ThrottleLimit>(\d+)<\/ThrottleLimit>/);

    const active = activeMatch ? parseInt(activeMatch[1]) : 0;
    const limit  = limitMatch  ? parseInt(limitMatch[1])  : 0;

    liveStreamData = {
      active,
      limit,
      utilization: limit ? parseFloat(((active / limit) * 100).toFixed(1)) : 0,
      lastChecked: new Date().toISOString(),
      error: null,
    };

    console.log(`[STREAMS] Active: ${active} / ${limit} (${liveStreamData.utilization}%)`);
  } catch (err) {
    liveStreamData.error = err.message;
    console.error("[STREAMS] Fetch failed:", err.message);
  }
}

function getLiveStreams() {
  return liveStreamData;
}

module.exports = { fetchCDR, getAllStats, getOverview, checkAlertConditions };
