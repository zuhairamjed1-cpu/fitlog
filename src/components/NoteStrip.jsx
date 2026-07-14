import { useState } from "react";
import { notesForExercise } from "../lib/notes";

// ─── NoteStrip ──────────────────────────────────────────────────────────────
// Thin strip of relevant notes for an exercise being logged. Matches by linked
// exercise or #slug tag. Caps at 3, one line each, tap to expand. Renders NOTHING
// (no border, no empty state) when there are no matches — an empty strip on every
// exercise is worse than no feature.
export function NoteStrip({ exercise, notes }) {
  const [openId, setOpenId] = useState(null);
  const matches = notesForExercise(notes, exercise).slice(0, 3);
  if (matches.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, margin: "4px 0 2px", paddingLeft: 8, borderLeft: "2px solid rgba(143,208,200,0.4)" }}>
      {matches.map(n => {
        const open = openId === n.id;
        return (
          <div key={n.id} onClick={() => setOpenId(open ? null : n.id)}
            style={{ fontSize: 11.5, color: "var(--text-2)", lineHeight: 1.4, cursor: "pointer",
              ...(open ? {} : { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }) }}>
            <span style={{ color: "#8fd0c8" }}>✐ </span>{n.text}
          </div>
        );
      })}
    </div>
  );
}

export default NoteStrip;
