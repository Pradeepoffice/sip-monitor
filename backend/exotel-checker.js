// exotel-checker.js
const axios = require("axios");

// Cooldown tracker per DID
const lastAlertTime = {};
const COOLDOWN_MS = 5 * 60 * 1000;

function shouldAlert(did) {
  const last = lastAlertTime[did];
  if (!last) return true;
  return Date.now() - last > COOLDOWN_MS;
}

function markAlerted(did) {
  lastAlertTime[did] = Date.now();
}

// Get operator from DID number
function guessOperator(did) {
  const operators = {
    "6000": "Airtel", "6001": "Airtel", "6002": "Airtel",
    "8068": "Airtel", "8069": "Airtel",
    "9000": "Vodafone", "9001": "Vodafone",
    "7000": "Jio", "7001": "Jio",
  };
  const prefix = did.replace("+91", "").substring(0, 4);
  return operators[prefix] || "Unknown";
}

// Check single DID via Exotel API
async function checkDID(accountSid, apiKey, apiToken, subdomain, did) {
  try {
    const cleanDid = did.replace("+", "");
    const url = `https://${subdomain}/v1/Accounts/${accountSid}/IncomingPhoneNumbers/${cleanDid}.json`;

    const response = await axios.get(url, {
      auth: { username: apiKey, password: apiToken },
      timeout: 8000,
    });

    const data = response.data?.IncomingPhoneNumber;

    if (!data) {
      return {
        did,
        status: "DOWN",
        reason: "DID not found in account",
        operator: guessOperator(did),
        assignedTo: null,
        capabilities: {},
      };
    }

    const isActive = ["in-use", "active", "available"].includes(
      (data.Status || "").toLowerCase()
    );

    return {
      did,
      friendlyName: data.FriendlyName || did,
      status: isActive ? "UP" : "DOWN",
      reason: isActive ? `Active — ${data.Status}` : `Inactive — ${data.Status}`,
      operator: guessOperator(did),
      assignedTo: data.AssignedTo || null,
      capabilities: data.Capabilities || {},
      smsEnabled: data.Capabilities?.sms || false,
      voiceEnabled: data.Capabilities?.voice || false,
    };
  } catch (err) {
    let reason = err.message;
    if (err.response?.status === 401) reason = "Invalid API credentials";
    if (err.response?.status === 404) reason = "DID not found";
    if (err.response?.status === 429) reason = "API rate limit hit";
    if (err.code === "ECONNABORTED") reason = "API request timed out";

    return {
      did,
      status: "DOWN",
      reason,
      operator: guessOperator(did),
      assignedTo: null,
      capabilities: {},
    };
  }
}

// Check account health
async function checkAccountHealth(accountSid, apiKey, apiToken, subdomain) {
  try {
    const url = `https://${subdomain}/v1/Accounts/${accountSid}.json`;
    const response = await axios.get(url, {
      auth: { username: apiKey, password: apiToken },
      timeout: 8000,
    });
    const data = response.data?.Account;
    return {
      status: data?.Status === "active" ? "UP" : "DOWN",
      accountName: data?.FriendlyName || accountSid,
      accountStatus: data?.Status || "unknown",
    };
  } catch (err) {
    return { status: "DOWN", accountName: accountSid, accountStatus: "error" };
  }
}

// Main function — check all DIDs
async function checkAllDIDs() {
  const accountSid = process.env.EXOTEL_ACCOUNT_SID;
  const apiKey = process.env.EXOTEL_API_KEY;
  const apiToken = process.env.EXOTEL_API_TOKEN;
  const subdomain = process.env.EXOTEL_SUBDOMAIN || "api.in.exotel.com";
  const didsRaw = process.env.EXOTEL_DIDS || "";

  if (!accountSid || !apiKey || !apiToken) {
    console.log("[EXOTEL] Credentials not configured, skipping.");
    return { accountHealth: null, dids: [] };
  }

  const dids = didsRaw.split(",").map((d) => d.trim()).filter(Boolean);
  if (!dids.length) {
    console.log("[EXOTEL] No DIDs configured.");
    return { accountHealth: null, dids: [] };
  }

  // Check account + all DIDs in parallel
  const [accountHealth, ...didResults] = await Promise.all([
    checkAccountHealth(accountSid, apiKey, apiToken, subdomain),
    ...dids.map((did) => checkDID(accountSid, apiKey, apiToken, subdomain, did)),
  ]);

  didResults.forEach((r) => {
    console.log(`[EXOTEL] DID ${r.did} → ${r.status} | ${r.reason} | ${r.operator}`);
  });

  return { accountHealth, dids: didResults };
}

module.exports = { checkAllDIDs, shouldAlert, markAlerted };
