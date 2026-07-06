// ─── EJAC TAB (private personal habit tracker) ──────────────────────────────
// Neutral behavioral metric. Logs one entry per session: { id, date, ts, porn,
// gooning }. Daily count = entries on that date. No coaching or judgments here.
import { useState } from "react";
import { getTodayStr, daysAgo } from "../lib/dates";
import { haptic, SFX } from "../lib/fx";
import { Card, Empty, MiniChart, toast } from "../components/primitives";

export function EjacTab({ data, addEntry, deleteEntry }) {
  const today = getTodayStr();
  const [modalOpen, setModalOpen] = useState(false);
  const [mPorn, setMPorn] = useState(false);
  const [mGoon, setMGoon] = useState(false);

  const ejac = data.ejac || [];
  const onAdd = addEntry("ejac");
  const onDelete = deleteEntry("ejac");

  const logSession = (porn, gooning) => {
    onAdd({ id: Date.now(), date: today, ts: Date.now(), porn: !!porn, gooning: !!gooning });
    haptic(12); SFX.tap();
    toast("Logged", { silent: true });
  };
  const quickAdd = () => logSession(false, false);
  const saveModal = () => { logSession(mPorn, mGoon); setModalOpen(false); setMPorn(false); setMGoon(false); };

  const inDays = (n) => ejac.filter(e => e.date >= daysAgo(n - 1));
  const todayList = ejac.filter(e => e.date === today).sort((a, b) => (b.ts || 0) - (a.ts || 0));

  // Streaks — full days WITHOUT a session. current = days since the last one
  // (0 if today has a session); best = longest clean run ever, incl. the current
  // one; pornFree = days since the last porn-flagged session (or since first log
  // if never). Neutral data, no judgment — same policy as the rest of this tab.
  const streaks = (() => {
    if (!ejac.length) return null;
    const dayDiff = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
    const dates = [...new Set(ejac.map(e => e.date))].sort();
    const current = Math.max(0, dayDiff(dates[dates.length - 1], today));
    let best = current;
    for (let i = 1; i < dates.length; i++) best = Math.max(best, dayDiff(dates[i - 1], dates[i]) - 1);
    const pornDates = [...new Set(ejac.filter(e => e.porn).map(e => e.date))].sort();
    const pornFree = pornDates.length ? Math.max(0, dayDiff(pornDates[pornDates.length - 1], today)) : Math.max(0, dayDiff(dates[0], today));
    return { current, best, pornFree };
  })();
  const wk = inDays(7), mo = inDays(30);
  const tally = arr => ({ total: arr.length, porn: arr.filter(e => e.porn).length, goon: arr.filter(e => e.gooning).length });
  const T = tally(todayList), W = tally(wk), M = tally(mo);
  const activeDays30 = new Set(mo.map(e => e.date)).size;
  const pct = (a, b) => b ? Math.round((a / b) * 100) : 0;

  // Daily bars (last 30 days)
  const daily = Array.from({ length: 30 }, (_, i) => {
    const d = daysAgo(29 - i);
    return { d, n: ejac.filter(e => e.date === d).length };
  });
  const dailyMax = Math.max(1, ...daily.map(x => x.n));

  // Weekly trend (last 8 weeks) and monthly trend (last 6 months)
  const weekly = Array.from({ length: 8 }, (_, i) => {
    const wi = 7 - i; // oldest..newest
    const start = daysAgo(wi * 7 + 6), end = daysAgo(wi * 7);
    const n = ejac.filter(e => e.date >= start && e.date <= end).length;
    return { value: n, label: start.slice(5) };
  });
  const monthly = (() => {
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const dt = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
      const n = ejac.filter(e => (e.date || "").slice(0, 7) === key).length;
      return { value: n, label: key.slice(2) };
    });
  })();

  const Stat = ({ label, value }) => (
    <div style={{ flex: 1, textAlign: "center" }}>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
      <div className="muted small">{label}</div>
    </div>
  );

  return (
    <div className="stack">
      <Card title="Today" sub={today}>
        <div style={{ display: "flex", gap: 8 }}>
          <Stat label="sessions" value={T.total} />
          <Stat label="porn" value={T.porn} />
          <Stat label="gooning" value={T.goon} />
        </div>
        <div className="row" style={{ marginTop: 14, gap: 8 }}>
          <button className="btn" style={{ flex: 1 }} onClick={() => setModalOpen(true)}>+ Log session</button>
          <button className="btn btn-ghost" onClick={quickAdd}>+1 quick</button>
        </div>
      </Card>

      {streaks && (
        <Card title="🔥 Streaks" sub="full days without a session">
          <div style={{ display: "flex", gap: 8 }}>
            <Stat label="current" value={`${streaks.current}d`} />
            <Stat label="best" value={`${streaks.best}d`} />
            <Stat label="porn-free" value={`${streaks.pornFree}d`} />
          </div>
          {streaks.current > 0 && streaks.current >= streaks.best && streaks.best >= 2 && (
            <div className="muted small" style={{ marginTop: 10, textAlign: "center" }}>🏆 This is your longest run yet.</div>
          )}
        </Card>
      )}

      <Card title="This week" sub="last 7 days">
        <div style={{ display: "flex", gap: 8 }}>
          <Stat label="sessions" value={W.total} />
          <Stat label="porn" value={W.porn} />
          <Stat label="gooning" value={W.goon} />
        </div>
      </Card>

      <Card title="This month" sub="last 30 days">
        <div style={{ display: "flex", gap: 8 }}>
          <Stat label="sessions" value={M.total} />
          <Stat label="/day (cal)" value={(M.total / 30).toFixed(2)} />
          <Stat label="/active day" value={activeDays30 ? (M.total / activeDays30).toFixed(2) : "0"} />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <Stat label="porn %" value={`${pct(M.porn, M.total)}%`} />
          <Stat label="gooning %" value={`${pct(M.goon, M.total)}%`} />
        </div>
      </Card>

      {ejac.length > 0 ? (
        <>
          <Card title="Daily frequency" sub="sessions per day · last 30 days">
            <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 70 }}>
              {daily.map((x, i) => (
                <div key={i} title={`${x.d}: ${x.n}`} style={{ flex: 1, height: `${(x.n / dailyMax) * 100}%`, minHeight: x.n ? 3 : 1, background: x.n ? "var(--accent)" : "var(--muted)", opacity: x.n ? 1 : 0.3, borderRadius: 2 }} />
              ))}
            </div>
          </Card>
          <Card title="Weekly trend" sub="total sessions per week · last 8 weeks">
            <MiniChart points={weekly} height={90} />
          </Card>
          <Card title="Monthly trend" sub="total sessions per month · last 6 months">
            <MiniChart points={monthly} height={90} />
          </Card>
        </>
      ) : (
        <Empty icon="•" title="No sessions logged yet" hint="Use + Log session or +1 quick to start building your history." />
      )}

      {todayList.length > 0 && (
        <Card title="Today's sessions">
          <div className="list">
            {todayList.map(e => (
              <div key={e.id} className="list-row">
                <span className="list-main">{e.ts ? new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</span>
                <span className="muted small">{[e.porn ? "porn" : null, e.gooning ? "gooning" : null].filter(Boolean).join(", ") || "—"}</span>
                <button className="x" onClick={() => onDelete(e.id)}>×</button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {modalOpen && (
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Log session</h3>
            <div style={{ margin: "14px 0" }}>
              <div className="muted small" style={{ marginBottom: 6 }}>Pornography used?</div>
              <div className="seg">
                <button className={`seg-btn ${!mPorn ? "active" : ""}`} onClick={() => setMPorn(false)}>No</button>
                <button className={`seg-btn ${mPorn ? "active" : ""}`} onClick={() => setMPorn(true)}>Yes</button>
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <div className="muted small" style={{ marginBottom: 6 }}>Gooning session?</div>
              <div className="seg">
                <button className={`seg-btn ${!mGoon ? "active" : ""}`} onClick={() => setMGoon(false)}>No</button>
                <button className={`seg-btn ${mGoon ? "active" : ""}`} onClick={() => setMGoon(true)}>Yes</button>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setModalOpen(false)}>Cancel</button>
              <button className="btn" onClick={saveModal}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
