import { useState, useMemo, useRef, useEffect } from "react";
import { Card, Empty, toast } from "../components/primitives";
import { haptic } from "../lib/fx";
import { makeNote, addNote, deleteNote, togglePin, searchNotes } from "../lib/notes";
import { formatShortDate } from "../lib/dates";

// ─── NOTES capture + browse (Log → Knowledge → Notes) ───────────────────────
// Deliberately minimal capture: one textarea, one Save. Not the Journal tile.

export function NotesScreen({ data, goals, setData }) {
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState(null);
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);

  const notes = data.notes || [];

  const save = () => {
    if (!text.trim()) return;
    setData(d => ({ ...d, notes: addNote(d.notes || [], makeNote(text, d, goals)) }));
    setText("");
    haptic(6);
    toast("✎ Note saved");
  };
  const remove = id => setData(d => ({ ...d, notes: deleteNote(d.notes || [], id) }));
  const pin = id => setData(d => ({ ...d, notes: togglePin(d.notes || [], id) }));

  const filtered = useMemo(() => searchNotes(notes, query, { tag }), [notes, query, tag]);
  const pinned = filtered.filter(n => n.pinned);
  const recent = filtered.filter(n => !n.pinned).slice(0, 10);
  const allTags = useMemo(() => [...new Set(notes.flatMap(n => n.tags || []))].sort(), [notes]);

  return (
    <div className="stack">
      <Card title="Notes" sub="A searchable memory of what works for you">
        <textarea ref={ref} value={text} onChange={e => setText(e.target.value)} rows={4}
          onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save(); }}
          placeholder="Low-bar squat aggravates my wrist. #squat #form"
          style={{ width: "100%", background: "var(--bg-2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 12, padding: "12px 14px", fontSize: 15, lineHeight: 1.5, resize: "vertical" }} />
        <button className="btn full" style={{ marginTop: 10 }} onClick={save} disabled={!text.trim()}>Save</button>
      </Card>

      <Card title="Your notes" sub={`${notes.length} note${notes.length === 1 ? "" : "s"}`}>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search notes…"
          style={{ width: "100%", background: "var(--bg-2)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 12px", fontSize: 14, marginBottom: 10 }} />
        {allTags.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            {tag && <button className="chip" onClick={() => setTag(null)} style={chipStyle(true)}>#{tag} ✕</button>}
            {!tag && allTags.slice(0, 12).map(t => <button key={t} onClick={() => setTag(t)} style={chipStyle(false)}>#{t}</button>)}
          </div>
        )}

        {notes.length === 0 ? (
          <Empty title="No notes yet" hint="Jot what works — a cue, a tweak, a lesson. It resurfaces when it's relevant." />
        ) : filtered.length === 0 ? (
          <p className="muted small">No notes match.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pinned.map(n => <NoteRow key={n.id} n={n} onPin={pin} onDelete={remove} onTag={setTag} />)}
            {pinned.length > 0 && recent.length > 0 && <div style={{ height: 1, background: "var(--line)", margin: "2px 0" }} />}
            {recent.map(n => <NoteRow key={n.id} n={n} onPin={pin} onDelete={remove} onTag={setTag} />)}
          </div>
        )}
      </Card>
    </div>
  );
}

function chipStyle(active) {
  return { fontSize: 12, padding: "4px 10px", borderRadius: 999, cursor: "pointer",
    border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`,
    background: active ? "rgba(120,180,200,0.14)" : "var(--bg-2)", color: active ? "var(--text)" : "var(--text-2)" };
}

export function NoteRow({ n, onPin, onDelete, onTag }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ background: "var(--bg-2)", border: "1px solid var(--line)", borderRadius: 12, padding: "11px 13px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => setOpen(o => !o)}>
          <div style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.45, ...(open ? {} : { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }) }}>{n.text}</div>
          <div className="muted small" style={{ marginTop: 3, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span>{formatShortDate(n.date)}</span>
            {n.linkedExercise && <span style={{ color: "var(--text-2)" }}>· ◆ {n.linkedExercise}</span>}
            {n.source === "experiment-verdict" && <span style={{ color: "var(--accent)" }}>· experiment</span>}
          </div>
        </div>
        {onPin && <button onClick={() => onPin(n.id)} title="Pin" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15, color: n.pinned ? "#f9c97e" : "var(--muted)" }}>{n.pinned ? "★" : "☆"}</button>}
        <button onClick={() => onDelete(n.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 17, color: "var(--muted)", lineHeight: 1 }}>×</button>
      </div>
      {n.tags?.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {n.tags.map(t => <button key={t} onClick={() => onTag && onTag(t)} style={chipStyle(false)}>#{t}</button>)}
        </div>
      )}
    </div>
  );
}

export default NotesScreen;
