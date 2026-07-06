// Shared "Recent" list shown under log forms — renders up to 3 recent entries.
export function RecentList({ entries, render }) {
  if (!entries || entries.length === 0) return null;
  return (
    <div className="recent-after">
      <div className="recent-after-label">Recent</div>
      <div className="recent-after-list">
        {entries.slice(0, 3).map(e => (
          <div key={e.id} className="recent-after-item">{render(e)}</div>
        ))}
      </div>
    </div>
  );
}
