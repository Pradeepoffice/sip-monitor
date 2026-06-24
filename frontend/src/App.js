import { useState, useEffect, useCallback, useRef } from "react";

// ── Config ──────────────────────────────────────────────────────────────────
const API_BASE = process.env.REACT_APP_API_URL || "http://localhost:4000";
const POLL_INTERVAL = 15000; // 15s UI polling

// ── Helpers ──────────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const map = {
    UP:       { bg: "#0d3b2e", text: "#22d98a" },
    DOWN:     { bg: "#3b0d0d", text: "#f87171" },
    DEGRADED: { bg: "#3b2e0d", text: "#fbbf24" },
    UNKNOWN:  { bg: "#1e293b", text: "#94a3b8" },
    CHECKING: { bg: "#1e293b", text: "#94a3b8" },
  };
  const s = map[status] || map.UNKNOWN;
  return (
    <span style={{
      background: s.bg, color: s.text,
      padding: "2px 10px", borderRadius: 99,
      fontSize: 11, fontWeight: 700, letterSpacing: 1,
      fontFamily: "monospace", border: `1px solid ${s.text}33`,
    }}>{status || "UNKNOWN"}</span>
  );
}

function Sparkline({ history = [] }) {
  const bars = history.slice(-24);
  if (!bars.length) return <div style={{ width: 120, height: 28, background: "#0b1422", borderRadius: 4 }} />;
  return (
    <svg width={120} height={28}>
      {bars.map((b, i) => {
        const color = b.status === "UP" ? "#22d98a" : b.status === "DEGRADED" ? "#fbbf24" : "#f87171";
        const bw = 120 / bars.length - 1;
        return <rect key={i} x={i * (bw + 1)} y={4} width={bw} height={20} rx={2} fill={color} opacity={0.85} />;
      })}
    </svg>
  );
}

function LatencyBadge({ latency }) {
  if (!latency) return <span style={{ color: "#475569", fontFamily: "monospace", fontSize: 13 }}>—</span>;
  const color = latency < 100 ? "#22d98a" : latency < 300 ? "#fbbf24" : "#f87171";
  return (
    <span style={{ color, fontFamily: "monospace", fontSize: 14, fontWeight: 700 }}>
      {latency}<span style={{ fontSize: 10, color: "#475569", fontWeight: 400 }}> ms</span>
    </span>
  );
}

function UptimeBadge({ uptime }) {
  if (uptime === null || uptime === undefined) return <span style={{ color: "#475569" }}>—</span>;
  const val = parseFloat(uptime);
  const color = val >= 99 ? "#22d98a" : val >= 95 ? "#fbbf24" : "#f87171";
  return <span style={{ color, fontFamily: "monospace", fontSize: 13, fontWeight: 700 }}>{val.toFixed(2)}%</span>;
}

// ── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [endpoints, setEndpoints] = useState([]);
  const [histories, setHistories] = useState({});
  const [alerts, setAlerts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [checking, setChecking] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const pollerRef = useRef(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/status`);
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      setEndpoints(data.endpoints || []);
      setLastRefresh(new Date());
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/alerts`);
      const data = await res.json();
      setAlerts(data.alerts || []);
    } catch (_) {}
  }, []);

  const fetchHistory = useCallback(async (id) => {
    try {
      const res = await fetch(`${API_BASE}/api/history/${id}`);
      const data = await res.json();
      setHistories((h) => ({ ...h, [id]: data.history || [] }));
    } catch (_) {}
  }, []);

  // Initial load + polling
  useEffect(() => {
    fetchStatus();
    fetchAlerts();
    pollerRef.current = setInterval(() => {
      fetchStatus();
      fetchAlerts();
    }, POLL_INTERVAL);
    return () => clearInterval(pollerRef.current);
  }, [fetchStatus, fetchAlerts]);

  // Load history when endpoint selected
  useEffect(() => {
    if (selected) fetchHistory(selected);
  }, [selected, fetchHistory]);

  const handleCheckAll = async () => {
    setChecking(true);
    try {
      await fetch(`${API_BASE}/api/check`, { method: "POST" });
      await fetchStatus();
      await fetchAlerts();
    } finally {
      setChecking(false);
    }
  };

  const handleCheckOne = async (id) => {
    try {
      await fetch(`${API_BASE}/api/check/${id}`, { method: "POST" });
      await fetchStatus();
      await fetchHistory(id);
    } catch (_) {}
  };

  const upCount = endpoints.filter((e) => e.status === "UP").length;
  const downCount = endpoints.filter((e) => e.status === "DOWN").length;
  const degradedCount = endpoints.filter((e) => e.status === "DEGRADED").length;
  const avgLatency = (() => {
    const valid = endpoints.filter((e) => e.latency);
    if (!valid.length) return null;
    return Math.round(valid.reduce((a, b) => a + b.latency, 0) / valid.length);
  })();

  const selEndpoint = endpoints.find((e) => e.id === selected);

  return (
    <div style={{ minHeight: "100vh", background: "#080f1a", color: "#e2e8f0", fontFamily: "'Inter',system-ui,sans-serif" }}>

      {/* ── Header ── */}
      <div style={{ borderBottom: "1px solid #1e293b", padding: "16px 28px", background: "#0b1422", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: "linear-gradient(135deg,#2563eb,#7c3aed)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2}>
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.07 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3 2.2h3a2 2 0 0 1 2 1.72c.12.96.35 1.9.68 2.81a2 2 0 0 1-.45 2.11L7.09 9.91a16 16 0 0 0 5.97 5.97l1.27-1.27a2 2 0 0 1 2.11-.45c.9.33 1.85.56 2.81.68A2 2 0 0 1 21 16.92z" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>SIP Health Monitor</div>
            <div style={{ fontSize: 11, color: "#475569" }}>
              {lastRefresh ? `Last updated: ${lastRefresh.toLocaleTimeString()}` : "Connecting…"}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {error && (
            <span style={{ fontSize: 11, color: "#f87171", background: "#3b0d0d", padding: "4px 10px", borderRadius: 6 }}>
              ⚠ {error}
            </span>
          )}
          <button
            onClick={() => setAlertsOpen((v) => !v)}
            style={{ position: "relative", background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "6px 10px", cursor: "pointer", color: "#94a3b8" }}
          >
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            {alerts.length > 0 && (
              <span style={{ position: "absolute", top: -4, right: -4, background: "#f87171", color: "#fff", borderRadius: 99, fontSize: 9, fontWeight: 700, padding: "1px 5px" }}>
                {alerts.length}
              </span>
            )}
          </button>
          <button
            onClick={handleCheckAll}
            disabled={checking}
            style={{ background: "#1e3a5f", color: "#60a5fa", border: "1px solid #2563eb44", borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
          >
            {checking ? "Checking…" : "↻ Check All"}
          </button>
        </div>
      </div>

      {/* ── Alert Drawer ── */}
      {alertsOpen && (
        <div style={{ background: "#0b1422", borderBottom: "1px solid #1e293b", padding: "16px 28px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#f87171" }}>🚨 Alert Log ({alerts.length})</span>
            <button onClick={() => setAlertsOpen(false)} style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 13 }}>Close ✕</button>
          </div>
          {alerts.length === 0 ? (
            <div style={{ color: "#475569", fontSize: 13 }}>No alerts — all systems nominal.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto" }}>
              {alerts.map((a) => (
                <div key={a.id} style={{ background: "#0f1c2e", border: `1px solid ${a.status === "DOWN" ? "#f8717133" : "#fbbf2433"}`, borderLeft: `3px solid ${a.status === "DOWN" ? "#f87171" : "#fbbf24"}`, borderRadius: 8, padding: "10px 14px", display: "flex", gap: 16, alignItems: "center" }}>
                  <StatusBadge status={a.status} />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{a.name}</span>
                  <span style={{ fontSize: 12, color: "#475569", fontFamily: "monospace" }}>{a.code ? `${a.code} ` : ""}{a.reason}</span>
                  <span style={{ fontSize: 11, color: "#334155", marginLeft: "auto" }}>{new Date(a.time).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ padding: "24px 28px" }}>

        {/* ── Summary Cards ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 24 }}>
          {[
            { label: "Endpoints Up", value: loading ? "…" : upCount, color: "#22d98a", sub: `of ${endpoints.length} total` },
            { label: "Down", value: loading ? "…" : downCount, color: "#f87171", sub: "requires attention" },
            { label: "Degraded", value: loading ? "…" : degradedCount, color: "#fbbf24", sub: "high latency / timeout" },
            { label: "Avg Latency", value: loading ? "…" : avgLatency ? `${avgLatency}ms` : "—", color: "#818cf8", sub: "across active endpoints" },
          ].map((c) => (
            <div key={c.label} style={{ background: "#0f1c2e", border: "1px solid #1e293b", borderRadius: 12, padding: "16px 20px" }}>
              <div style={{ fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>{c.label}</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: c.color, fontFamily: "monospace" }}>{c.value}</div>
              <div style={{ fontSize: 11, color: "#334155", marginTop: 4 }}>{c.sub}</div>
            </div>
          ))}
        </div>

        {/* ── Endpoint List ── */}
        {loading ? (
          <div style={{ color: "#475569", textAlign: "center", padding: 48, fontSize: 14 }}>Connecting to backend…</div>
        ) : endpoints.length === 0 ? (
          <div style={{ color: "#475569", textAlign: "center", padding: 48, fontSize: 14 }}>No endpoints configured. Add SIP_ENDPOINTS in backend .env</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {endpoints.map((ep) => (
              <div key={ep.id}>
                <div
                  onClick={() => setSelected(selected === ep.id ? null : ep.id)}
                  style={{
                    background: selected === ep.id ? "#111d2e" : "#0f1c2e",
                    border: `1px solid ${selected === ep.id ? "#2563eb55" : "#1e293b"}`,
                    borderRadius: 10, padding: "14px 18px", cursor: "pointer",
                    display: "grid", gridTemplateColumns: "1fr 110px 90px 80px 130px 36px",
                    alignItems: "center", gap: 16, transition: "all 0.15s",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{ep.name}</div>
                    <div style={{ fontSize: 11, color: "#475569", fontFamily: "monospace", marginTop: 2 }}>{ep.host}:{ep.port}</div>
                  </div>
                  <StatusBadge status={ep.status} />
                  <LatencyBadge latency={ep.latency} />
                  <div>
                    <div style={{ fontSize: 10, color: "#475569" }}>Uptime</div>
                    <UptimeBadge uptime={ep.uptime} />
                  </div>
                  <Sparkline history={histories[ep.id] || []} />
                  <button
                    onClick={(e) => { e.stopPropagation(); handleCheckOne(ep.id); }}
                    title="Ping now"
                    style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 6, color: "#94a3b8", width: 30, height: 30, cursor: "pointer", fontSize: 14 }}
                  >↻</button>
                </div>

                {/* Detail Panel */}
                {selected === ep.id && (
                  <div style={{ background: "#0b1422", border: "1px solid #2563eb22", borderTop: "none", borderRadius: "0 0 10px 10px", padding: "16px 18px" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 14 }}>
                      {[
                        { label: "Response Code", value: ep.code ? `${ep.code}` : "—" },
                        { label: "Reason", value: ep.reason || "—" },
                        { label: "Latency", value: ep.latency ? `${ep.latency}ms` : "—" },
                        { label: "Last Checked", value: ep.lastChecked ? new Date(ep.lastChecked).toLocaleTimeString() : "—" },
                      ].map((f) => (
                        <div key={f.label} style={{ background: "#0f1c2e", borderRadius: 8, padding: "10px 14px" }}>
                          <div style={{ fontSize: 10, color: "#475569", marginBottom: 4 }}>{f.label}</div>
                          <div style={{ fontSize: 13, fontWeight: 600, fontFamily: "monospace", color: "#cbd5e1" }}>{f.value}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ fontSize: 11, color: "#475569", marginBottom: 6 }}>Last {(histories[ep.id] || []).length} checks</div>
                    <div style={{ display: "flex", gap: 2 }}>
                      {(histories[ep.id] || []).slice(-50).map((h, i) => {
                        const color = h.status === "UP" ? "#22d98a" : h.status === "DEGRADED" ? "#fbbf24" : "#f87171";
                        return (
                          <div key={i} title={`${h.status} — ${new Date(h.time).toLocaleTimeString()}`}
                            style={{ flex: 1, height: 20, background: color, borderRadius: 2, opacity: 0.85 }} />
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Legend ── */}
        <div style={{ marginTop: 24, display: "flex", gap: 20, alignItems: "center" }}>
          {[
            { color: "#22d98a", label: "UP — 200 OK" },
            { color: "#fbbf24", label: "DEGRADED — high latency / 4xx" },
            { color: "#f87171", label: "DOWN — 5xx / no response" },
          ].map((l) => (
            <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: l.color }} />
              <span style={{ fontSize: 11, color: "#64748b" }}>{l.label}</span>
            </div>
          ))}
          <span style={{ fontSize: 11, color: "#334155", marginLeft: "auto" }}>
            Auto-polls every {POLL_INTERVAL / 1000}s
          </span>
        </div>
      </div>
    </div>
  );
}
