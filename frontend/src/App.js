import { useState, useEffect, useCallback } from "react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend } from "recharts";

const API = process.env.REACT_APP_API_URL || "http://localhost:4000";
const POLL = 30000;

// ── Colors ──────────────────────────────────────────────────────────────────
const C = {
  green:  "#22d98a", red: "#f87171", yellow: "#fbbf24",
  blue:   "#60a5fa", purple: "#a78bfa", bg: "#080f1a",
  card:   "#0f1c2e", border: "#1e293b", text: "#e2e8f0",
  muted:  "#475569", dim: "#1e293b",
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function pct(v) { return parseFloat(v || 0).toFixed(1) + "%"; }
function num(v) { return (v || 0).toLocaleString(); }
function connColor(v) { return v >= 98 ? C.green : v >= 90 ? C.yellow : C.red; }
function fmtSec(s) { if (!s) return "0s"; const m = Math.floor(s/60); const sec = s%60; return m ? `${m}m ${sec}s` : `${sec}s`; }
function fmtTime(t) { return t ? new Date(t).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }) : "—"; }

// ── Reusable Components ───────────────────────────────────────────────────────
function Card({ children, style = {} }) {
  return <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, ...style }}>{children}</div>;
}

function KPICard({ label, value, sub, color = C.text, icon }) {
  return (
    <Card>
      <div style={{ fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>{icon} {label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color, fontFamily: "monospace" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{sub}</div>}
    </Card>
  );
}

function Badge({ status }) {
  const map = { UP: [C.green, "#0d3b2e"], DOWN: [C.red, "#3b0d0d"], WARNING: [C.yellow, "#3b2e0d"], GOOD: [C.green, "#0d3b2e"], CRITICAL: [C.red, "#3b0d0d"], UNKNOWN: [C.muted, C.dim] };
  const [color, bg] = map[status] || map.UNKNOWN;
  return <span style={{ background: bg, color, padding: "2px 10px", borderRadius: 99, fontSize: 11, fontWeight: 700, fontFamily: "monospace", border: `1px solid ${color}33` }}>{status}</span>;
}

function SectionTitle({ children, action }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{children}</div>
      {action}
    </div>
  );
}

function NavBtn({ id, active, onClick, children }) {
  return (
    <button onClick={() => onClick(id)} style={{
      background: active ? "#1e3a5f" : "none", color: active ? C.blue : C.muted,
      border: active ? `1px solid ${C.blue}44` : "1px solid transparent",
      borderRadius: 8, padding: "7px 16px", fontSize: 12, fontWeight: 600,
      cursor: "pointer", whiteSpace: "nowrap",
    }}>{children}</button>
  );
}

function RefreshBtn({ onClick, loading }) {
  return (
    <button onClick={onClick} style={{ background: C.dim, color: C.muted, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 12px", fontSize: 11, cursor: "pointer" }}>
      {loading ? "…" : "↻ Refresh"}
    </button>
  );
}

function EmptyState({ msg }) {
  return <div style={{ textAlign: "center", padding: "40px 0", color: C.muted, fontSize: 13 }}>{msg}</div>;
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("overview");
  const [stats, setStats] = useState(null);
  const [sip, setSip] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [alertsOpen, setAlertsOpen] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [s, c, a] = await Promise.all([
        fetch(`${API}/api/sip/status`).then((r) => r.json()),
        fetch(`${API}/api/cdr/stats`).then((r) => r.json()),
        fetch(`${API}/api/alerts`).then((r) => r.json()),
      ]);
      setSip(s);
      setStats(c);
      setAlerts(a.alerts || []);
      setLastUpdate(new Date());
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const t = setInterval(fetchAll, POLL);
    return () => clearInterval(t);
  }, [fetchAll]);

  const handleRefresh = async () => { setLoading(true); await fetchAll(); };

  const ov = stats?.overview;
  const criticalAlerts = alerts.filter((a) => a.severity === "CRITICAL" || a.status === "DOWN");

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'Inter',system-ui,sans-serif" }}>

      {/* Header */}
      <div style={{ borderBottom: `1px solid ${C.border}`, padding: "14px 28px", background: "#0b1422", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 34, height: 34, borderRadius: 8, background: "linear-gradient(135deg,#2563eb,#7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>📞</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Call Intelligence Monitor</div>
            <div style={{ fontSize: 11, color: C.muted }}>{lastUpdate ? `Updated: ${fmtTime(lastUpdate)}` : "Connecting…"}</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {error && <span style={{ fontSize: 11, color: C.red, background: "#3b0d0d", padding: "4px 10px", borderRadius: 6 }}>⚠ {error}</span>}
          {ov && (
            <div style={{ background: `${connColor(ov.connectivity)}22`, border: `1px solid ${connColor(ov.connectivity)}44`, borderRadius: 8, padding: "4px 12px", fontSize: 12, fontWeight: 700, color: connColor(ov.connectivity) }}>
              {pct(ov.connectivity)} Connectivity
            </div>
          )}
          <button onClick={() => setAlertsOpen((v) => !v)} style={{ position: "relative", background: C.dim, border: `1px solid ${C.border}`, borderRadius: 8, padding: "6px 10px", cursor: "pointer", color: C.muted }}>
            🔔
            {criticalAlerts.length > 0 && <span style={{ position: "absolute", top: -4, right: -4, background: C.red, color: "#fff", borderRadius: 99, fontSize: 9, fontWeight: 700, padding: "1px 5px" }}>{criticalAlerts.length}</span>}
          </button>
          <RefreshBtn onClick={handleRefresh} loading={loading} />
        </div>
      </div>

      {/* Alert Drawer */}
      {alertsOpen && (
        <div style={{ background: "#0b1422", borderBottom: `1px solid ${C.border}`, padding: "14px 28px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.red }}>🚨 Active Alerts ({alerts.length})</span>
            <button onClick={() => setAlertsOpen(false)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}>Close ✕</button>
          </div>
          {alerts.length === 0
            ? <div style={{ color: C.muted, fontSize: 13 }}>✅ No active alerts</div>
            : <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 200, overflowY: "auto" }}>
                {alerts.slice(0, 10).map((a, i) => (
                  <div key={i} style={{ background: C.card, border: `1px solid ${a.severity === "CRITICAL" || a.status === "DOWN" ? C.red + "44" : C.yellow + "44"}`, borderLeft: `3px solid ${a.severity === "CRITICAL" || a.status === "DOWN" ? C.red : C.yellow}`, borderRadius: 8, padding: "8px 14px", display: "flex", gap: 12, alignItems: "center" }}>
                    <Badge status={a.severity || a.status} />
                    <span style={{ fontSize: 12 }}>{a.message || a.name}</span>
                    <span style={{ fontSize: 11, color: C.muted, marginLeft: "auto" }}>{fmtTime(a.time)}</span>
                  </div>
                ))}
              </div>
          }
        </div>
      )}

      {/* Nav */}
      <div style={{ borderBottom: `1px solid ${C.border}`, padding: "10px 28px", background: "#0b1422", display: "flex", gap: 6, overflowX: "auto" }}>
        {[
          ["overview",    "📊 Overview"],
          ["sip",         "📡 SIP Gateway"],
          ["clients",     "🏢 Clients"],
          ["did",         "📱 DID Health"],
          ["hourly",      "⏱ Hourly Traffic"],
          ["failures",    "❌ Failures"],
          ["kpi",         "🎯 KPI"],
          ["alertlog",    "🚨 Alert Log"],
        ].map(([id, label]) => <NavBtn key={id} id={id} active={tab === id} onClick={setTab}>{label}</NavBtn>)}
      </div>

      {/* Content */}
      <div style={{ padding: "24px 28px" }}>
        {loading && !stats ? (
          <div style={{ textAlign: "center", padding: 60, color: C.muted }}>Connecting to backend…</div>
        ) : (
          <>
            {tab === "overview"  && <OverviewTab ov={ov} />}
            {tab === "sip"       && <SIPTab sip={sip} />}
            {tab === "clients"   && <ClientsTab clients={stats?.clients} />}
            {tab === "did"       && <DIDTab dids={stats?.didHealth} />}
            {tab === "hourly"    && <HourlyTab hourly={stats?.hourly} />}
            {tab === "failures"  && <FailuresTab failures={stats?.failures} />}
            {tab === "kpi"       && <KPITab kpi={stats?.kpi} />}
            {tab === "alertlog"  && <AlertLogTab alerts={alerts} />}
          </>
        )}
      </div>
    </div>
  );
}

// ── Tab 1: Overview ───────────────────────────────────────────────────────────
function OverviewTab({ ov }) {
  if (!ov) return <EmptyState msg="No CDR data yet — check Exotel credentials in Render ENV" />;
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 20 }}>
        <KPICard label="Total Calls Today"    value={num(ov.totalToday)}    color={C.blue}   icon="📞" />
        <KPICard label="Connected"            value={num(ov.connected)}     color={C.green}  icon="✅" sub={`${pct(ov.connectivity)} connectivity`} />
        <KPICard label="Failed"               value={num(ov.failed)}        color={C.red}    icon="❌" />
        <KPICard label="Avg Duration"         value={fmtSec(ov.avgDuration)} color={C.purple} icon="⏱" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 20 }}>
        <KPICard label="In Progress"  value={num(ov.inProgress)}  color={C.yellow} icon="🔄" />
        <KPICard label="Inbound"      value={num(ov.inbound)}     color={C.blue}   icon="📥" />
        <KPICard label="Outbound"     value={num(ov.outbound)}    color={C.purple} icon="📤" />
        <KPICard label="Connectivity" value={pct(ov.connectivity)} color={connColor(ov.connectivity)} icon="📶" sub="Target: 98%" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Card>
          <SectionTitle>Call Status Breakdown</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              { label: "Completed",  value: ov.connected,  color: C.green  },
              { label: "Failed",     value: ov.failed,     color: C.red    },
              { label: "Busy",       value: ov.busy,       color: C.yellow },
              { label: "No Answer",  value: ov.noAnswer,   color: C.muted  },
              { label: "Canceled",   value: ov.canceled,   color: C.muted  },
            ].map((r) => (
              <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 90, fontSize: 12, color: C.muted }}>{r.label}</span>
                <div style={{ flex: 1, background: C.dim, borderRadius: 4, height: 8, overflow: "hidden" }}>
                  <div style={{ width: `${ov.totalToday ? (r.value / ov.totalToday) * 100 : 0}%`, background: r.color, height: "100%", borderRadius: 4 }} />
                </div>
                <span style={{ width: 60, fontSize: 12, fontFamily: "monospace", color: r.color, textAlign: "right" }}>{num(r.value)}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <SectionTitle>Last Fetched</SectionTitle>
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 8 }}>CDR data from Exotel</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: C.blue, fontFamily: "monospace" }}>{fmtTime(ov.lastFetched)}</div>
          {ov.fetchError && <div style={{ marginTop: 8, fontSize: 12, color: C.red, background: "#3b0d0d", padding: "8px 12px", borderRadius: 6 }}>⚠ {ov.fetchError}</div>}
          <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div style={{ background: C.dim, borderRadius: 8, padding: "10px 14px" }}>
              <div style={{ fontSize: 10, color: C.muted }}>Inbound</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: C.blue }}>{num(ov.inbound)}</div>
            </div>
            <div style={{ background: C.dim, borderRadius: 8, padding: "10px 14px" }}>
              <div style={{ fontSize: 10, color: C.muted }}>Outbound</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: C.purple }}>{num(ov.outbound)}</div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ── Tab 2: SIP Gateway ────────────────────────────────────────────────────────
function SIPTab({ sip }) {
  const eps = sip?.endpoints || [];
  if (!eps.length) return <EmptyState msg="No SIP endpoints configured" />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {eps.map((ep) => (
        <Card key={ep.id}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 100px 90px 80px 100px", alignItems: "center", gap: 16 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{ep.name}</div>
              <div style={{ fontSize: 11, color: C.muted, fontFamily: "monospace" }}>{ep.host}:{ep.port}</div>
            </div>
            <Badge status={ep.status} />
            <div style={{ fontSize: 13, fontFamily: "monospace", color: ep.latency ? (ep.latency < 100 ? C.green : ep.latency < 300 ? C.yellow : C.red) : C.muted }}>
              {ep.latency ? `${ep.latency}ms` : "—"}
            </div>
            <div>
              <div style={{ fontSize: 10, color: C.muted }}>Uptime</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: ep.uptime >= 99 ? C.green : ep.uptime >= 95 ? C.yellow : C.red, fontFamily: "monospace" }}>{ep.uptime ? `${ep.uptime}%` : "—"}</div>
            </div>
            <div style={{ fontSize: 11, color: C.muted }}>
              <div>{ep.reason || ep.code || "—"}</div>
              <div style={{ marginTop: 2 }}>{fmtTime(ep.lastChecked)}</div>
            </div>
          </div>
          {ep.history?.length > 0 && (
            <div style={{ marginTop: 12, display: "flex", gap: 2 }}>
              {ep.history.slice(-30).map((h, i) => (
                <div key={i} style={{ flex: 1, height: 16, background: h.status === "UP" ? C.green : h.status === "DEGRADED" ? C.yellow : C.red, borderRadius: 2, opacity: 0.8 }} />
              ))}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

// ── Tab 3: Clients ────────────────────────────────────────────────────────────
function ClientsTab({ clients }) {
  if (!clients?.length) return <EmptyState msg="No client mapping configured. Add CLIENT_DID_MAP in Render ENV" />;
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 20 }}>
        {clients.map((c) => (
          <Card key={c.client}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>🏢 {c.client}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div style={{ background: C.dim, borderRadius: 8, padding: "10px" }}>
                <div style={{ fontSize: 10, color: C.muted }}>Total</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: C.blue }}>{num(c.total)}</div>
              </div>
              <div style={{ background: C.dim, borderRadius: 8, padding: "10px" }}>
                <div style={{ fontSize: 10, color: C.muted }}>Connectivity</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: connColor(c.connectivity) }}>{pct(c.connectivity)}</div>
              </div>
              <div style={{ background: C.dim, borderRadius: 8, padding: "10px" }}>
                <div style={{ fontSize: 10, color: C.muted }}>Connected</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>{num(c.connected)}</div>
              </div>
              <div style={{ background: C.dim, borderRadius: 8, padding: "10px" }}>
                <div style={{ fontSize: 10, color: C.muted }}>Failed</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: C.red }}>{num(c.failed)}</div>
              </div>
            </div>
            <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", fontSize: 11, color: C.muted }}>
              <span>📥 IB: {num(c.inbound)}</span>
              <span>📤 OB: {num(c.outbound)}</span>
              <span>⏱ {fmtSec(c.avgDuration)}</span>
            </div>
          </Card>
        ))}
      </div>
      <Card>
        <SectionTitle>Client Comparison</SectionTitle>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={clients}>
            <XAxis dataKey="client" tick={{ fill: C.muted, fontSize: 11 }} />
            <YAxis tick={{ fill: C.muted, fontSize: 11 }} />
            <Tooltip contentStyle={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8 }} />
            <Bar dataKey="connected" fill={C.green} name="Connected" radius={[4,4,0,0]} />
            <Bar dataKey="failed"    fill={C.red}   name="Failed"    radius={[4,4,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}

// ── Tab 4: DID Health ─────────────────────────────────────────────────────────
function DIDTab({ dids }) {
  if (!dids?.length) return <EmptyState msg="No DID data available yet" />;
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 20 }}>
        <KPICard label="Total DIDs"   value={dids.length}                                          color={C.blue}   icon="📱" />
        <KPICard label="Healthy"      value={dids.filter((d) => d.health === "GOOD").length}       color={C.green}  icon="✅" />
        <KPICard label="Issues"       value={dids.filter((d) => d.health !== "GOOD").length}       color={C.red}    icon="⚠️" />
      </div>
      <Card>
        <SectionTitle>DID Health Table</SectionTitle>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {["DID", "Client", "Total", "Connected", "Failed", "Connectivity", "Avg Duration", "Health"].map((h) => (
                  <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, color: C.muted, fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dids.map((d) => (
                <tr key={d.did} style={{ borderBottom: `1px solid ${C.border}22` }}>
                  <td style={{ padding: "10px 12px", fontFamily: "monospace", fontSize: 12 }}>{d.did}</td>
                  <td style={{ padding: "10px 12px", color: C.muted }}>{d.client || "—"}</td>
                  <td style={{ padding: "10px 12px", fontWeight: 600 }}>{num(d.total)}</td>
                  <td style={{ padding: "10px 12px", color: C.green }}>{num(d.connected)}</td>
                  <td style={{ padding: "10px 12px", color: C.red }}>{num(d.failed)}</td>
                  <td style={{ padding: "10px 12px", color: connColor(d.connectivity), fontWeight: 700, fontFamily: "monospace" }}>{pct(d.connectivity)}</td>
                  <td style={{ padding: "10px 12px", color: C.muted }}>{fmtSec(d.avgDuration)}</td>
                  <td style={{ padding: "10px 12px" }}><Badge status={d.health} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ── Tab 5: Hourly Traffic ─────────────────────────────────────────────────────
function HourlyTab({ hourly }) {
  if (!hourly?.length) return <EmptyState msg="No hourly data yet" />;
  const active = hourly.filter((h) => h.total > 0);
  const peak = active.length ? active.reduce((a, b) => (b.total > a.total ? b : a), active[0]) : null;

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 20 }}>
        <KPICard label="Peak Hour"   value={peak ? peak.label : "—"}         color={C.yellow} icon="🏆" sub={peak ? `${num(peak.total)} calls` : ""} />
        <KPICard label="Active Hours" value={active.length}                   color={C.blue}   icon="⏱" />
        <KPICard label="Total Today"  value={num(hourly.reduce((a, b) => a + b.total, 0))} color={C.green} icon="📞" />
      </div>
      <Card style={{ marginBottom: 14 }}>
        <SectionTitle>Hourly Call Volume</SectionTitle>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={hourly}>
            <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 10 }} interval={1} />
            <YAxis tick={{ fill: C.muted, fontSize: 11 }} />
            <Tooltip contentStyle={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8 }} />
            <Bar dataKey="connected" fill={C.green}  name="Connected" stackId="a" radius={[0,0,0,0]} />
            <Bar dataKey="failed"    fill={C.red}    name="Failed"    stackId="a" radius={[4,4,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
      <Card>
        <SectionTitle>Hourly Connectivity %</SectionTitle>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={hourly.filter((h) => h.total > 0)}>
            <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 10 }} />
            <YAxis domain={[80, 100]} tick={{ fill: C.muted, fontSize: 11 }} />
            <Tooltip contentStyle={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8 }} />
            <Line type="monotone" dataKey="connectivity" stroke={C.blue} strokeWidth={2} dot={false} name="Connectivity %" />
          </LineChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}

// ── Tab 6: Failures ───────────────────────────────────────────────────────────
function FailuresTab({ failures }) {
  if (!failures) return <EmptyState msg="No failure data yet" />;
  const bd = failures.breakdown || {};
  const pieData = Object.entries(bd).map(([name, value]) => ({ name, value }));
  const COLORS = [C.green, C.red, C.yellow, C.muted, C.purple];

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 20 }}>
        <KPICard label="Total Failed Today" value={num(failures.totalFailed)}  color={C.red}    icon="❌" />
        <KPICard label="Failed Last 15 Min" value={num(failures.failedLast15)} color={C.yellow} icon="⏱" sub={failures.failedLast15 > 100 ? "🚨 Alert threshold exceeded!" : "Within threshold"} />
        <KPICard label="Failure Rate"       value={pct(failures.failureRate)}  color={connColor(100 - failures.failureRate)} icon="📉" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <Card>
          <SectionTitle>Status Breakdown</SectionTitle>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" outerRadius={70} dataKey="value" nameKey="name" label={({ name, value }) => `${name}: ${value}`} labelLine={false} fontSize={11}>
                {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8 }} />
            </PieChart>
          </ResponsiveContainer>
        </Card>
        <Card>
          <SectionTitle>Top Failing DIDs</SectionTitle>
          {failures.topFailingDIDs?.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {failures.topFailingDIDs.map((d) => (
                <div key={d.did} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: C.dim, borderRadius: 8, padding: "8px 12px" }}>
                  <span style={{ fontSize: 12, fontFamily: "monospace" }}>{d.did}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: connColor(d.connectivity) }}>{pct(d.connectivity)}</span>
                </div>
              ))}
            </div>
          ) : <EmptyState msg="No failing DIDs 🎉" />}
        </Card>
      </div>
      <Card>
        <SectionTitle>Hourly Failure Trend</SectionTitle>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={(failures.hourlyFailed || []).filter((h) => h.failed > 0)}>
            <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 10 }} />
            <YAxis tick={{ fill: C.muted, fontSize: 11 }} />
            <Tooltip contentStyle={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8 }} />
            <Bar dataKey="failed" fill={C.red} name="Failed Calls" radius={[4,4,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}

// ── Tab 7: KPI ────────────────────────────────────────────────────────────────
function KPITab({ kpi }) {
  if (!kpi) return <EmptyState msg="No KPI data yet" />;
  const targetLine = { dataKey: "target", stroke: C.red, strokeDasharray: "4 4", strokeWidth: 1.5, dot: false, name: "Target 98%" };

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 20 }}>
        <KPICard label="Today"     value={pct(kpi.today)}   color={connColor(kpi.today)}   icon="📅" sub={`${num(kpi.todayTotal)} calls`} />
        <KPICard label="Last 7 Days" value={pct(kpi.last7d)} color={connColor(kpi.last7d)} icon="📆" sub={`${num(kpi.last7dTotal)} calls`} />
        <KPICard label="Last 30 Days" value={pct(kpi.last30d)} color={connColor(kpi.last30d)} icon="🗓" />
      </div>
      <Card style={{ marginBottom: 14 }}>
        <SectionTitle>Today — Hourly Connectivity vs Target</SectionTitle>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={(kpi.hourly || []).filter((h) => h.total > 0).map((h) => ({ ...h, target: 98 }))}>
            <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 10 }} />
            <YAxis domain={[80, 100]} tick={{ fill: C.muted, fontSize: 11 }} />
            <Tooltip contentStyle={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8 }} />
            <Line type="monotone" dataKey="connectivity" stroke={C.blue} strokeWidth={2} dot={false} name="Connectivity %" />
            <Line type="monotone" {...targetLine} />
          </LineChart>
        </ResponsiveContainer>
      </Card>
      <Card>
        <SectionTitle>Last 7 Days — Daily Connectivity</SectionTitle>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={(kpi.daily || []).map((d) => ({ ...d, target: 98 }))}>
            <XAxis dataKey="day" tick={{ fill: C.muted, fontSize: 10 }} />
            <YAxis domain={[80, 100]} tick={{ fill: C.muted, fontSize: 11 }} />
            <Tooltip contentStyle={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8 }} />
            <Line type="monotone" dataKey="connectivity" stroke={C.green} strokeWidth={2} dot={{ fill: C.green, r: 4 }} name="Connectivity %" />
            <Line type="monotone" {...targetLine} />
          </LineChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}

// ── Tab 8: Alert Log ──────────────────────────────────────────────────────────
function AlertLogTab({ alerts }) {
  if (!alerts?.length) return (
    <Card style={{ textAlign: "center", padding: 48 }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
      <div style={{ fontSize: 14, color: C.muted }}>No alerts — all systems nominal</div>
    </Card>
  );

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 20 }}>
        <KPICard label="Total Alerts"    value={alerts.length}                                          color={C.red}    icon="🚨" />
        <KPICard label="Critical"        value={alerts.filter((a) => a.severity === "CRITICAL" || a.status === "DOWN").length} color={C.red}    icon="🔴" />
        <KPICard label="Warnings"        value={alerts.filter((a) => a.severity === "WARNING").length}  color={C.yellow} icon="🟡" />
      </div>
      <Card>
        <SectionTitle>Alert History</SectionTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {alerts.map((a, i) => {
            const isCrit = a.severity === "CRITICAL" || a.status === "DOWN";
            return (
              <div key={i} style={{ background: C.dim, border: `1px solid ${isCrit ? C.red + "33" : C.yellow + "33"}`, borderLeft: `3px solid ${isCrit ? C.red : C.yellow}`, borderRadius: 8, padding: "10px 14px", display: "grid", gridTemplateColumns: "100px 1fr 120px", alignItems: "center", gap: 12 }}>
                <Badge status={a.severity || a.status} />
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{a.message || a.name}</div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{a.type || "Alert"}</div>
                </div>
                <div style={{ fontSize: 11, color: C.muted, textAlign: "right" }}>{fmtTime(a.time)}</div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
