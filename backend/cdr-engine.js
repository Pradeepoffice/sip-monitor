// cdr-engine.js
const axios = require("axios");

let allCalls     = [];
let lastFetched  = null;
let fetchError   = null;
let totalFetched = 0;

async function fetchCDR() {
  const accountsRaw = process.env.EXOTEL_ACCOUNTS || "";
  if (!accountsRaw) {
    console.log("[CDR] EXOTEL_ACCOUNTS not set — skipping.");
    return;
  }

  // Parse: Label:SID:APIKey:APIToken;Label2:SID2:APIKey2:APIToken2
  const accounts = accountsRaw.split(";").filter(Boolean).map((entry) => {
    const parts = entry.split(":");
    return {
      label:     parts[0]?.trim(),
      sid:       parts[1]?.trim(),
      apiKey:    parts[2]?.trim(),
      apiToken:  parts[3]?.trim(),
    };
  }).filter((a) => a.label && a.sid && a.apiKey && a.apiToken);

  if (!accounts.length) {
    console.log("[CDR] No valid accounts parsed from EXOTEL_ACCOUNTS.");
    return;
  }

  const subdomain = process.env.EXOTEL_SUBDOMAIN || "api.in.exotel.com";

  // IST date range
  const now         = new Date();
  const istOffset   = 5.5 * 60 * 60 * 1000;
  const istNow      = new Date(now.getTime() + istOffset);
  const istTomorrow = new Date(istNow);
  istTomorrow.setDate(istTomorrow.getDate() + 1);
  const fmt        = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
  const dateFilter = `gte:${fmt(istNow)} 00:00:00;lte:${fmt(istTomorrow)} 00:00:00`;

  console.log(`[CDR] Fetching IST date: ${fmt(istNow)} across ${accounts.length} account(s)...`);

  let mergedCalls = [];
  let anyError = null;

  // Fetch each account sequentially (avoids rate limit issues across accounts)
  for (const account of accounts) {
    try {
      const calls = await fetchAccountCDR(account, subdomain, dateFilter);
      console.log(`[CDR] [${account.label}] fetched ${calls.length} calls`);
      mergedCalls = [...mergedCalls, ...calls];
    } catch (err) {
      const msg = err.response
        ? `HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}`
        : err.message;
      console.error(`[CDR] [${account.label}] fetch failed:`, msg);
      anyError = `${account.label}: ${msg}`;
    }
  }

  allCalls     = mergedCalls;
  totalFetched = allCalls.length;
  lastFetched  = new Date();
  fetchError   = anyError; // shows last error if any account failed, but still uses data from others

  console.log(`[CDR] Done! Total merged calls across all accounts: ${totalFetched}`);
}

// ─── Fetch CDR for ONE account (with pagination) ─────────────────────────
async function fetchAccountCDR(account, subdomain, dateFilter) {
  const { label, sid, apiKey, apiToken } = account;
  const baseUrl = `https://${subdomain}/v1/Accounts/${sid}/Calls.json`;
  const auth    = { username: apiKey, password: apiToken };

  let fetchedCalls = [];
  let afterCursor  = null;
  let page         = 1;
  const MAX_PAGES  = 50;

  while (page <= MAX_PAGES) {
    let query = `PageSize=100&SortBy=DateCreated:desc&DateCreated=${encodeURIComponent(dateFilter)}`;
    if (afterCursor) query += `&After=${encodeURIComponent(afterCursor)}`;

    const res  = await axios.get(`${baseUrl}?${query}`, { auth, timeout: 15000 });
    const data = res.data;

    if (!data?.Calls?.length) break;

    fetchedCalls = [...fetchedCalls, ...data.Calls];

    const nextUri = data?.Metadata?.NextPageUri;
    if (!nextUri) break;

    const afterMatch = nextUri.match(/After=([^&]+)/);
    if (!afterMatch) break;
    afterCursor = decodeURIComponent(afterMatch[1]);
    page++;
    await sleep(300);
  }

  // Map and tag with account label
  return fetchedCalls.map((c) => ({
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
    account:     label,   // ← NEW: tag which account this call belongs to
  }));
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
  const totalCost  = today.reduce((sum, c) => sum + (c.price || 0), 0);
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
    totalCost:    parseFloat(totalCost.toFixed(2)),
    avgCostPerCall: today.length ? parseFloat((totalCost / today.length).toFixed(2)) : 0,
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

  // Build set of allowed DIDs (only those mapped to a client)
  const allowedDIDs = new Set();
  Object.values(clientMap).forEach(({ did, trunkId }) => {
    if (did) allowedDIDs.add(did);
    if (did && trunkId) didTrunkMap[did] = trunkId;
  });

  today.forEach((c) => {
    if (!c.did) return;
    if (!allowedDIDs.has(c.did)) return;  // ← Skip DIDs not in CLIENT_DID_MAP
    if (!didMap[c.did]) didMap[c.did] = [];
    didMap[c.did].push(c);
  });

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
    liveStreams: getLiveStreams(),
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

let liveStreamData = { active: 0, limit: 0, utilization: 0, lastChecked: null, error: null, byAccount: [] };

async function fetchActiveStreams() {
  const accountsRaw = process.env.EXOTEL_ACCOUNTS || "";
  if (!accountsRaw) return;

  const accounts = accountsRaw.split(";").filter(Boolean).map((entry) => {
    const parts = entry.split(":");
    return { label: parts[0]?.trim(), sid: parts[1]?.trim(), apiKey: parts[2]?.trim(), apiToken: parts[3]?.trim() };
  }).filter((a) => a.label && a.sid && a.apiKey && a.apiToken);

  const subdomain = process.env.EXOTEL_SUBDOMAIN || "api.in.exotel.com";

  let totalActive = 0;
  let totalLimit  = 0;
  const byAccount = [];

  for (const account of accounts) {
    try {
      const url = `https://${subdomain}/v1/Accounts/${account.sid}/ActiveStreams`;
      const res = await axios.get(url, {
        auth: { username: account.apiKey, password: account.apiToken },
        timeout: 10000,
      });
      const xml = res.data;
      const activeMatch = xml.match(/<ActiveStreamCount>(\d+)<\/ActiveStreamCount>/);
      const limitMatch  = xml.match(/<ThrottleLimit>(\d+)<\/ThrottleLimit>/);
      const active = activeMatch ? parseInt(activeMatch[1]) : 0;
      const limit  = limitMatch  ? parseInt(limitMatch[1])  : 0;

      totalActive += active;
      totalLimit  += limit;
      byAccount.push({ label: account.label, active, limit });
    } catch (err) {
      byAccount.push({ label: account.label, active: 0, limit: 0, error: err.message });
    }
  }

  liveStreamData = {
    active: totalActive,
    limit: totalLimit,
    utilization: totalLimit ? parseFloat(((totalActive / totalLimit) * 100).toFixed(1)) : 0,
    lastChecked: new Date().toISOString(),
    error: null,
    byAccount,
  };

  console.log(`[STREAMS] Total Active: ${totalActive} / ${totalLimit} (${liveStreamData.utilization}%)`);
}

function getLiveStreams() {
  return liveStreamData;
}

module.exports = { fetchCDR, getAllStats, getOverview, checkAlertConditions, fetchActiveStreams, getLiveStreams };
