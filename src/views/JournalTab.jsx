import { useState, useMemo } from "react";
import { toast } from "../components/primitives";
import { getTodayStr, daysAgo } from "../lib/dates";
import { haptic, SFX } from "../lib/fx";

// ─── JOURNAL TAB ──────────────────────────────────────────────────────────────
// A freeform notebook. Each entry = text + timestamp + an auto-captured snapshot of
// what was logged that day. Recent entries feed the coach's brain.

// Build a compact one-line snapshot of what the user logged on a given date.
function journalSnapshot(data, dateStr) {
  const bits = [];
  const dayDiet = (data.diet || []).filter(d => d.date === dateStr);
  if (dayDiet.length) {
    const cal = dayDiet.reduce((a, m) => a + (m.calories || 0), 0);
    const p = dayDiet.reduce((a, m) => a + (m.protein || 0), 0);
    bits.push({ icon: "◉", text: `${cal} kcal · ${p}g P` });
  }
  const sleep = (data.sleep || []).find(s => s.date === dateStr);
  if (sleep) bits.push({ icon: "☾", text: `${sleep.duration}h${sleep.quality ? ` ${sleep.quality.toLowerCase()}` : ""}` });
  const lift = (data.exercise || []).find(e => e.date === dateStr);
  const sport = (data.sports || []).find(s => s.date === dateStr);
  if (lift) bits.push({ icon: "◆", text: lift.label || "workout" });
  if (sport) bits.push({ icon: "◇", text: `${sport.sport}${sport.duration ? ` ${sport.duration}m` : ""}` });
  const nic = (data.nicotine || []).filter(n => n.date === dateStr);
  if (nic.length) bits.push({ icon: "🚬", text: `${nic.length}×` });
  return bits;
}

export function JournalTab({ data, goals, addEntry, deleteEntry }) {
  const [text, setText] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState("");
  const onAdd = addEntry("journal");
  const onDelete = deleteEntry("journal");

  const entries = (data.journal || []).slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));

  // Rotate a gentle prompt for the blank-page nudge
  const prompts = [
    "What's on your mind?",
    "How did today feel?",
    "Anything worth remembering?",
    "What went well, what didn't?",
    "Notes to your future self…",
  ];
  const prompt = useMemo(() => prompts[Math.floor(Date.now() / 86400000) % prompts.length], []);

  function save() {
    const t = text.trim();
    if (!t) return;
    const now = new Date();
    const date = getTodayStr();
    onAdd({ id: Date.now(), ts: now.getTime(), date, text: t, snapshot: journalSnapshot(data, date) });
    haptic(12); SFX.log();
    toast("✒ Entry saved", { silent: true });
    setText("");
  }

  function saveEdit(id) {
    const t = editText.trim();
    if (!t) { setEditingId(null); return; }
    // Re-find entry and update via delete+add isn't ideal; use setData through addEntry's parent.
    // Simpler: mutate through a dedicated path — we delete then re-add with same id/ts.
    const orig = entries.find(e => e.id === id);
    if (orig) {
      onDelete(id);
      onAdd({ ...orig, text: t, edited: true });
    }
    setEditingId(null); setEditText("");
    haptic(10);
  }

  // Group entries by date for the diary feel
  const groups = [];
  let lastDate = null;
  entries.forEach(e => {
    if (e.date !== lastDate) { groups.push({ date: e.date, items: [] }); lastDate = e.date; }
    groups[groups.length - 1].items.push(e);
  });

  function dateLabel(ds) {
    if (ds === getTodayStr()) return "Today";
    if (ds === daysAgo(1)) return "Yesterday";
    const d = new Date(ds + "T00:00:00");
    return d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  }

  return (
    <div className="journal">
      {/* Composer */}
      <div className="journal-composer">
        <textarea
          className="journal-input"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={prompt}
          rows={4}
        />
        <div className="journal-composer-foot">
          <span className="journal-hint">{text.trim() ? `${text.trim().length} characters` : "Saved privately · your coach can read recent notes"}</span>
          <button className="btn journal-save" onClick={save} disabled={!text.trim()}>Save entry</button>
        </div>
      </div>

      {/* Feed */}
      {entries.length === 0 ? (
        <div className="journal-empty">
          <div className="journal-empty-mark">✒</div>
          <p className="journal-empty-title">Your notebook is empty</p>
          <p className="journal-empty-hint">Jot down how training felt, what's going on in life, a tweak you tried, a win, a worry. Anything you write here gives your coach the context the numbers can't.</p>
        </div>
      ) : (
        groups.map(g => (
          <div key={g.date} className="journal-day">
            <div className="journal-day-head">{dateLabel(g.date)}</div>
            {g.items.map(e => (
              <div key={e.id} className="journal-entry">
                <div className="journal-entry-time">
                  {new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  {e.edited && <span className="journal-edited"> · edited</span>}
                </div>
                {editingId === e.id ? (
                  <div className="journal-edit">
                    <textarea value={editText} onChange={ev => setEditText(ev.target.value)} rows={4} className="journal-input" />
                    <div className="journal-edit-actions">
                      <button className="btn-ghost" onClick={() => setEditingId(null)}>Cancel</button>
                      <button className="btn" onClick={() => saveEdit(e.id)}>Save</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="journal-entry-text">{e.text}</p>
                    {e.snapshot?.length > 0 && (
                      <div className="journal-snapshot">
                        {e.snapshot.map((s, i) => (
                          <span key={i} className="journal-snap-pill"><span className="journal-snap-icon">{s.icon}</span>{s.text}</span>
                        ))}
                      </div>
                    )}
                    <div className="journal-entry-actions">
                      <button className="journal-act" onClick={() => { setEditingId(e.id); setEditText(e.text); }}>Edit</button>
                      <button className="journal-act journal-act-del" onClick={() => { onDelete(e.id); haptic(10); }}>Delete</button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
