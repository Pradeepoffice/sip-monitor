// alert-manager.js
const nodemailer = require("nodemailer");
const axios = require("axios");

const lastAlertTime = {};
const COOLDOWN_MS = 5 * 60 * 1000;

function shouldAlert(key) {
  const last = lastAlertTime[key];
  if (!last) return true;
  return Date.now() - last > COOLDOWN_MS;
}

function markAlerted(key) {
  lastAlertTime[key] = Date.now();
}

async function sendEmailAlert(subject, htmlBody) {
  if (process.env.ALERT_EMAIL_ENABLED !== "true") return;
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "587"),
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await transporter.sendMail({
      from: `"Call Monitor" <${process.env.SMTP_USER}>`,
      to: process.env.ALERT_EMAIL_TO,
      subject,
      html: htmlBody,
    });
    console.log(`[ALERT] Email sent: ${subject}`);
  } catch (err) {
    console.error("[ALERT] Email failed:", err.message);
  }
}

async function sendSlackAlert(text, blocks) {
  if (process.env.ALERT_SLACK_ENABLED !== "true") return;
  try {
    await axios.post(process.env.SLACK_WEBHOOK_URL, { text, blocks });
    console.log(`[ALERT] Slack sent: ${text}`);
  } catch (err) {
    console.error("[ALERT] Slack failed:", err.message);
  }
}

function buildEmailHTML(alert) {
  const color = alert.severity === "CRITICAL" ? "#ef4444" : "#f59e0b";
  const icon  = alert.severity === "CRITICAL" ? "🔴" : "🟡";
  return `
    <div style="font-family:sans-serif;max-width:520px;margin:auto;">
      <div style="background:#1a1a2e;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0;">
        <h2 style="margin:0;">${icon} Call Monitor Alert</h2>
      </div>
      <div style="border:1px solid #e2e8f0;border-top:none;padding:20px 24px;border-radius:0 0 8px 8px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:6px 0;color:#64748b;width:130px;">Type</td><td style="font-weight:600;">${alert.type}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Severity</td><td style="font-weight:700;color:${color};">${alert.severity}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Message</td><td>${alert.message}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Time</td><td>${new Date(alert.time).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST</td></tr>
        </table>
        <p style="margin-top:16px;color:#64748b;font-size:13px;">Alert cooldown: 5 minutes per alert type.</p>
      </div>
    </div>`;
}

function buildSlackBlocks(alert) {
  const icon = alert.severity === "CRITICAL" ? "🔴" : "🟡";
  return [{
    type: "section",
    text: {
      type: "mrkdwn",
      text: `${icon} *Call Monitor Alert*\n*Type:* ${alert.type}\n*Severity:* ${alert.severity}\n*Message:* ${alert.message}\n*Time:* ${new Date(alert.time).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`,
    },
  }];
}

async function triggerAlerts(ep, result) {
  if (result.status === "UP") return;
  if (!shouldAlert(ep.id)) return;
  markAlerted(ep.id);
  const alert = { type: "SIP_GATEWAY", severity: result.status === "DOWN" ? "CRITICAL" : "WARNING", message: `${ep.name} is ${result.status} — ${result.reason || ""}`, time: new Date().toISOString() };
  await Promise.all([
    sendEmailAlert(`🚨 SIP Alert: ${ep.name} is ${result.status}`, buildEmailHTML(alert)),
    sendSlackAlert(`SIP Alert: ${ep.name} is ${result.status}`, buildSlackBlocks(alert)),
  ]);
}

async function triggerCDRAlerts(alerts) {
  for (const alert of alerts) {
    const key = `${alert.type}-${alert.did || "global"}`;
    if (!shouldAlert(key)) continue;
    markAlerted(key);
    await Promise.all([
      sendEmailAlert(`${alert.severity === "CRITICAL" ? "🔴" : "🟡"} ${alert.type}: ${alert.message}`, buildEmailHTML(alert)),
      sendSlackAlert(alert.message, buildSlackBlocks(alert)),
    ]);
  }
}

module.exports = { triggerAlerts, triggerCDRAlerts };
