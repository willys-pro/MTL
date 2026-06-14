import { useState, useEffect, useCallback, useMemo } from "react";
import * as XLSX from "xlsx";

// ── Storage helpers (persistent via artifact storage API) ──────────────────
const STORAGE_KEY = "wtl-trades-v2";
const GOALS_KEY = "wtl-goals-v1";
const SETTINGS_KEY = "wtl-settings-v1";

async function loadFromStorage(key) {
  try {
    const r = await window.storage.get(key);
    return r ? JSON.parse(r.value) : null;
  } catch {
    return null;
  }
}
async function saveToStorage(key, data) {
  try {
    await window.storage.set(key, JSON.stringify(data));
  } catch {}
}

// ── Helpers ────────────────────────────────────────────────────────────────
const fmt = (n, showSign = false) => {
  const abs = Math.abs(n);
  const str = abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (showSign) return (n < 0 ? "-$" : n > 0 ? "+$" : "$") + str;
  return (n < 0 ? "-$" : "$") + str;
};
const pct = (n) => (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
const today = () => new Date().toISOString().slice(0, 10);
const toDisplayDate = (d) => {
  const [y, m, day] = d.split("-");
  return `${m}/${day}/${y}`;
};
const monthLabel = (d) => {
  const [y, m] = d.split("-");
  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "short", year: "numeric" });
};

const TAGS = ["Forex", "Crypto", "Stocks", "Options", "Futures", "Indices", "Commodities", "Other"];
const SESSIONS = ["London", "New York", "Asian", "Overlap", "Custom"];

// ── Mini chart (inline SVG sparkline) ─────────────────────────────────────
function Sparkline({ data, color }) {
  if (!data || data.length < 2) return null;
  const h = 40, w = 120, pad = 4;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x},${y}`;
  });
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

// ── Donut chart ────────────────────────────────────────────────────────────
function DonutChart({ wins, losses }) {
  const total = wins + losses;
  if (total === 0) return <div style={{ color: "#555", fontSize: 13 }}>No trades yet</div>;
  const r = 36, cx = 44, cy = 44, circ = 2 * Math.PI * r;
  const winPct = wins / total;
  const winLen = circ * winPct;
  return (
    <svg width={88} height={88}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1a1a1a" strokeWidth={10} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#c9a84c" strokeWidth={10}
        strokeDasharray={`${winLen} ${circ}`} strokeDashoffset={circ * 0.25}
        strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#8b2020" strokeWidth={10}
        strokeDasharray={`${circ - winLen} ${circ}`}
        strokeDashoffset={circ * 0.25 - winLen}
        strokeLinecap="round" />
      <text x={cx} y={cy + 5} textAnchor="middle" fill="#e8d5a3" fontSize={13} fontWeight="700">
        {Math.round(winPct * 100)}%
      </text>
    </svg>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────
export default function App() {
  const [trades, setTrades] = useState([]);
  const [goals, setGoals] = useState({ monthly: 5000, weekly: 1250 });
  const [settings, setSettings] = useState({ accountSize: 10000, currency: "USD", trader: "Willy" });
  const [view, setView] = useState("dashboard");
  const [form, setForm] = useState({
    date: today(), amount: "", note: "", tag: "Forex", session: "New York", rr: ""
  });
  const [editId, setEditId] = useState(null);
  const [filterMonth, setFilterMonth] = useState("");
  const [filterTag, setFilterTag] = useState("All");
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [sortCol, setSortCol] = useState("date");
  const [sortDir, setSortDir] = useState("desc");

  // ── Load from storage
  useEffect(() => {
    (async () => {
      const t = await loadFromStorage(STORAGE_KEY);
      const g = await loadFromStorage(GOALS_KEY);
      const s = await loadFromStorage(SETTINGS_KEY);
      if (t) setTrades(t);
      if (g) setGoals(g);
      if (s) setSettings(s);
      setLoaded(true);
    })();
  }, []);

  // ── Persist on change
  useEffect(() => { if (loaded) saveToStorage(STORAGE_KEY, trades); }, [trades, loaded]);
  useEffect(() => { if (loaded) saveToStorage(GOALS_KEY, goals); }, [goals, loaded]);
  useEffect(() => { if (loaded) saveToStorage(SETTINGS_KEY, settings); }, [settings, loaded]);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2800);
  };

  // ── Computed stats ─────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total = trades.reduce((a, t) => a + t.amount, 0);
    const wins = trades.filter(t => t.amount > 0);
    const losses = trades.filter(t => t.amount < 0);
    const bestDay = trades.reduce((a, t) => t.amount > a ? t.amount : a, 0);
    const worstDay = trades.reduce((a, t) => t.amount < a ? t.amount : a, 0);
    const avgWin = wins.length ? wins.reduce((a, t) => a + t.amount, 0) / wins.length : 0;
    const avgLoss = losses.length ? losses.reduce((a, t) => a + t.amount, 0) / losses.length : 0;
    const rr = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : 0;
    // running equity
    const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date));
    let running = 0;
    const equity = sorted.map(t => { running += t.amount; return running; });
    // streak
    let streak = 0, streakType = null;
    for (let i = trades.length - 1; i >= 0; i--) {
      const type = trades[i].amount >= 0 ? "W" : "L";
      if (streakType === null) streakType = type;
      if (type === streakType) streak++;
      else break;
    }
    // this week
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
    const weekTrades = trades.filter(t => new Date(t.date) >= weekAgo);
    const weekPnl = weekTrades.reduce((a, t) => a + t.amount, 0);
    // this month
    const thisMonth = today().slice(0, 7);
    const monthTrades = trades.filter(t => t.date.startsWith(thisMonth));
    const monthPnl = monthTrades.reduce((a, t) => a + t.amount, 0);
    return { total, wins: wins.length, losses: losses.length, bestDay, worstDay, avgWin, avgLoss, rr, equity, streak, streakType, weekPnl, monthPnl };
  }, [trades]);

  // ── Filtered/sorted ledger
  const ledgerTrades = useMemo(() => {
    let t = [...trades];
    if (filterMonth) t = t.filter(x => x.date.startsWith(filterMonth));
    if (filterTag !== "All") t = t.filter(x => x.tag === filterTag);
    t.sort((a, b) => {
      let va = a[sortCol], vb = b[sortCol];
      if (sortCol === "amount") { va = +va; vb = +vb; }
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return t;
  }, [trades, filterMonth, filterTag, sortCol, sortDir]);

  // ── Monthly breakdown
  const monthlyData = useMemo(() => {
    const map = {};
    trades.forEach(t => {
      const m = t.date.slice(0, 7);
      if (!map[m]) map[m] = { pnl: 0, count: 0, wins: 0 };
      map[m].pnl += t.amount;
      map[m].count++;
      if (t.amount > 0) map[m].wins++;
    });
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]));
  }, [trades]);

  // ── Handlers ──────────────────────────────────────────────────────────
  const handleSubmit = () => {
    const amt = parseFloat(form.amount);
    if (!form.amount || isNaN(amt)) return showToast("Enter a valid P&L amount", "error");
    if (editId) {
      setTrades(prev => prev.map(t => t.id === editId ? { ...t, ...form, amount: amt } : t));
      setEditId(null);
      showToast("Trade updated");
    } else {
      setTrades(prev => [...prev, { id: Date.now(), ...form, amount: amt }]);
      showToast("Trade logged");
    }
    setForm({ date: today(), amount: "", note: "", tag: "Forex", session: "New York", rr: "" });
  };

  const handleEdit = (t) => {
    setEditId(t.id);
    setForm({ date: t.date, amount: String(t.amount), note: t.note || "", tag: t.tag || "Forex", session: t.session || "New York", rr: t.rr || "" });
    setView("log");
    window.scrollTo(0, 0);
  };

  const handleDelete = (id) => {
    setTrades(prev => prev.filter(t => t.id !== id));
    setConfirmDel(null);
    showToast("Trade removed", "error");
  };

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("desc"); }
  };

  // ── Excel export ──────────────────────────────────────────────────────
  const exportExcel = () => {
    const ws_data = [
      ["WILLY'S TRADING LEDGER — STATEMENT OF ACCOUNT"],
      [`Trader: ${settings.trader}`, "", `Account Size: ${fmt(settings.accountSize)}`, "", `Exported: ${toDisplayDate(today())}`],
      [],
      ["Date", "P&L ($)", "Tag", "Session", "R:R", "Notes", "Running Balance"],
    ];
    let running = 0;
    const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date));
    sorted.forEach(t => {
      running += t.amount;
      ws_data.push([toDisplayDate(t.date), t.amount, t.tag || "", t.session || "", t.rr || "", t.note || "", running]);
    });
    ws_data.push([]);
    ws_data.push(["SUMMARY"]);
    ws_data.push(["Total Net P&L", stats.total]);
    ws_data.push(["Total Trades", trades.length]);
    ws_data.push(["Win Rate", trades.length ? ((stats.wins / trades.length) * 100).toFixed(1) + "%" : "N/A"]);
    ws_data.push(["Avg Win", stats.avgWin]);
    ws_data.push(["Avg Loss", stats.avgLoss]);
    ws_data.push(["Best Day", stats.bestDay]);
    ws_data.push(["Worst Day", stats.worstDay]);
    ws_data.push(["Avg R:R", stats.rr.toFixed(2)]);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(ws_data);

    // Column widths
    ws["!cols"] = [{ wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 30 }, { wch: 18 }];

    // Monthly sheet
    const ms_data = [["MONTHLY BREAKDOWN"], ["Month", "Net P&L", "Trades", "Win Rate"]];
    monthlyData.forEach(([m, d]) => {
      ms_data.push([monthLabel(m + "-01"), d.pnl, d.count, d.count ? ((d.wins / d.count) * 100).toFixed(1) + "%" : "N/A"]);
    });
    const ms = XLSX.utils.aoa_to_sheet(ms_data);
    ms["!cols"] = [{ wch: 16 }, { wch: 14 }, { wch: 10 }, { wch: 12 }];

    XLSX.utils.book_append_sheet(wb, ws, "Trade Ledger");
    XLSX.utils.book_append_sheet(wb, ms, "Monthly Summary");
    XLSX.writeFile(wb, `WillysTradingLedger_${today()}.xlsx`);
    showToast("Excel report downloaded");
  };

  // ── Unique months for filter
  const months = [...new Set(trades.map(t => t.date.slice(0, 7)))].sort().reverse();

  const goalPctMonth = settings.accountSize ? (stats.monthPnl / goals.monthly) * 100 : 0;
  const goalPctWeek = settings.accountSize ? (stats.weekPnl / goals.weekly) * 100 : 0;

  if (!loaded) return <div style={{ background: "#0d0d0d", color: "#c9a84c", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "serif", fontSize: 22 }}>Loading vault...</div>;

  // ── Styles ────────────────────────────────────────────────────────────
  const S = {
    app: { background: "#0d0d0d", minHeight: "100vh", fontFamily: "'Georgia', 'Times New Roman', serif", color: "#c8c8c0", paddingBottom: 60 },
    header: { background: "linear-gradient(135deg,#111 60%,#1a1400 100%)", borderBottom: "1px solid #2a2200", padding: "18px 24px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100 },
    logo: { display: "flex", flexDirection: "column" },
    logoTitle: { fontSize: 22, fontWeight: "700", color: "#c9a84c", letterSpacing: "0.08em", textTransform: "uppercase" },
    logoSub: { fontSize: 11, color: "#6b5d2f", letterSpacing: "0.22em", textTransform: "uppercase" },
    nav: { display: "flex", gap: 4 },
    navBtn: (active) => ({ background: active ? "#c9a84c" : "transparent", color: active ? "#0d0d0d" : "#8a7640", border: "1px solid " + (active ? "#c9a84c" : "#2a2200"), borderRadius: 3, padding: "6px 14px", cursor: "pointer", fontSize: 12, letterSpacing: "0.1em", fontFamily: "inherit", textTransform: "uppercase", transition: "all 0.15s" }),
    main: { maxWidth: 980, margin: "0 auto", padding: "24px 16px" },
    grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 },
    grid4: { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 },
    card: { background: "#111", border: "1px solid #222", borderRadius: 6, padding: "18px 20px" },
    cardGold: { background: "linear-gradient(135deg,#16130a,#1f1900)", border: "1px solid #3a2f10", borderRadius: 6, padding: "18px 20px" },
    label: { fontSize: 10, color: "#6b5d2f", letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 4 },
    bigNum: (pos) => ({ fontSize: 28, fontWeight: "700", color: pos ? "#c9a84c" : "#a84c4c", letterSpacing: "-0.01em" }),
    subNum: (pos) => ({ fontSize: 14, color: pos ? "#7a6030" : "#6b2020" }),
    divider: { borderColor: "#1e1e1e", margin: "22px 0" },
    input: { width: "100%", background: "#0a0a0a", border: "1px solid #2a2200", borderRadius: 4, color: "#c8c8c0", padding: "9px 12px", fontSize: 14, fontFamily: "inherit", boxSizing: "border-box", outline: "none" },
    select: { width: "100%", background: "#0a0a0a", border: "1px solid #2a2200", borderRadius: 4, color: "#c8c8c0", padding: "9px 12px", fontSize: 14, fontFamily: "inherit", boxSizing: "border-box", outline: "none" },
    btn: { background: "#c9a84c", color: "#0d0d0d", border: "none", borderRadius: 4, padding: "10px 22px", fontFamily: "inherit", fontWeight: "700", fontSize: 13, cursor: "pointer", letterSpacing: "0.08em", textTransform: "uppercase" },
    btnGhost: { background: "transparent", color: "#6b5d2f", border: "1px solid #2a2200", borderRadius: 4, padding: "8px 16px", fontFamily: "inherit", fontSize: 12, cursor: "pointer", letterSpacing: "0.08em", textTransform: "uppercase" },
    btnDanger: { background: "#3d1010", color: "#c84c4c", border: "1px solid #5a1a1a", borderRadius: 4, padding: "5px 12px", fontFamily: "inherit", fontSize: 11, cursor: "pointer" },
    row: { display: "flex", gap: 12, alignItems: "flex-end" },
    progressBar: (pct, color) => ({ height: 6, borderRadius: 3, background: "#1a1a1a", marginTop: 8, overflow: "hidden", position: "relative" }),
    progressFill: (pct, color) => ({ height: "100%", width: `${Math.min(100, Math.max(0, pct))}%`, background: color, borderRadius: 3, transition: "width 0.5s" }),
    tag: (color) => ({ display: "inline-block", background: color + "22", color, border: `1px solid ${color}44`, borderRadius: 3, fontSize: 10, padding: "2px 7px", letterSpacing: "0.1em", textTransform: "uppercase" }),
    modal: { position: "fixed", inset: 0, background: "#000000cc", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" },
    modalBox: { background: "#111", border: "1px solid #3a2f10", borderRadius: 8, padding: 28, minWidth: 320, maxWidth: 420, width: "90%" },
    th: { color: "#6b5d2f", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", padding: "8px 12px", textAlign: "left", borderBottom: "1px solid #1e1e1e", cursor: "pointer", userSelect: "none" },
    td: { padding: "9px 12px", borderBottom: "1px solid #181818", fontSize: 13 },
    streakBadge: { display: "inline-flex", alignItems: "center", gap: 6, background: "#16130a", border: "1px solid #3a2f10", borderRadius: 20, padding: "4px 14px", fontSize: 13 },
    toast: (type) => ({ position: "fixed", bottom: 24, right: 24, background: type === "error" ? "#3d1010" : "#16130a", border: `1px solid ${type === "error" ? "#a84c4c" : "#c9a84c"}`, color: type === "error" ? "#c84c4c" : "#c9a84c", borderRadius: 6, padding: "12px 20px", fontSize: 13, zIndex: 999, fontFamily: "inherit", letterSpacing: "0.05em", boxShadow: "0 4px 20px #000a" }),
  };

  const tagColors = { Forex: "#4c9ac9", Crypto: "#c97a4c", Stocks: "#4cc97a", Options: "#9a4cc9", Futures: "#c9c94c", Indices: "#4cc9c9", Commodities: "#c94c9a", Other: "#888" };

  // ── DASHBOARD ──────────────────────────────────────────────────────────
  const Dashboard = () => (
    <div>
      {/* Equity summary */}
      <div style={{ ...S.cardGold, marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
        <div>
          <div style={S.label}>Total Net P&L</div>
          <div style={{ ...S.bigNum(stats.total >= 0), fontSize: 36 }}>{fmt(stats.total, true)}</div>
          <div style={{ color: "#6b5d2f", fontSize: 12, marginTop: 4 }}>{trades.length} trades recorded · Account: {fmt(settings.accountSize + stats.total)}</div>
        </div>
        <div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ textAlign: "center" }}>
            <DonutChart wins={stats.wins} losses={stats.losses} />
            <div style={{ color: "#6b5d2f", fontSize: 11, marginTop: 4 }}>Win Rate</div>
          </div>
          <div>
            <div style={S.label}>Streak</div>
            <div style={S.streakBadge}>
              <span style={{ color: stats.streakType === "W" ? "#c9a84c" : "#a84c4c", fontSize: 16 }}>{stats.streakType === "W" ? "▲" : "▼"}</span>
              <span style={{ color: "#c8c8c0", fontWeight: 700 }}>{stats.streak}</span>
              <span style={{ color: "#555", fontSize: 11 }}>{stats.streakType === "W" ? "wins" : "losses"}</span>
            </div>
            <div style={{ ...S.label, marginTop: 12 }}>Avg R:R</div>
            <div style={{ color: "#c9a84c", fontSize: 20, fontWeight: 700 }}>{stats.rr.toFixed(2)}x</div>
          </div>
        </div>
      </div>

      {/* 4 stat cards */}
      <div style={{ ...S.grid4, marginBottom: 14 }}>
        {[
          { label: "Best Day", val: stats.bestDay, pos: true },
          { label: "Worst Day", val: stats.worstDay, pos: false },
          { label: "Avg Win", val: stats.avgWin, pos: true },
          { label: "Avg Loss", val: stats.avgLoss, pos: false },
        ].map(({ label, val, pos }) => (
          <div key={label} style={S.card}>
            <div style={S.label}>{label}</div>
            <div style={S.bigNum(pos)}>{fmt(val, true)}</div>
          </div>
        ))}
      </div>

      {/* Goals + weekly/monthly */}
      <div style={{ ...S.grid2, marginBottom: 14 }}>
        <div style={S.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={S.label}>Monthly Goal</div>
            <button style={S.btnGhost} onClick={() => setShowGoalModal(true)}>Edit</button>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: stats.monthPnl >= 0 ? "#c9a84c" : "#a84c4c", fontSize: 22, fontWeight: 700 }}>{fmt(stats.monthPnl, true)}</span>
            <span style={{ color: "#555", fontSize: 13 }}>/ {fmt(goals.monthly)}</span>
          </div>
          <div style={S.progressBar()}>
            <div style={S.progressFill(goalPctMonth, goalPctMonth >= 100 ? "#4cc97a" : "#c9a84c")} />
          </div>
          <div style={{ color: "#6b5d2f", fontSize: 11, marginTop: 6 }}>{Math.min(100, goalPctMonth).toFixed(1)}% of goal reached</div>
        </div>
        <div style={S.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={S.label}>Weekly Goal</div>
            <span style={{ color: "#555", fontSize: 11 }}>Last 7 days</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: stats.weekPnl >= 0 ? "#c9a84c" : "#a84c4c", fontSize: 22, fontWeight: 700 }}>{fmt(stats.weekPnl, true)}</span>
            <span style={{ color: "#555", fontSize: 13 }}>/ {fmt(goals.weekly)}</span>
          </div>
          <div style={S.progressBar()}>
            <div style={S.progressFill(goalPctWeek, goalPctWeek >= 100 ? "#4cc97a" : "#c9a84c")} />
          </div>
          <div style={{ color: "#6b5d2f", fontSize: 11, marginTop: 6 }}>{Math.min(100, goalPctWeek).toFixed(1)}% of goal reached</div>
        </div>
      </div>

      {/* Equity curve sparkline */}
      {stats.equity.length > 1 && (
        <div style={{ ...S.card, marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={S.label}>Equity Curve</div>
            <span style={{ color: "#555", fontSize: 11 }}>{trades.length} data points</span>
          </div>
          <EquityCurve data={stats.equity} />
        </div>
      )}

      {/* Monthly breakdown */}
      <div style={S.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={S.label}>Monthly Breakdown</div>
          <button style={S.btn} onClick={exportExcel}>⬇ Export Excel</button>
        </div>
        {monthlyData.length === 0 ? (
          <div style={{ color: "#333", textAlign: "center", padding: "30px 0" }}>No trades yet — start logging below</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Month", "Net P&L", "Trades", "Win Rate", "Sparkline"].map(h => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {monthlyData.map(([m, d]) => {
                const monthTrades = trades.filter(t => t.date.startsWith(m)).sort((a, b) => a.date.localeCompare(b.date));
                return (
                  <tr key={m}>
                    <td style={S.td}>{monthLabel(m + "-01")}</td>
                    <td style={{ ...S.td, color: d.pnl >= 0 ? "#c9a84c" : "#a84c4c", fontWeight: 700 }}>{fmt(d.pnl, true)}</td>
                    <td style={S.td}>{d.count}</td>
                    <td style={S.td}>{d.count ? ((d.wins / d.count) * 100).toFixed(1) + "%" : "N/A"}</td>
                    <td style={S.td}><Sparkline data={monthTrades.map(t => t.amount)} color={d.pnl >= 0 ? "#c9a84c" : "#a84c4c"} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );

  // ── Full equity curve SVG ─────────────────────────────────────────────
  function EquityCurve({ data }) {
    const h = 120, w = 900, pad = 12;
    const min = Math.min(0, ...data);
    const max = Math.max(0, ...data);
    const range = max - min || 1;
    const pts = data.map((v, i) => {
      const x = pad + (i / (data.length - 1)) * (w - pad * 2);
      const y = h - pad - ((v - min) / range) * (h - pad * 2);
      return [x, y];
    });
    const pathD = pts.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(" ");
    const areaD = `${pathD} L${pts[pts.length - 1][0]},${h} L${pts[0][0]},${h} Z`;
    const zeroY = h - pad - ((0 - min) / range) * (h - pad * 2);
    const isPos = data[data.length - 1] >= 0;
    return (
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: "block" }}>
        <defs>
          <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={isPos ? "#c9a84c" : "#a84c4c"} stopOpacity="0.18" />
            <stop offset="100%" stopColor={isPos ? "#c9a84c" : "#a84c4c"} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={pad} y1={zeroY} x2={w - pad} y2={zeroY} stroke="#2a2a2a" strokeWidth="1" strokeDasharray="4,4" />
        <path d={areaD} fill="url(#eq)" />
        <path d={pathD} fill="none" stroke={isPos ? "#c9a84c" : "#a84c4c"} strokeWidth="2" strokeLinejoin="round" />
      </svg>
    );
  }

  // ── LOG TRADE VIEW ────────────────────────────────────────────────────
  const LogView = () => (
    <div style={{ maxWidth: 560 }}>
      <div style={{ ...S.cardGold, marginBottom: 20 }}>
        <div style={{ ...S.label, marginBottom: 16 }}>{editId ? "Edit Trade" : "Log Daily P&L"}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <div style={S.label}>Date</div>
            <input type="date" style={S.input} value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
          </div>
          <div>
            <div style={S.label}>P&L ($) — use − for loss</div>
            <input type="number" step="0.01" style={{ ...S.input, color: parseFloat(form.amount) < 0 ? "#c84c4c" : parseFloat(form.amount) > 0 ? "#c9a84c" : "#c8c8c0" }}
              value={form.amount} placeholder="+850 or -320"
              onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
          </div>
          <div>
            <div style={S.label}>Market</div>
            <select style={S.select} value={form.tag} onChange={e => setForm(f => ({ ...f, tag: e.target.value }))}>
              {TAGS.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <div style={S.label}>Session</div>
            <select style={S.select} value={form.session} onChange={e => setForm(f => ({ ...f, session: e.target.value }))}>
              {SESSIONS.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <div style={S.label}>R:R Ratio (optional)</div>
            <input type="number" step="0.1" style={S.input} value={form.rr} placeholder="e.g. 2.5"
              onChange={e => setForm(f => ({ ...f, rr: e.target.value }))} />
          </div>
          <div>
            <div style={S.label}>Notes (optional)</div>
            <input type="text" style={S.input} value={form.note} placeholder="Setup, reason, lesson..."
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
          <button style={S.btn} onClick={handleSubmit}>{editId ? "Update Trade" : "Log Trade"}</button>
          {editId && <button style={S.btnGhost} onClick={() => { setEditId(null); setForm({ date: today(), amount: "", note: "", tag: "Forex", session: "New York", rr: "" }); }}>Cancel</button>}
        </div>
      </div>

      {/* Quick stats inline */}
      {trades.length > 0 && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {[{ label: "Trades", val: trades.length }, { label: "Net P&L", val: fmt(stats.total, true) }, { label: "Win Rate", val: trades.length ? ((stats.wins / trades.length) * 100).toFixed(1) + "%" : "-" }].map(({ label, val }) => (
            <div key={label} style={{ ...S.card, flex: 1, minWidth: 100 }}>
              <div style={S.label}>{label}</div>
              <div style={{ color: "#c9a84c", fontWeight: 700, fontSize: 17 }}>{val}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // ── LEDGER VIEW ───────────────────────────────────────────────────────
  const LedgerView = () => (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <select style={{ ...S.select, width: "auto", minWidth: 140 }} value={filterMonth} onChange={e => setFilterMonth(e.target.value)}>
          <option value="">All Months</option>
          {months.map(m => <option key={m} value={m}>{monthLabel(m + "-01")}</option>)}
        </select>
        <select style={{ ...S.select, width: "auto", minWidth: 120 }} value={filterTag} onChange={e => setFilterTag(e.target.value)}>
          <option value="All">All Markets</option>
          {TAGS.map(t => <option key={t}>{t}</option>)}
        </select>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <span style={{ color: "#555", fontSize: 12, alignSelf: "center" }}>{ledgerTrades.length} records · {fmt(ledgerTrades.reduce((a, t) => a + t.amount, 0), true)}</span>
          <button style={S.btn} onClick={exportExcel}>⬇ Export Excel</button>
        </div>
      </div>

      {ledgerTrades.length === 0 ? (
        <div style={{ ...S.card, textAlign: "center", padding: "40px 0", color: "#333" }}>No trades match the filter</div>
      ) : (
        <div style={{ ...S.card, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
            <thead>
              <tr>
                {[["date", "Date"], ["amount", "P&L"], ["tag", "Market"], ["session", "Session"], ["rr", "R:R"], ["note", "Notes"], ["", ""]].map(([col, label]) => (
                  <th key={label} style={S.th} onClick={() => col && handleSort(col)}>
                    {label}{col && sortCol === col ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ledgerTrades.map(t => (
                <tr key={t.id} style={{ transition: "background 0.1s" }}
                  onMouseEnter={e => e.currentTarget.style.background = "#161610"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <td style={S.td}>{toDisplayDate(t.date)}</td>
                  <td style={{ ...S.td, color: t.amount >= 0 ? "#c9a84c" : "#a84c4c", fontWeight: 700 }}>{fmt(t.amount, true)}</td>
                  <td style={S.td}><span style={S.tag(tagColors[t.tag] || "#888")}>{t.tag}</span></td>
                  <td style={{ ...S.td, color: "#666", fontSize: 12 }}>{t.session || "—"}</td>
                  <td style={{ ...S.td, color: "#666", fontSize: 12 }}>{t.rr ? t.rr + "x" : "—"}</td>
                  <td style={{ ...S.td, color: "#555", fontSize: 12, maxWidth: 200 }}>{t.note || ""}</td>
                  <td style={S.td}>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button style={S.btnGhost} onClick={() => handleEdit(t)}>Edit</button>
                      <button style={S.btnDanger} onClick={() => setConfirmDel(t.id)}>✕</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  // ── ANALYTICS VIEW ────────────────────────────────────────────────────
  const AnalyticsView = () => {
    const byTag = TAGS.map(tag => {
      const t = trades.filter(x => x.tag === tag);
      const pnl = t.reduce((a, x) => a + x.amount, 0);
      const wins = t.filter(x => x.amount > 0).length;
      return { tag, count: t.length, pnl, wr: t.length ? ((wins / t.length) * 100).toFixed(1) : null };
    }).filter(x => x.count > 0);
    const bySession = SESSIONS.map(s => {
      const t = trades.filter(x => x.session === s);
      const pnl = t.reduce((a, x) => a + x.amount, 0);
      return { session: s, count: t.length, pnl };
    }).filter(x => x.count > 0);

    return (
      <div>
        <div style={{ ...S.grid2, marginBottom: 14 }}>
          <div style={S.card}>
            <div style={{ ...S.label, marginBottom: 14 }}>P&L by Market</div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["Market", "Trades", "P&L", "Win%"].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {byTag.map(r => (
                  <tr key={r.tag}>
                    <td style={S.td}><span style={S.tag(tagColors[r.tag] || "#888")}>{r.tag}</span></td>
                    <td style={S.td}>{r.count}</td>
                    <td style={{ ...S.td, color: r.pnl >= 0 ? "#c9a84c" : "#a84c4c", fontWeight: 700 }}>{fmt(r.pnl, true)}</td>
                    <td style={S.td}>{r.wr ? r.wr + "%" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={S.card}>
            <div style={{ ...S.label, marginBottom: 14 }}>P&L by Session</div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["Session", "Trades", "P&L"].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {bySession.map(r => (
                  <tr key={r.session}>
                    <td style={S.td}>{r.session}</td>
                    <td style={S.td}>{r.count}</td>
                    <td style={{ ...S.td, color: r.pnl >= 0 ? "#c9a84c" : "#a84c4c", fontWeight: 700 }}>{fmt(r.pnl, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div style={S.card}>
          <div style={S.label}>Key Performance Metrics</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginTop: 14 }}>
            {[
              { label: "Profit Factor", val: stats.avgLoss ? Math.abs(stats.avgWin / stats.avgLoss).toFixed(2) + "x" : "∞" },
              { label: "Win / Loss", val: `${stats.wins} / ${stats.losses}` },
              { label: "Avg R:R", val: stats.rr.toFixed(2) + "x" },
              { label: "Best Day", val: fmt(stats.bestDay, true) },
              { label: "Worst Day", val: fmt(stats.worstDay, true) },
              { label: "Total Trades", val: trades.length },
            ].map(({ label, val }) => (
              <div key={label} style={{ background: "#0d0d0d", border: "1px solid #1e1e1e", borderRadius: 4, padding: "14px 16px" }}>
                <div style={S.label}>{label}</div>
                <div style={{ color: "#c9a84c", fontSize: 20, fontWeight: 700 }}>{val}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  // ── RENDER ────────────────────────────────────────────────────────────
  return (
    <div style={S.app}>
      {/* Header */}
      <div style={S.header}>
        <div style={S.logo}>
          <div style={S.logoTitle}>Willy's Trading Ledger</div>
          <div style={S.logoSub}>Private · Encrypted · Offline Ready</div>
        </div>
        <div style={S.nav}>
          {[["dashboard", "Dashboard"], ["log", "Log Trade"], ["ledger", "Ledger"], ["analytics", "Analytics"]].map(([v, l]) => (
            <button key={v} style={S.navBtn(view === v)} onClick={() => setView(v)}>{l}</button>
          ))}
          <button style={{ ...S.navBtn(false), marginLeft: 8 }} onClick={() => setShowSettingsModal(true)}>⚙</button>
        </div>
      </div>

      <div style={S.main}>
        {view === "dashboard" && <Dashboard />}
        {view === "log" && <LogView />}
        {view === "ledger" && <LedgerView />}
        {view === "analytics" && <AnalyticsView />}
      </div>

      {/* Goal Modal */}
      {showGoalModal && (
        <div style={S.modal} onClick={() => setShowGoalModal(false)}>
          <div style={S.modalBox} onClick={e => e.stopPropagation()}>
            <div style={{ ...S.label, fontSize: 13, marginBottom: 16 }}>Set Profit Goals</div>
            <div style={{ marginBottom: 12 }}>
              <div style={S.label}>Monthly Goal ($)</div>
              <input type="number" style={S.input} value={goals.monthly}
                onChange={e => setGoals(g => ({ ...g, monthly: parseFloat(e.target.value) || 0 }))} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <div style={S.label}>Weekly Goal ($)</div>
              <input type="number" style={S.input} value={goals.weekly}
                onChange={e => setGoals(g => ({ ...g, weekly: parseFloat(e.target.value) || 0 }))} />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button style={S.btn} onClick={() => { setShowGoalModal(false); showToast("Goals updated"); }}>Save Goals</button>
              <button style={S.btnGhost} onClick={() => setShowGoalModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettingsModal && (
        <div style={S.modal} onClick={() => setShowSettingsModal(false)}>
          <div style={S.modalBox} onClick={e => e.stopPropagation()}>
            <div style={{ ...S.label, fontSize: 13, marginBottom: 16 }}>Account Settings</div>
            <div style={{ marginBottom: 12 }}>
              <div style={S.label}>Trader Name</div>
              <input type="text" style={S.input} value={settings.trader}
                onChange={e => setSettings(s => ({ ...s, trader: e.target.value }))} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <div style={S.label}>Starting Account Size ($)</div>
              <input type="number" style={S.input} value={settings.accountSize}
                onChange={e => setSettings(s => ({ ...s, accountSize: parseFloat(e.target.value) || 0 }))} />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button style={S.btn} onClick={() => { setShowSettingsModal(false); showToast("Settings saved"); }}>Save</button>
              <button style={S.btnGhost} onClick={() => setShowSettingsModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Delete */}
      {confirmDel && (
        <div style={S.modal} onClick={() => setConfirmDel(null)}>
          <div style={{ ...S.modalBox, maxWidth: 340 }} onClick={e => e.stopPropagation()}>
            <div style={{ color: "#c84c4c", marginBottom: 10, fontSize: 15, fontWeight: 700 }}>Remove Trade?</div>
            <div style={{ color: "#666", fontSize: 13, marginBottom: 20 }}>This action cannot be undone.</div>
            <div style={{ display: "flex", gap: 10 }}>
              <button style={{ ...S.btn, background: "#8b2020", color: "#fff" }} onClick={() => handleDelete(confirmDel)}>Remove</button>
              <button style={S.btnGhost} onClick={() => setConfirmDel(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && <div style={S.toast(toast.type)}>{toast.msg}</div>}
    </div>
  );
}
