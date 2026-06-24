// sip-pinger.js — TCP version
const net = require("net");

function buildSipOptions(host, port) {
  const callId = `${Date.now()}@sip-monitor`;
  const branch = `z9hG4bK${Math.random().toString(36).substr(2, 9)}`;
  const tag = Math.random().toString(36).substr(2, 9);

  return [
    `OPTIONS sip:ping@${host}:${port} SIP/2.0`,
    `Via: SIP/2.0/TCP 0.0.0.0:5090;branch=${branch};rport`,
    `From: <sip:monitor@0.0.0.0>;tag=${tag}`,
    `To: <sip:ping@${host}:${port}>`,
    `Call-ID: ${callId}`,
    `CSeq: 1 OPTIONS`,
    `Contact: <sip:monitor@0.0.0.0:5090;transport=tcp>`,
    `Content-Length: 0`,
    `Max-Forwards: 70`,
    `User-Agent: SIP-HealthMonitor/1.0`,
    ``,
    ``
  ].join("\r\n");
}

function parseSipResponse(data) {
  const text = data.toString();
  const firstLine = text.split("\r\n")[0] || text.split("\n")[0];
  const match = firstLine.match(/SIP\/2\.0\s+(\d{3})\s+(.*)/);
  if (match) {
    return { code: parseInt(match[1]), reason: match[2].trim() };
  }
  return null;
}

function pingSipEndpoint(host, port, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let resolved = false;

    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      try { socket.destroy(); } catch (_) {}
      resolve(result);
    };

    const socket = new net.Socket();

    const timer = setTimeout(() => {
      finish({
        status: "DOWN",
        code: null,
        reason: "TCP Connection Timeout",
        latency: null,
      });
    }, timeoutMs);

    socket.connect(port, host, () => {
      // TCP connected — now send SIP OPTIONS
      const message = buildSipOptions(host, port);
      socket.write(message);
    });

    socket.on("data", (data) => {
      clearTimeout(timer);
      const latency = Date.now() - startTime;
      const parsed = parseSipResponse(data);

      if (parsed) {
        // 200, 403, 405 all mean server is UP and reachable
        const status =
          parsed.code >= 200 && parsed.code < 500 ? "UP" :
          parsed.code >= 500 ? "DOWN" : "DEGRADED";
        finish({ status, code: parsed.code, reason: parsed.reason, latency });
      } else {
        // TCP connected but no valid SIP response — still UP
        finish({
          status: "UP",
          code: null,
          reason: "TCP Connected — No SIP Response",
          latency,
        });
      }
    });

    socket.on("connect", () => {
      // TCP handshake success — even if no SIP response, server is reachable
      clearTimeout(timer);
      const latency = Date.now() - startTime;
      // Give it 3 more seconds to receive SIP response
      setTimeout(() => {
        finish({
          status: "UP",
          code: null,
          reason: "TCP Connected",
          latency,
        });
      }, 3000);
    });

    socket.on("error", (err) => {
      clearTimeout(timer);
      finish({
        status: "DOWN",
        code: null,
        reason: err.message,
        latency: null,
      });
    });

    socket.on("close", () => {
      clearTimeout(timer);
      finish({
        status: "DOWN",
        code: null,
        reason: "Connection Closed",
        latency: null,
      });
    });
  });
}

module.exports = { pingSipEndpoint };
