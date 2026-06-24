// sip-pinger.js
// Sends a SIP OPTIONS request to the target host:port and resolves with result

const dgram = require("dgram");

function buildSipOptions(host, port) {
  const callId = `${Date.now()}@sip-monitor`;
  const branch = `z9hG4bK${Math.random().toString(36).substr(2, 9)}`;
  const tag = Math.random().toString(36).substr(2, 9);

  return [
    `OPTIONS sip:ping@${host}:${port} SIP/2.0`,
    `Via: SIP/2.0/UDP sip-monitor:5090;branch=${branch};rport`,
    `From: <sip:monitor@sip-monitor>;tag=${tag}`,
    `To: <sip:ping@${host}:${port}>`,
    `Call-ID: ${callId}`,
    `CSeq: 1 OPTIONS`,
    `Contact: <sip:monitor@sip-monitor:5090>`,
    `Content-Length: 0`,
    `Max-Forwards: 70`,
    `User-Agent: SIP-HealthMonitor/1.0`,
    ``,
    ``
  ].join("\r\n");
}

function parseSipResponse(msg) {
  const text = msg.toString();
  const firstLine = text.split("\r\n")[0] || text.split("\n")[0];
  const match = firstLine.match(/SIP\/2\.0\s+(\d{3})\s+(.*)/);
  if (match) {
    return { code: parseInt(match[1]), reason: match[2].trim() };
  }
  return null;
}

function pingSipEndpoint(host, port, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    let resolved = false;
    const startTime = Date.now();

    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      try { socket.close(); } catch (_) {}
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ status: "DOWN", code: null, reason: "Request Timeout", latency: null });
    }, timeoutMs);

    socket.on("message", (msg) => {
      clearTimeout(timer);
      const latency = Date.now() - startTime;
      const parsed = parseSipResponse(msg);
      if (parsed) {
        const status = parsed.code >= 200 && parsed.code < 500 ? "UP" :
                       parsed.code >= 500 ? "DOWN" : "DEGRADED";
        finish({ status, code: parsed.code, reason: parsed.reason, latency });
      } else {
        finish({ status: "DEGRADED", code: null, reason: "Invalid SIP Response", latency });
      }
    });

    socket.on("error", (err) => {
      clearTimeout(timer);
      finish({ status: "DOWN", code: null, reason: err.message, latency: null });
    });

    socket.bind(() => {
      const message = buildSipOptions(host, port);
      const buf = Buffer.from(message);
      socket.send(buf, 0, buf.length, port, host, (err) => {
        if (err) {
          clearTimeout(timer);
          finish({ status: "DOWN", code: null, reason: err.message, latency: null });
        }
      });
    });
  });
}

module.exports = { pingSipEndpoint };
