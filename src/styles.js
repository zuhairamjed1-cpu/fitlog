export const styles = `
@import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Inter:wght@400;500;600;700&display=swap');
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg: #0a0b0f;
  --surface: #14161c;
  --surface-2: #1a1d25;
  --border: rgba(255,255,255,0.06);
  --border-strong: rgba(255,255,255,0.1);
  --text: #ebedf2;
  --text-2: #b5b9c4;
  --muted: #6b7180;
  --accent: #6ee7f7;
  --accent-dim: rgba(110,231,247,0.12);
  --track: rgba(255,255,255,0.06);
  --good: #8fd989;
  --warn: #f9c97e;
  --bad: #f47e6e;
  --radius: 14px;
  --radius-sm: 10px;
  --accent-glow: rgba(110,231,247,0.35);
  --shadow-card: 0 1px 2px rgba(0,0,0,0.3), 0 6px 16px rgba(0,0,0,0.25);
  --shadow-lift: 0 4px 12px rgba(0,0,0,0.35), 0 12px 32px rgba(0,0,0,0.3);
  --spring: cubic-bezier(.34,1.56,.64,1);
  --ease-out: cubic-bezier(.22,1,.36,1);
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; scroll-behavior: auto !important; }
}

html, body { background: var(--bg); color: var(--text); font-family: 'Inter', system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
body { font-size: 15px; line-height: 1.5; }

/* Atmospheric background — soft accent glow up top + subtle grain, fixed so it doesn't scroll */
body::before {
  content: ""; position: fixed; inset: 0; z-index: -2; pointer-events: none;
  background:
    radial-gradient(900px 500px at 50% -8%, rgba(110,231,247,0.10), transparent 60%),
    radial-gradient(700px 600px at 100% 100%, rgba(180,168,232,0.06), transparent 55%);
}
body::after {
  content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none; opacity: 0.4;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E");
  mix-blend-mode: overlay;
}

.app { min-height: 100vh; min-height: 100dvh; max-width: 720px; margin: 0 auto; padding: 0 18px 96px; padding-bottom: calc(96px + env(safe-area-inset-bottom)); }

/* Top */
.topbar { padding: 22px 0 14px; }
.brand {
  font-family: 'DM Serif Display', serif; font-size: 1.7rem; font-weight: 400; letter-spacing: -0.5px;
  background: linear-gradient(100deg, var(--text) 30%, var(--accent) 50%, var(--text) 70%);
  background-size: 200% 100%; -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent; color: transparent;
  animation: brandIn .6s var(--ease-out) both, sheen 6s ease-in-out 1s infinite;
}
@keyframes brandIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
@keyframes sheen { 0%, 100% { background-position: 150% 0; } 50% { background-position: -50% 0; } }

/* Tab bar bottom */
.tabbar {
  position: fixed; bottom: 0; left: 0; right: 0;
  background: rgba(10,11,15,0.94); backdrop-filter: blur(24px) saturate(140%); -webkit-backdrop-filter: blur(24px) saturate(140%);
  border-top: 1px solid var(--border);
  display: flex; padding: 8px 6px calc(8px + env(safe-area-inset-bottom)); gap: 1px;
  z-index: 100;
}
.tabbtn {
  flex: 1; min-width: 0; background: transparent; border: none; color: var(--muted);
  display: flex; flex-direction: column; align-items: center; gap: 3px;
  padding: 8px 2px 7px; cursor: pointer; border-radius: 11px;
  transition: color .22s var(--ease-out), background .25s var(--ease-out), transform .12s ease;
  font-family: inherit; position: relative; -webkit-tap-highlight-color: transparent;
  min-height: 52px; justify-content: center;
}
.tabbtn::before {
  content: ""; position: absolute; inset: 0; border-radius: 11px; z-index: -1;
  background: var(--accent-dim);
  opacity: 0; transform: scale(.8); transition: opacity .25s var(--ease-out), transform .35s var(--spring);
}
.tabbtn.active::before { opacity: 1; transform: scale(1); }
.tabbtn:active { transform: scale(.92); }
.tabbtn.active { color: var(--accent); }
.tabbtn.active svg, .tabbtn.active .tabbtn-icon { animation: iconPop .4s var(--spring); }
@keyframes iconPop { 0% { transform: scale(1); } 45% { transform: scale(1.22); } 100% { transform: scale(1); } }
.tabbtn-icon { font-size: 1.15rem; line-height: 1; }
.tabbtn-label { font-size: .62rem; font-weight: 600; letter-spacing: 0; white-space: nowrap; }

.main { animation: fade .3s var(--ease-out); }
@keyframes fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

/* Staggered reveal — each direct child of a .stack rises in sequence */
.stack > * { animation: riseIn .5s var(--ease-out) both; }
.stack > *:nth-child(1) { animation-delay: .02s; }
.stack > *:nth-child(2) { animation-delay: .08s; }
.stack > *:nth-child(3) { animation-delay: .14s; }
.stack > *:nth-child(4) { animation-delay: .20s; }
.stack > *:nth-child(5) { animation-delay: .26s; }
.stack > *:nth-child(6) { animation-delay: .32s; }
.stack > *:nth-child(n+7) { animation-delay: .36s; }
@keyframes riseIn { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }

/* Layout */
.stack { display: flex; flex-direction: column; gap: 14px; }
.row { display: flex; gap: 8px; align-items: center; }
.flex { flex: 1; }
.row-between { display: flex; justify-content: space-between; align-items: center; margin: 10px 0 8px; }

/* Greeting */
.greeting { padding: 4px 2px 6px; }
.greeting-date { color: var(--muted); font-size: .8rem; font-weight: 500; letter-spacing: 0.02em; text-transform: uppercase; }
.greeting-h { font-family: 'DM Serif Display', serif; font-size: 1.85rem; font-weight: 400; margin: 6px 0 4px; line-height: 1.05; letter-spacing: -0.01em; }
.greeting-goal { color: var(--text-2); font-size: .9rem; }

/* Card */
.card {
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px;
  box-shadow: var(--shadow-card); position: relative;
  transition: transform .3s var(--ease-out), box-shadow .3s var(--ease-out), border-color .3s var(--ease-out);
}
.card::before {
  content: ""; position: absolute; inset: 0 0 auto; height: 1px; border-radius: var(--radius) var(--radius) 0 0;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent); pointer-events: none;
}
.card-hd { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 14px; }
.card-title { font-size: .92rem; font-weight: 600; color: var(--text); letter-spacing: -0.005em; }
.card-sub { color: var(--muted); font-size: .8rem; margin-top: 3px; line-height: 1.5; }

/* Rings */
.rings-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.ring { position: relative; display: flex; flex-direction: column; align-items: center; gap: 8px; animation: ringDraw .7s var(--ease-out) both; }
.ring:nth-child(2) { animation-delay: .1s; }
.ring:nth-child(3) { animation-delay: .2s; }
@keyframes ringDraw { from { opacity: 0; transform: scale(.85) rotate(-8deg); } to { opacity: 1; transform: none; } }
.ring svg { display: block; overflow: visible; }
/* soft halo behind each ring */
.ring::before {
  content: ""; position: absolute; top: 2px; left: 50%; transform: translateX(-50%);
  width: 70%; aspect-ratio: 1; border-radius: 50%; z-index: 0;
  background: radial-gradient(circle, rgba(110,231,247,.10) 0%, transparent 70%);
  filter: blur(8px); animation: ringHalo 4s ease-in-out infinite;
}
.ring-svg, .ring-center, .ring-label { position: relative; z-index: 1; }
/* draw the progress arc on mount, then settle */
.ring-progress { animation: ringFill 1.1s cubic-bezier(.34,1.2,.4,1) both; }
@keyframes ringFill { from { stroke-dashoffset: var(--circ); } to { stroke-dashoffset: var(--offset); } }
/* pulsing tip dot */
.ring-dot {
  transform-box: fill-box; transform-origin: center;
  filter: drop-shadow(0 0 4px currentColor);
  animation: ringDotPulse 1.8s ease-in-out infinite, valIn .5s var(--ease-out) .6s both;
}
@keyframes ringDotPulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .6; transform: scale(1.35); } }
@keyframes ringHalo { 0%, 100% { opacity: .55; transform: translateX(-50%) scale(.9); } 50% { opacity: 1; transform: translateX(-50%) scale(1.08); } }
@media (prefers-reduced-motion: reduce) {
  .ring-progress { animation: none; }
  .ring::before, .ring-dot { animation: none; }
}
.ring-center { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding-bottom: 18px; }
.ring-val { font-family: 'DM Serif Display', serif; font-size: 1.05rem; color: var(--text); animation: valIn .6s var(--ease-out) .25s both; }
.ring-val.big { font-size: 1.4rem; }
.ring-unit { font-family: 'Inter', sans-serif; font-size: .65rem; color: var(--muted); margin-left: 2px; font-weight: 500; }
.ring-label { font-size: .68rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; }
@keyframes valIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
.ring-targets { display: flex; justify-content: space-around; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--border); font-size: .72rem; color: var(--muted); }

/* Quick actions */
.quick-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.qa {
  background: var(--surface); border: 1px solid var(--border); border-radius: 13px;
  padding: 15px 14px; display: flex; align-items: center; gap: 11px;
  color: var(--text); font-family: inherit; font-size: .88rem; font-weight: 600; cursor: pointer;
  transition: border-color .2s var(--ease-out), background .2s var(--ease-out), transform .15s var(--spring), box-shadow .2s var(--ease-out);
  min-height: 60px; -webkit-tap-highlight-color: transparent;
}
.qa:hover { border-color: var(--border-strong); transform: translateY(-2px); box-shadow: var(--shadow-card); }
.qa:active { transform: translateY(0) scale(.96); }
.qa.qa-primary { background: var(--accent-dim); border-color: rgba(110,231,247,0.25); color: var(--accent); }
.qa.qa-primary:hover { box-shadow: 0 6px 20px var(--accent-dim); border-color: var(--accent-glow); }
.qa-icon { font-size: 1.2rem; transition: transform .3s var(--spring); }
.qa:hover .qa-icon { transform: scale(1.18) rotate(-6deg); }

.quick-water { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 14px; }
.quick-water .qa { flex-direction: column; gap: 4px; text-align: center; padding: 14px 8px; min-height: 66px; line-height: 1.2; }
.quick-water .qa span { color: var(--muted); font-size: .7rem; font-weight: 500; }

/* Today items */
.today-items { display: flex; flex-direction: column; gap: 8px; }
.today-item { display: flex; align-items: center; gap: 10px; font-size: .87rem; padding: 6px 0; animation: slideRight .45s var(--ease-out) both; }
.today-item:nth-child(2) { animation-delay: .05s; }
.today-item:nth-child(3) { animation-delay: .1s; }
.today-item:nth-child(4) { animation-delay: .15s; }
.today-item:nth-child(5) { animation-delay: .2s; }
@keyframes slideRight { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: none; } }
.today-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; animation: dotPulse 2.4s ease-in-out infinite; }
@keyframes dotPulse { 0%, 100% { box-shadow: 0 0 0 0 transparent; } 50% { box-shadow: 0 0 0 3px rgba(255,255,255,0.04); } }
.today-text { color: var(--text-2); }


/* Insight */
.insight { font-size: .9rem; line-height: 1.6; color: var(--text); }

/* Workout logger parsed-preview scrollbar */
.wl-scroll::-webkit-scrollbar { width: 8px; }
.wl-scroll::-webkit-scrollbar-thumb { background: #262d38; border-radius: 999px; }

/* Streak card flame flicker */
@keyframes flame-flick { 0%,100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-1.5px) scale(1.06); } }

/* Progression card sheet animations */
@keyframes pc-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes pc-rise { from { transform: translateY(18px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

/* Sub-tabs */
.subtabs {
  display: flex; gap: 4px; background: var(--surface); padding: 5px;
  border: 1px solid var(--border); border-radius: 13px;
  overflow-x: auto; scrollbar-width: none; scroll-snap-type: x proximity;
  -webkit-overflow-scrolling: touch;
}
.subtabs::-webkit-scrollbar { display: none; }
.subtab {
  flex: 1; padding: 9px 12px; background: transparent; border: none; color: var(--muted);
  font-family: inherit; font-size: .8rem; font-weight: 600; cursor: pointer; border-radius: 9px;
  white-space: nowrap; display: flex; align-items: center; justify-content: center; gap: 5px;
  transition: color .2s var(--ease-out), background .25s var(--ease-out), transform .12s ease; min-width: 58px;
  -webkit-tap-highlight-color: transparent; scroll-snap-align: center;
}
.subtab.active { background: var(--accent-dim); color: var(--accent); box-shadow: inset 0 0 0 1px rgba(110,231,247,0.2); }
.subtab:active { transform: scale(.94); }
.subtab:hover:not(.active) { color: var(--text-2); }
.subtab-icon { font-size: .9rem; }

/* Second-level sub-tabs — subordinate to the parent tab row */
.subtabs-nested { padding: 3px; border-radius: 11px; border-bottom: 1px solid var(--border); }
.subtabs-nested .subtab { padding: 6px 10px; font-size: .78rem; min-width: 48px; }

/* New-exercise categorization popup */
.nex-overlay { position: fixed; inset: 0; z-index: 1000; background: rgba(6,8,12,0.66); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; padding: 20px; }
.nex-modal { width: 100%; max-width: 380px; background: var(--surface); border: 1px solid var(--border-strong); border-radius: 18px; padding: 20px; box-shadow: 0 24px 60px rgba(0,0,0,0.5); }
.nex-kicker { font-size: .7rem; text-transform: uppercase; letter-spacing: .06em; color: var(--accent); font-weight: 700; }
.nex-q { font-size: 1.05rem; font-weight: 700; margin-top: 4px; }
.nex-name { font-size: .92rem; color: var(--text-2); margin: 6px 0 16px; padding: 8px 12px; background: var(--surface-2); border-radius: 10px; border: 1px solid var(--border); }
.nex-lbl { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; font-size: .72rem; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
.nex-actions { display: flex; align-items: center; gap: 10px; margin-top: 4px; }

/* Progression card — read-only overload verdicts */
.prog-list { display: flex; flex-direction: column; gap: 10px; }
.prog-group { border: 1px solid var(--border); border-radius: 11px; overflow: hidden; }
.prog-group-head { display: flex; align-items: center; gap: 8px; width: 100%; padding: 9px 12px; background: var(--surface-2); border: none; color: var(--text); font-family: inherit; font-size: .84rem; font-weight: 600; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.prog-group-name { flex: 1; text-align: left; }
.prog-group-sum { display: flex; align-items: center; gap: 6px; font-size: .78rem; }
.prog-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--bad); display: inline-block; }
.prog-chev { font-size: .7rem; }
.prog-colhead, .prog-row-head { display: flex; align-items: center; gap: 8px; padding: 4px 12px; }
.prog-colhead { font-size: .66rem; text-transform: uppercase; letter-spacing: .05em; padding-top: 8px; }
.prog-row { padding-top: 4px; padding-bottom: 6px; border-top: 1px solid var(--border); }
.prog-row:first-of-type { border-top: none; }
.prog-name { flex: 1; font-size: .84rem; font-weight: 600; min-width: 0; }
.prog-streak { font-size: .72rem; color: var(--text-2); font-weight: 700; }
.prog-cells { display: flex; gap: 5px; }
.prog-cell { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: .74rem; min-width: 34px; text-align: center; padding: 2px 4px; border-radius: 6px; color: var(--muted); }
.prog-cell.lit { font-weight: 700; }
.prog-cell-d { font-size: .64rem; margin-left: 1px; opacity: .85; }
.prog-evidence { font-size: .72rem; padding: 0 12px 2px; font-family: ui-monospace, "SF Mono", Menlo, monospace; line-height: 1.45; }
.prog-note { opacity: .8; font-family: inherit; }

/* Forms */
.field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
.field-grid.three { grid-template-columns: 1fr 1fr 1fr; }
@media (max-width: 480px) { .field-grid:not(.three) { grid-template-columns: 1fr; } }
label { display: flex; flex-direction: column; gap: 6px; font-size: .72rem; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
input, select, textarea {
  background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px;
  color: var(--text); font-family: inherit; font-size: .92rem; padding: 12px 13px; min-height: 46px;
  outline: none; transition: border-color .2s var(--ease-out), box-shadow .2s var(--ease-out); width: 100%;
}
input:focus, select:focus, textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-dim); }
textarea { resize: vertical; min-height: 72px; line-height: 1.5; }
select option { background: var(--surface-2); }

.duration-pill { display: inline-flex; gap: 4px; background: var(--accent-dim); border: 1px solid rgba(110,231,247,0.2); color: var(--accent); padding: 4px 12px; border-radius: 16px; font-size: .82rem; margin-bottom: 12px; font-weight: 500; }
.duration-pill span { font-weight: 600; }

.lbl { font-size: .82rem; color: var(--text); font-weight: 500; }

/* Buttons */
.btn {
  background: var(--accent); color: #0a1418; border: none; border-radius: 12px; padding: 13px 18px;
  font-family: inherit; font-size: .9rem; font-weight: 600; cursor: pointer; min-height: 46px;
  transition: transform .14s var(--spring), box-shadow .2s var(--ease-out), opacity .15s;
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  position: relative; overflow: hidden; -webkit-tap-highlight-color: transparent;
}
.btn::after {
  content: ""; position: absolute; top: 0; left: -120%; width: 60%; height: 100%;
  background: linear-gradient(100deg, transparent, rgba(255,255,255,0.4), transparent);
  transform: skewX(-20deg); transition: left .6s var(--ease-out);
}
.btn:hover:not(:disabled) { box-shadow: 0 4px 16px var(--accent-glow); transform: translateY(-1px); }
.btn:hover:not(:disabled)::after { left: 140%; }
.btn:active:not(:disabled) { transform: translateY(0) scale(.97); }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn.full { width: 100%; }
.btn-ghost { background: transparent; border: 1px solid var(--border-strong); color: var(--text); border-radius: 12px; padding: 12px 18px; min-height: 46px; font-family: inherit; font-size: .87rem; font-weight: 500; cursor: pointer; transition: background .2s var(--ease-out), transform .14s var(--spring), border-color .2s; display: inline-flex; align-items: center; justify-content: center; gap: 8px; -webkit-tap-highlight-color: transparent; }
.btn-ghost:hover:not(:disabled) { background: var(--surface-2); border-color: var(--accent-glow); }
.btn-ghost:active:not(:disabled) { transform: scale(.97); }
.btn-ghost:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-ghost.full { width: 100%; }
.btn-danger { background: rgba(244,126,110,0.1); border: 1px solid rgba(244,126,110,0.3); color: var(--bad); border-radius: 12px; padding: 13px 18px; min-height: 46px; font-family: inherit; font-size: .88rem; font-weight: 600; cursor: pointer; transition: background .15s; }
.btn-danger:hover { background: rgba(244,126,110,0.18); }
.btn-danger.full { width: 100%; }
.link-btn { background: transparent; border: none; color: var(--accent); font-family: inherit; font-size: .8rem; font-weight: 600; cursor: pointer; padding: 6px 8px; border-radius: 8px; -webkit-tap-highlight-color: transparent; }
.link-btn:hover:not(:disabled) { text-decoration: underline; }
.link-btn:active:not(:disabled) { background: var(--accent-dim); }
.link-btn:disabled { opacity: .4; cursor: not-allowed; }

/* Segmented control */
.seg { display: flex; background: var(--surface-2); border: 1px solid var(--border); border-radius: 11px; padding: 4px; margin-bottom: 12px; gap: 2px; }
.seg-btn { flex: 1; background: transparent; border: none; color: var(--muted); font-family: inherit; font-size: .82rem; font-weight: 600; padding: 9px 10px; border-radius: 8px; cursor: pointer; min-height: 40px; transition: color .2s, background .2s var(--ease-out), transform .12s ease; -webkit-tap-highlight-color: transparent; }
.seg-btn.active { background: var(--bg); color: var(--text); box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
.seg-btn:active { transform: scale(.96); }

/* Upload */
.upload {
  border: 2px dashed var(--border-strong); border-radius: 10px; min-height: 140px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
  cursor: pointer; color: var(--muted); margin-bottom: 12px; overflow: hidden;
  transition: border-color .25s var(--ease-out), background .25s, transform .15s var(--spring);
}
.upload:hover { border-color: var(--accent); background: var(--accent-dim); transform: scale(1.01); }
.upload:hover .upload-icon { animation: bob 1.2s ease-in-out infinite; }
@keyframes bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
.upload-icon { font-size: 2rem; }
.upload-img { width: 100%; max-height: 220px; object-fit: cover; }

/* AI cards */
.ai-card {
  background: var(--accent-dim); border: 1px solid rgba(110,231,247,0.2); border-radius: 12px; padding: 16px; margin-top: 4px;
  position: relative; animation: aiReveal .5s var(--ease-out) both;
}
.ai-card::before {
  content: ""; position: absolute; inset: -1px; border-radius: 12px; padding: 1px; pointer-events: none;
  background: linear-gradient(120deg, var(--accent), transparent 40%, transparent 60%, var(--accent));
  background-size: 300% 100%; -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude; opacity: .5; animation: sheen 4s linear infinite;
}
@keyframes aiReveal { from { opacity: 0; transform: translateY(10px) scale(.98); } to { opacity: 1; transform: none; } }
.ai-card-label { font-size: .68rem; font-weight: 600; color: var(--accent); letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 6px; }
.ai-card-name { font-size: .95rem; font-weight: 500; margin-bottom: 12px; }
.conf-badge { font-size: .62rem; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; padding: 2px 7px; border-radius: 8px; margin-left: 8px; }
.conf-high { background: rgba(143,217,137,0.15); color: var(--good); }
.conf-medium { background: rgba(249,201,126,0.15); color: var(--warn); }
.conf-low { background: rgba(244,126,110,0.15); color: var(--bad); }
.web-toggle { display: flex; align-items: flex-start; gap: 10px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; padding: 12px; margin-bottom: 10px; cursor: pointer; text-transform: none; letter-spacing: normal; }
.web-toggle input { width: 18px; height: 18px; margin-top: 1px; flex-shrink: 0; accent-color: var(--accent); cursor: pointer; }
.web-toggle-text { display: flex; flex-direction: column; gap: 2px; }
.web-toggle-title { font-size: .85rem; font-weight: 500; color: var(--text); }
.web-toggle-sub { font-size: .72rem; color: var(--muted); line-height: 1.4; }
.model-opts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.model-opt { text-align: left; background: var(--surface-2); border: 1px solid var(--border); border-radius: 12px; padding: 14px; cursor: pointer; font-family: inherit; transition: border-color .15s, background .15s, transform .12s ease; -webkit-tap-highlight-color: transparent; }
.model-opt:active { transform: scale(.97); }
.model-opt.active { border-color: var(--accent); background: var(--accent-dim); }
.model-opt-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 5px; }
.model-opt-name { font-size: .95rem; font-weight: 600; color: var(--text); }
.model-opt-check { color: var(--accent); font-weight: 700; }
.model-opt-desc { font-size: .73rem; color: var(--muted); line-height: 1.45; }
@media (max-width: 380px) { .model-opts { grid-template-columns: 1fr; } }
.ai-card-big { font-family: 'DM Serif Display', serif; font-size: 2.4rem; color: var(--accent); line-height: 1; margin-bottom: 6px; }
.ai-card-big span { font-family: 'Inter', sans-serif; font-size: .9rem; color: var(--muted); font-weight: 500; }
.ai-card-note { font-size: .82rem; color: var(--text-2); line-height: 1.55; margin-bottom: 12px; }

.macros { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 12px; }
.macro { background: var(--surface); border-radius: 8px; padding: 9px 6px; text-align: center; border: 1px solid var(--border); animation: macroPop .4s var(--spring) both; }
.macro:nth-child(2) { animation-delay: .06s; }
.macro:nth-child(3) { animation-delay: .12s; }
.macro:nth-child(4) { animation-delay: .18s; }
@keyframes macroPop { from { opacity: 0; transform: scale(.8); } to { opacity: 1; transform: none; } }
.macro-v { display: block; font-size: .95rem; font-weight: 600; color: var(--text); }
.macro-l { display: block; font-size: .62rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; margin-top: 2px; }

/* Spinner */
.spinner { display: inline-block; width: 13px; height: 13px; border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: spin .7s linear infinite; flex-shrink: 0; }
.spinner.inline { width: 12px; height: 12px; }
@keyframes spin { to { transform: rotate(360deg); } }
.loading-row { display: flex; align-items: center; gap: 10px; color: var(--accent); font-size: .85rem; }

/* Errors */
.err { padding: 10px 14px; background: rgba(244,126,110,0.08); border: 1px solid rgba(244,126,110,0.25); color: var(--bad); border-radius: 8px; font-size: .82rem; margin-top: 10px; }

/* Empty */
.empty { text-align: center; padding: 24px 12px; }
.empty-icon { font-size: 1.6rem; color: var(--muted); margin-bottom: 8px; opacity: 0.5; display: inline-block; animation: breathe 3s ease-in-out infinite; }
@keyframes breathe { 0%, 100% { transform: scale(1); opacity: .4; } 50% { transform: scale(1.08); opacity: .6; } }
.empty-title { color: var(--text-2); font-size: .92rem; font-weight: 500; }
.empty-hint { color: var(--muted); font-size: .8rem; margin-top: 4px; line-height: 1.5; }

/* History list */
.hist-list { display: flex; flex-direction: column; gap: 4px; }
.hist { background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; transition: border-color .2s, transform .15s var(--ease-out); }
.hist:hover { border-color: var(--border-strong); }
.hist.open { border-color: var(--border-strong); }
.hist-head { display: flex; justify-content: space-between; align-items: center; padding: 13px 14px; gap: 10px; cursor: pointer; min-height: 54px; -webkit-tap-highlight-color: transparent; }
.hist-l { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
.hist-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.hist-text { min-width: 0; flex: 1; }
.hist-main { font-size: .87rem; font-weight: 500; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hist-date { font-size: .72rem; color: var(--muted); margin-top: 2px; }
.hist-tags { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.hist-tag { font-size: .7rem; color: var(--muted); background: var(--surface); border: 1px solid var(--border); padding: 2px 8px; border-radius: 8px; white-space: nowrap; }
.hist-detail { padding: 0 12px 12px; font-size: .85rem; color: var(--text-2); line-height: 1.5; border-top: 1px solid var(--border); padding-top: 10px; }
.raw-text { font-family: ui-monospace, monospace; font-size: .78rem; white-space: pre-wrap; word-break: break-word; line-height: 1.6; background: var(--bg); padding: 12px; border-radius: 8px; }

/* List rows (water log etc) */
.list { display: flex; flex-direction: column; gap: 4px; }
.list-row { display: flex; align-items: center; gap: 12px; padding: 9px 12px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; }
.list-main { flex: 1; font-size: .87rem; }
.x { background: transparent; border: none; color: var(--muted); cursor: pointer; font-size: 1.3rem; line-height: 1; padding: 4px 6px; border-radius: 4px; transition: color .15s; }
.x:hover { color: var(--bad); background: rgba(244,126,110,0.08); }

/* Inline form */
.inline-form { display: flex; gap: 8px; align-items: center; margin-top: 12px; }
.inline-form input { flex: 1; }

/* Trends */
.trend-stats { display: flex; gap: 18px; margin-bottom: 10px; }
.ts { display: flex; flex-direction: column; gap: 2px; }
.ts-l { font-size: .68rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
.ts-v { font-size: .98rem; font-weight: 600; color: var(--text); }
.ts-v.good { color: var(--good); }
.ts-v.warn { color: var(--warn); }
.ts-v.neutral { color: var(--text-2); }
.ts-v.muted { color: var(--muted); }
.chart { width: 100%; height: 70px; display: block; }
.muted-center { color: var(--muted); font-size: .82rem; text-align: center; padding: 18px; font-style: italic; }

.bars-row { display: grid; grid-auto-columns: 1fr; grid-auto-flow: column; gap: 3px; height: 56px; align-items: end; }
.bar-col { height: 100%; display: flex; align-items: flex-end; }
.bar-fill { width: 100%; min-height: 3px; background: var(--accent); border-radius: 2px; transition: height .6s ease; }

/* Week mini */
.week { display: grid; grid-template-columns: repeat(7, 1fr); gap: 5px; align-items: end; }
.week-col { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.week-bar-wrap { width: 100%; height: 64px; background: var(--surface-2); border-radius: 4px; display: flex; align-items: flex-end; overflow: hidden; }
.week-bar { width: 100%; border-radius: 3px; min-height: 3px; transition: height .6s; transform-origin: bottom; animation: growUp .6s var(--ease-out) both; }
@keyframes growUp { from { transform: scaleY(0); } to { transform: scaleY(1); } }
.week-day { font-size: .68rem; color: var(--muted); font-weight: 500; }
.week-val { font-size: .64rem; color: var(--text-2); }

.center-stack { display: flex; justify-content: center; padding: 8px 0 16px; }

/* Biological-day tag */
.bioday-tag { display: inline-flex; align-items: center; gap: 5px; font-size: .66rem; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--accent); background: var(--accent-dim); border: 1px solid rgba(110,231,247,.2); padding: 3px 9px; border-radius: 999px; margin-bottom: 12px; }

/* Biological-day indicator banner (Log Meal) */
.bioday-banner { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: 10px; background: var(--accent-dim); border: 1px solid rgba(110,231,247,.18); margin-bottom: 14px; }
.bioday-banner-title { font-size: .82rem; font-weight: 600; color: var(--accent); }
.bioday-banner-sub { font-size: .72rem; color: var(--muted); font-variant-numeric: tabular-nums; }
.bioday-banner.muted-banner { background: var(--surface-2); border-color: var(--border); }
.bioday-banner.muted-banner { font-size: .76rem; color: var(--muted); }

/* Guided "when did you eat?" */
.when-block { margin: 4px 0 14px; }
.when-label, .backfill-q { font-size: .78rem; font-weight: 600; color: var(--text-2); margin-bottom: 8px; }
.when-chips { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 10px; }
.when-chip { font-size: .8rem; padding: 8px 13px; border-radius: 999px; background: var(--surface-2); color: var(--text); border: 1px solid var(--border-strong); cursor: pointer; font-family: inherit; transition: background .18s, border-color .18s, transform .12s var(--spring); -webkit-tap-highlight-color: transparent; }
.when-chip:active { transform: scale(.94); }
.when-chip.active { background: var(--accent-dim); color: var(--accent); border-color: var(--accent); }
.coach-affect { display: flex; align-items: center; gap: 7px; font-size: .76rem; color: var(--muted); margin-top: 4px; }
.coach-affect input { width: auto; }

/* ─── MEAL LOGGER REDESIGN (variant 3d — semicircle gauge + battery macros) ─── */
.meal-redesign { --acc:#6ee7f7; --ink:#ebedf2; --t2:#b5b9c4; --mut:#6b7180; --line:rgba(255,255,255,.06); --line2:rgba(255,255,255,.1); --surface:#14161c; --surface2:#1a1d25; --accdim:rgba(110,231,247,.12); }
/* hero */
.meal-redesign .semi { padding: 8px 4px 4px; text-align: center; }
.meal-redesign .gauge-h { font-size: 12px; font-weight: 600; color: var(--mut); letter-spacing: .08em; text-transform: uppercase; display: inline-flex; align-items: center; gap: 7px; justify-content: center; }
.meal-redesign .gauge-h i { width: 7px; height: 7px; border-radius: 50%; background: var(--acc); }
.meal-redesign .swrap { position: relative; width: 232px; max-width: 100%; margin: 6px auto 0; }
.meal-redesign .swrap svg { display: block; width: 232px; max-width: 100%; height: 132px; overflow: visible; }
.meal-redesign .sc { position: absolute; left: 0; right: 0; bottom: 6px; }
.meal-redesign .sc b { font-family: 'DM Serif Display', serif; font-size: 44px; line-height: .85; display: block; color: var(--ink); }
.meal-redesign .sc span { font-size: 11px; color: var(--mut); text-transform: uppercase; letter-spacing: .08em; }
.meal-redesign .ends { display: flex; justify-content: space-between; font-size: 10px; color: var(--mut); font-weight: 600; letter-spacing: .04em; max-width: 232px; margin: 0 auto; padding: 0 6px; }
.meal-redesign .batt { display: flex; gap: 10px; margin: 18px 0 0; }
.meal-redesign .cell { flex: 1; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 13px 10px; display: flex; flex-direction: column; align-items: center; }
.meal-redesign .cell .vt { height: 64px; width: 16px; border-radius: 8px; background: var(--surface2); border: 1px solid var(--line); position: relative; overflow: hidden; margin-bottom: 10px; }
.meal-redesign .cell .vt i { position: absolute; left: 0; right: 0; bottom: 0; border-radius: 8px; transition: height .6s cubic-bezier(.22,1,.36,1); }
.meal-redesign .cell b { font-family: 'DM Serif Display', serif; font-size: 18px; line-height: 1; color: var(--ink); }
.meal-redesign .cell b small { font-family: 'Inter'; font-size: 9px; color: var(--mut); }
.meal-redesign .cell span { font-size: 9.5px; color: var(--mut); text-transform: uppercase; letter-spacing: .04em; margin-top: 3px; }
/* sheet */
.meal-redesign .sheet { background: var(--surface); border: 1px solid var(--line2); border-radius: 16px; padding: 18px; position: relative; overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,.3), 0 6px 16px rgba(0,0,0,.25); }
.meal-redesign .sheet::before { content: ""; position: absolute; inset: 0 0 auto 0; height: 3px; background: linear-gradient(90deg,#f9c97e,#f47e6e,#b4a8e8); }
.meal-redesign .sheet-h { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.meal-redesign .sheet-h b { font-size: 16px; font-weight: 600; color: var(--ink); }
.meal-redesign .bio { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; color: var(--acc); background: var(--accdim); border: 1px solid rgba(110,231,247,.18); padding: 5px 10px; border-radius: 99px; }
.meal-redesign .row2 { display: flex; gap: 9px; margin-bottom: 13px; }
.meal-redesign .fld { flex: 1; background: var(--surface2); border: 1px solid var(--line); border-radius: 10px; padding: 9px 12px; min-width: 0; }
.meal-redesign .fld > span { font-size: 10px; color: var(--mut); text-transform: uppercase; letter-spacing: .05em; font-weight: 600; display: block; }
.meal-redesign .fld select, .meal-redesign .fld input { background: transparent; border: none; outline: none; color: var(--ink); font-family: inherit; font-size: 14px; font-weight: 600; padding: 3px 0 0; min-height: 0; width: 100%; cursor: pointer; -webkit-appearance: none; appearance: none; }
.meal-redesign .fld input[type="time"], .meal-redesign .fld input[type="date"] { cursor: text; }
.meal-redesign .fld input::-webkit-calendar-picker-indicator { filter: invert(.7); }
.meal-redesign .compose { background: var(--surface2); border: 1px solid var(--line); border-radius: 12px; padding: 14px; }
.meal-redesign .compose textarea { background: transparent; border: none; outline: none; width: 100%; color: var(--ink); font-family: inherit; font-size: 16px; line-height: 1.5; min-height: 48px; resize: vertical; padding: 0; }
.meal-redesign .compose textarea::placeholder { color: var(--mut); }
.meal-redesign .modes { display: flex; gap: 4px; margin-top: 12px; background: var(--bg); border: 1px solid var(--line); border-radius: 11px; padding: 4px; }
.meal-redesign .mode { flex: 1; text-align: center; font-size: 12px; font-weight: 600; padding: 9px; border-radius: 8px; background: transparent; color: var(--mut); border: none; font-family: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; transition: background .2s, color .2s; }
.meal-redesign .mode.on { background: var(--surface2); color: var(--ink); box-shadow: 0 1px 3px rgba(0,0,0,.3); }
.meal-redesign .web { display: flex; align-items: center; gap: 9px; margin-top: 12px; font-size: 12px; color: var(--t2); cursor: pointer; text-transform: none; letter-spacing: normal; font-weight: 500; }
.meal-redesign .web .sw { width: 34px; height: 20px; border-radius: 99px; background: var(--surface2); border: 1px solid var(--line); position: relative; flex: none; transition: background .2s; }
.meal-redesign .web .sw i { position: absolute; width: 14px; height: 14px; border-radius: 50%; background: var(--mut); top: 2px; left: 3px; transition: left .2s, background .2s; }
.meal-redesign .web .sw.on { background: var(--acc); }
.meal-redesign .web .sw.on i { left: 17px; background: #0a1418; }
.meal-redesign .analyze { margin-top: 14px; width: 100%; font-size: 15px; font-weight: 600; color: #0a1418; background: var(--acc); border-radius: 12px; padding: 15px; border: none; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 4px 16px rgba(110,231,247,.25); cursor: pointer; font-family: inherit; transition: transform .14s var(--spring), box-shadow .2s; }
.meal-redesign .analyze:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(110,231,247,.35); }
.meal-redesign .analyze:active:not(:disabled) { transform: scale(.98); }
.meal-redesign .analyze:disabled { opacity: .45; cursor: not-allowed; }
.meal-redesign .coach-affect { margin-top: 11px; }
.meal-redesign .bc-start { margin-top: 4px; }
/* editable multi-item result card */
.meal-redesign .ai-card .item-name-top { width: 100%; background: var(--surface2); border: 1px solid var(--line); border-radius: 10px; color: var(--ink); font-family: inherit; font-size: 15px; font-weight: 600; padding: 10px 12px; margin-bottom: 12px; outline: none; }
.meal-redesign .ai-card .item-name-top:focus { border-color: var(--acc); }
.meal-redesign .item-head, .meal-redesign .item-row { display: grid; grid-template-columns: 1fr 46px 36px 36px 36px 24px; gap: 6px; align-items: center; }
.meal-redesign .item-head { font-size: 9px; text-transform: uppercase; letter-spacing: .04em; color: var(--mut); padding: 0 2px 5px; }
.meal-redesign .item-head span:not(:first-child) { text-align: center; }
.meal-redesign .item-row { margin-bottom: 6px; }
.meal-redesign .item-row input { background: var(--surface2); border: 1px solid var(--line); border-radius: 8px; color: var(--ink); font-family: inherit; font-size: 13px; padding: 8px; min-height: 0; outline: none; width: 100%; }
.meal-redesign .item-row input:focus { border-color: var(--acc); }
.meal-redesign .item-row .it-num { text-align: center; padding: 8px 4px; }
.meal-redesign .item-row .it-del { background: transparent; border: none; color: var(--mut); font-size: 14px; line-height: 1; cursor: pointer; padding: 4px; }
.meal-redesign .item-row .it-del:active { color: #f47e6e; }
.meal-redesign .add-item { margin: 4px 0 2px; width: 100%; background: transparent; border: 1px dashed var(--line2); color: var(--acc); border-radius: 10px; padding: 9px; font-size: 12.5px; font-weight: 600; cursor: pointer; font-family: inherit; -webkit-tap-highlight-color: transparent; }
.meal-redesign .add-item:active { transform: scale(.99); }

/* Per-item grounding meta (DB vs estimate, grams, FDC match) */
.meal-redesign .item-wrap { margin-bottom: 6px; }
.meal-redesign .item-wrap .item-row { margin-bottom: 0; }
.meal-redesign .it-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 3px 2px 2px; }
.meal-redesign .it-src { font-size: 9px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; padding: 1px 6px; border-radius: 6px; }
.meal-redesign .it-src.db { background: rgba(143,217,137,0.16); color: #8fd989; }
.meal-redesign .it-src.est { background: rgba(249,201,126,0.16); color: #f9c97e; }
.meal-redesign .it-g { font-size: 10px; color: var(--mut); font-weight: 600; }
.meal-redesign .it-hidden { font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: #f47e6e; }
.meal-redesign .it-match { font-size: 10px; color: var(--mut); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 55%; }

/* Accuracy strip (calorie range, USDA grounding, verify) + flag hint */
.meal-redesign .acc-strip { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.meal-redesign .acc-chip { font-size: 10.5px; font-weight: 600; padding: 3px 9px; border-radius: 8px; background: var(--surface2); border: 1px solid var(--line); color: var(--ink); }
.meal-redesign .acc-fdc { color: #8fd989; }
.meal-redesign .acc-ver { color: var(--acc); }
.meal-redesign .acc-flag { margin-top: 8px; font-size: 12px; line-height: 1.45; color: #f9c97e; background: rgba(249,201,126,0.08); border: 1px solid rgba(249,201,126,0.25); border-radius: 10px; padding: 8px 10px; }

/* Settings toggle row */
.toggle-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; cursor: pointer; }
.toggle-text { flex: 1; min-width: 0; }
.toggle-title { font-size: .9rem; font-weight: 600; color: var(--text); }
.toggle-sub { font-size: .76rem; color: var(--muted); line-height: 1.45; margin-top: 2px; }
.toggle-row input[type="checkbox"] { width: 20px; height: 20px; flex: 0 0 auto; accent-color: var(--accent); }

/* Smart-backfill prompt */
.backfill-card { background: var(--surface-2); border: 1px solid var(--border); border-radius: 12px; padding: 12px 13px; margin-bottom: 12px; }
.backfill-card.subtle { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.backfill-card.subtle .backfill-q { margin-bottom: 0; font-weight: 500; color: var(--muted); }

/* Correlation / patterns list */
.corr-list { display: flex; flex-direction: column; gap: 12px; }
.corr-row { padding: 10px 12px; border-radius: 10px; background: rgba(255,255,255,.025); border: 1px solid rgba(255,255,255,.05); }
.corr-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.corr-tag { font-size: .72rem; font-weight: 600; padding: 2px 8px; border-radius: 999px; letter-spacing: .02em; }
.corr-tag.pos { color: var(--good); background: rgba(143,217,137,.12); }
.corr-tag.neg { color: var(--warn); background: rgba(249,201,126,.12); }
.corr-meta { font-variant-numeric: tabular-nums; }

/* Markdown */
.md > *:first-child { margin-top: 0; }
.md > *:last-child { margin-bottom: 0; }
.md-p { line-height: 1.55; margin: 6px 0 0; font-size: .87rem; }
.md-h1 { font-family: 'DM Serif Display', serif; font-size: 1rem; color: var(--text); margin: 12px 0 4px; font-weight: 400; }
.md-h2 { font-family: 'DM Serif Display', serif; font-size: .9rem; color: var(--text); margin: 10px 0 4px; font-weight: 400; }
.md-ul, .md-ol { margin: 6px 0; padding-left: 18px; font-size: .87rem; }
.md-ul li, .md-ol li { margin: 3px 0; line-height: 1.5; }
.md-ul { list-style: none; padding-left: 0; }
.md-ul li { position: relative; padding-left: 14px; }
.md-ul li::before { content: "→"; position: absolute; left: 0; color: var(--accent); }
.md-code { background: var(--surface-2); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; font-size: .82em; font-family: ui-monospace, monospace; }

/* Coach */
.coach-wrap { display: flex; flex-direction: column; min-height: calc(100dvh - 200px); }
.coach-bar { display: flex; justify-content: space-between; align-items: center; padding: 0 4px 14px; }
.coach-bar-l { display: flex; flex-direction: column; }
.coach-bar-title { font-size: .92rem; font-weight: 600; }
.coach-bar-r { display: flex; gap: 4px; }
.msgs { display: flex; flex-direction: column; gap: 14px; padding: 4px 2px 12px; min-height: 200px; }
.msg { display: flex; gap: 8px; align-items: flex-start; animation: msgIn .4s var(--ease-out) both; }
.msg.assistant { animation-name: msgInLeft; }
.msg.user { flex-direction: row-reverse; animation-name: msgInRight; }
@keyframes msgInLeft { from { opacity: 0; transform: translate(-12px, 6px); } to { opacity: 1; transform: none; } }
@keyframes msgInRight { from { opacity: 0; transform: translate(12px, 6px); } to { opacity: 1; transform: none; } }
.avatar { width: 26px; height: 26px; border-radius: 8px; background: var(--accent-dim); border: 1px solid rgba(110,231,247,0.25); display: flex; align-items: center; justify-content: center; font-size: .72rem; color: var(--accent); flex-shrink: 0; margin-top: 2px; }
.bubble { max-width: 84%; background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 11px 15px; line-height: 1.5; }
.msg.user .bubble { background: var(--accent-dim); border-color: rgba(110,231,247,0.2); border-radius: 16px 16px 5px 16px; }
.msg.assistant .bubble { border-radius: 5px 16px 16px 16px; }
.bubble.typing { display: flex; gap: 4px; padding: 14px; }
.bubble.typing span { width: 6px; height: 6px; background: var(--muted); border-radius: 50%; animation: bounce .9s infinite; }
.bubble.typing span:nth-child(2) { animation-delay: .15s; }
.bubble.typing span:nth-child(3) { animation-delay: .3s; }
@keyframes bounce { 0%, 60%, 100% { transform: translateY(0); } 30% { transform: translateY(-5px); } }

.suggs { display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 2px 12px; }
.sugg { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 6px 12px; color: var(--text-2); font-family: inherit; font-size: .78rem; cursor: pointer; transition: color .2s, border-color .2s, transform .14s var(--spring); -webkit-tap-highlight-color: transparent; }
.sugg:hover { color: var(--accent); border-color: rgba(110,231,247,0.3); transform: translateY(-2px); }
.sugg:active { transform: scale(.95); }

.composer { display: flex; gap: 8px; padding: 12px 2px 8px; position: sticky; bottom: calc(80px + env(safe-area-inset-bottom)); background: var(--bg); margin-top: auto; align-items: flex-end; }
.composer::before { content: ""; position: absolute; left: 0; right: 0; top: -16px; height: 16px; background: linear-gradient(transparent, var(--bg)); pointer-events: none; }
.composer input { flex: 1; border-radius: 12px; }
.send { width: 46px; height: 46px; min-width: 46px; border-radius: 13px; background: var(--accent); color: #0a1418; border: none; font-size: 1.2rem; font-weight: 700; cursor: pointer; flex-shrink: 0; display: flex; align-items: center; justify-content: center; transition: transform .14s var(--spring), box-shadow .2s; -webkit-tap-highlight-color: transparent; }
.send:hover:not(:disabled) { box-shadow: 0 4px 14px var(--accent-glow); transform: translateY(-1px); }
.send:active:not(:disabled) { transform: scale(.88); }
.send:disabled { opacity: 0.35; cursor: not-allowed; }

/* Analysis */
.analysis-stack { animation: fade .2s ease; }
.score-row { display: flex; align-items: center; gap: 16px; }
.score-ring { position: relative; width: 80px; height: 80px; flex-shrink: 0; animation: ringDraw .7s var(--ease-out) both; }
.score-ring svg { width: 80px; height: 80px; }
.score-ring svg circle:last-child { filter: drop-shadow(0 0 4px var(--accent-glow)); }
.score-n { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-family: 'DM Serif Display', serif; font-size: 1.5rem; }
.score-n span { font-family: 'Inter', sans-serif; font-size: .62rem; color: var(--muted); margin-left: 2px; }

.priority-card { background: var(--accent-dim); border-color: rgba(110,231,247,0.2); animation: priorityGlow 3.5s ease-in-out infinite; }
@keyframes priorityGlow { 0%, 100% { box-shadow: var(--shadow-card); } 50% { box-shadow: var(--shadow-card), 0 0 24px var(--accent-dim); } }
.priority-label { font-size: .68rem; font-weight: 600; color: var(--accent); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px; }
.priority-text { font-size: .92rem; line-height: 1.55; color: var(--text); font-weight: 500; }

.ana-hd { display: flex; justify-content: space-between; align-items: center; }
.ana-score { display: flex; align-items: center; gap: 7px; font-size: .85rem; font-weight: 600; }
.ana-dot { width: 7px; height: 7px; border-radius: 50%; }
.ana-tips { list-style: none; padding: 0; margin: 12px 0 0; display: flex; flex-direction: column; gap: 7px; }
.ana-tips li { display: flex; gap: 9px; font-size: .85rem; color: var(--text); line-height: 1.5; animation: slideRight .45s var(--ease-out) both; }
.ana-tips li:nth-child(2) { animation-delay: .08s; }
.ana-tips li:nth-child(3) { animation-delay: .16s; }
.ana-arrow { color: var(--accent); font-weight: 700; flex-shrink: 0; }

/* Settings macros bar */
.macro-bar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; gap: 2px; background: var(--surface-2); margin: 10px 0 8px; }
.macro-seg { height: 100%; transition: width .4s; }
.legend { display: flex; flex-wrap: wrap; gap: 12px; font-size: .73rem; color: var(--text-2); }
.dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 5px; }
.divider { height: 1px; background: var(--border); margin: 16px 0; }

/* Export grid */
.exp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 8px; }
.exp-card { background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; padding: 14px 8px; display: flex; flex-direction: column; align-items: center; gap: 4px; cursor: pointer; transition: border-color .2s, transform .15s var(--spring), box-shadow .2s; color: var(--text); font-family: inherit; -webkit-tap-highlight-color: transparent; }
.exp-card:hover:not(:disabled) { border-color: var(--accent); transform: translateY(-3px); box-shadow: var(--shadow-card); }
.exp-card:active:not(:disabled) { transform: translateY(0) scale(.96); }
.exp-card:disabled { opacity: 0.4; cursor: not-allowed; }
.exp-icon { font-size: 1.4rem; color: var(--accent); margin-bottom: 2px; transition: transform .3s var(--spring); }
.exp-card:hover:not(:disabled) .exp-icon { transform: scale(1.2); }
.exp-name { font-size: .82rem; font-weight: 500; }
.exp-n { font-size: .65rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }

/* Stats */
.stat-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.stat { text-align: center; padding: 14px 8px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; }
.stat-n { font-family: 'DM Serif Display', serif; font-size: 1.6rem; color: var(--accent); line-height: 1; margin-bottom: 4px; }
.stat-l { font-size: .68rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }

.danger-card { border-color: rgba(244,126,110,0.2); }
.muted-tag { font-size: .72rem; color: var(--good); }

/* Helpers */
.muted { color: var(--muted); }
.small { font-size: .76rem; }
.center { text-align: center; }

/* Tab icons */
.tabbtn-icon { line-height: 0; }
.tabbtn svg { display: block; }

/* Rings zero-state */
.rings-zero { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--border); font-size: .82rem; color: var(--muted); text-align: center; line-height: 1.5; }

/* Recent-after (under log forms) */
.recent-after { margin-top: 4px; }
.recent-after-label { font-size: .68rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; padding: 0 4px 6px; }
.recent-after-list { display: flex; flex-direction: column; gap: 4px; }
.recent-after-item { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 9px 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; font-size: .82rem; }
.ra-main { color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ra-date { color: var(--muted); font-size: .72rem; white-space: nowrap; flex-shrink: 0; }

/* Toast */
.toast-host { position: fixed; left: 0; right: 0; bottom: calc(96px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; align-items: center; gap: 8px; z-index: 200; pointer-events: none; padding: 0 18px; }
.toast { background: var(--surface-2); border: 1px solid var(--border-strong); color: var(--text); border-radius: 12px; padding: 10px 18px; font-size: .85rem; font-weight: 500; box-shadow: 0 8px 24px rgba(0,0,0,0.4); animation: toastIn .25s cubic-bezier(.2,.8,.2,1); max-width: 100%; }
@keyframes toastIn { from { opacity: 0; transform: translateY(12px) scale(.96); } to { opacity: 1; transform: none; } }

/* Modal */
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; padding: 24px; z-index: 300; animation: fade .15s ease; }
.modal { background: var(--surface); border: 1px solid var(--border-strong); border-radius: 16px; padding: 22px; max-width: 360px; width: 100%; animation: modalIn .2s cubic-bezier(.2,.8,.2,1); }
@keyframes modalIn { from { opacity: 0; transform: scale(.94); } to { opacity: 1; transform: none; } }
.modal-title { font-family: 'DM Serif Display', serif; font-size: 1.2rem; font-weight: 400; margin-bottom: 8px; }
.modal-body { color: var(--text-2); font-size: .88rem; line-height: 1.55; margin-bottom: 18px; }
.modal-actions { display: flex; gap: 8px; }

/* ── Sleep score card ── */
.ss-ring-wrap { position: relative; width: 150px; height: 150px; margin: 4px auto 6px; }
.ss-ring-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.ss-score { font-size: 44px; font-weight: 800; line-height: 1; letter-spacing: -0.02em; }
.ss-band { font-size: .9rem; font-weight: 600; margin-top: 3px; }
.ss-stats { display: flex; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); margin: 8px 0 14px; }
.ss-stat { flex: 1; text-align: center; padding: 12px 4px; }
.ss-stat + .ss-stat { border-left: 1px solid var(--border); }
.ss-stat-v { font-size: 1.15rem; font-weight: 700; }
.ss-stat-l { font-size: .72rem; color: var(--muted); margin-top: 2px; }
.ss-shaped-h { font-size: .7rem; letter-spacing: .08em; color: var(--muted); font-weight: 600; margin-bottom: 10px; }
.ss-contribs { display: flex; flex-direction: column; gap: 12px; }
.ss-contrib-top { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 5px; }
.ss-contrib-name { font-weight: 600; font-size: .92rem; }
.ss-contrib-val { font-size: .82rem; color: var(--muted); }
.ss-bar { height: 7px; border-radius: 999px; background: var(--surface-2); overflow: hidden; }
.ss-bar i { display: block; height: 100%; border-radius: 999px; transition: width .6s cubic-bezier(.22,1,.36,1); }
.ss-insight { margin-top: 16px; background: rgba(110,231,247,0.08); border: 1px solid var(--accent-dim); border-radius: 12px; padding: 12px 14px; }
.ss-insight-h { color: var(--accent); font-weight: 700; font-size: .92rem; margin-bottom: 4px; }
.ss-insight-t { font-size: .86rem; line-height: 1.5; color: var(--text-2); }
.ss-recent-toggle { display: flex; align-items: center; justify-content: space-between; width: 100%; background: none; border: 0; color: inherit; font-family: inherit; font-size: .95rem; font-weight: 600; cursor: pointer; padding: 2px 0; -webkit-tap-highlight-color: transparent; }

/* ── Creatine saturation card ── */
.creat-status { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 18px; }
.creat-tick { display: inline-flex; align-items: center; gap: 9px; }
.creat-tick-box { width: 22px; height: 22px; border-radius: 7px; border: 1.5px solid var(--border-strong); display: inline-flex; align-items: center; justify-content: center; font-size: .82rem; font-weight: 800; color: var(--bg); background: var(--surface-2); transition: background .2s, border-color .2s, box-shadow .2s; }
.creat-tick-box.on { background: var(--accent); border-color: var(--accent); box-shadow: 0 0 0 4px var(--accent-dim); }
.creat-tick-l { font-size: .84rem; font-weight: 600; color: var(--text); }
.creat-ring-wrap { display: inline-flex; align-items: center; gap: 11px; }
.creat-ring-txt { display: flex; flex-direction: column; align-items: flex-end; line-height: 1.25; }
.creat-ring-l { font-size: .84rem; font-weight: 600; color: var(--text); }
.creat-ring-sub { font-size: .68rem; color: var(--muted); }
.creat-ring { position: relative; display: inline-flex; align-items: center; justify-content: center; }
.creat-ring-v { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 1.05rem; font-weight: 800; letter-spacing: -0.02em; color: var(--text); }
.creat-chart-row { display: flex; align-items: stretch; gap: 4px; }
.creat-nav { flex: 0 0 auto; width: 30px; background: transparent; border: 0; color: var(--muted); font-size: 1.3rem; line-height: 1; cursor: pointer; border-radius: 10px; -webkit-tap-highlight-color: transparent; transition: background .2s, color .2s, opacity .2s; }
.creat-nav:hover:not(:disabled) { background: var(--surface-2); color: var(--text); }
.creat-nav:disabled { opacity: .25; cursor: default; }
.creat-bars { flex: 1 1 auto; display: flex; align-items: flex-end; gap: 4px; height: 168px; }
.creat-col { flex: 1 1 0; display: flex; flex-direction: column; align-items: center; gap: 7px; height: 100%; background: none; border: 0; padding: 6px 2px; font-family: inherit; cursor: pointer; border-radius: 12px; -webkit-tap-highlight-color: transparent; transition: background .18s; }
.creat-col:hover:not(:disabled) { background: var(--surface-2); }
.creat-col:disabled { cursor: default; }
.creat-col.today { background: var(--accent-dim); }
.creat-col-v { font-size: .74rem; font-weight: 700; color: var(--text-2); height: 1em; letter-spacing: -.01em; }
.creat-track { flex: 1 1 auto; width: 60%; max-width: 30px; display: flex; align-items: flex-end; justify-content: center; }
.creat-fill { width: 100%; min-height: 5px; border-radius: 7px 7px 4px 4px; background: linear-gradient(180deg, var(--warn), #e9a94e); box-shadow: 0 1px 0 rgba(0,0,0,.15) inset; transition: height .45s var(--ease-out); }
.creat-fill.empty { background: var(--surface-2); box-shadow: none; border: 1px solid var(--border); }
.creat-col.today .creat-track .creat-fill:not(.empty) { background: linear-gradient(180deg, #ffd88a, var(--warn)); }
.creat-wd { font-size: .72rem; color: var(--muted); font-weight: 600; }
.creat-col.today .creat-wd { color: var(--accent); }
.creat-range { margin-top: 10px; font-size: .72rem; color: var(--muted); text-align: center; }
.creat-edit { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 14px; padding: 11px 13px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 12px; }
.creat-edit label { font-size: .8rem; font-weight: 600; color: var(--text-2); }
.creat-edit input { width: 66px; padding: 6px 8px; text-align: center; border-radius: 8px; min-height: 0; }
.creat-edit-u { font-size: .8rem; color: var(--muted); margin-left: -4px; }
.creat-edit .btn-ghost { padding: 6px 12px; min-height: 0; font-size: .8rem; }
@media (prefers-reduced-motion: reduce) { .creat-fill, .creat-ring circle { transition: none !important; } }

/* Boot spinner */
.boot { min-height: 100vh; min-height: 100dvh; display: flex; align-items: center; justify-content: center; color: var(--accent); }

/* Auth screen */
.auth { min-height: 100vh; min-height: 100dvh; display: flex; align-items: center; justify-content: center; padding: 24px; }
.auth-box { width: 100%; max-width: 360px; animation: authIn .6s var(--ease-out) both; }
@keyframes authIn { from { opacity: 0; transform: translateY(16px) scale(.98); } to { opacity: 1; transform: none; } }
.auth-brand { font-family: 'DM Serif Display', serif; font-size: 2.4rem; color: var(--text); text-align: center; font-weight: 400; }
.auth-sub { text-align: center; color: var(--muted); margin: 4px 0 24px; font-size: .9rem; }
.auth-box label { margin-bottom: 12px; }
.auth-switch { text-align: center; margin-top: 16px; font-size: .85rem; color: var(--muted); }
.auth-switch .link-btn { font-size: .85rem; margin-left: 4px; }

/* Sync badge */
.sync-badge { display: inline-flex; align-items: center; gap: 6px; font-size: .72rem; color: var(--muted); margin-left: 12px; }
.topbar { display: flex; align-items: center; }

/* Account */
.account-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.account-email { font-size: .9rem; font-weight: 500; color: var(--text); margin-bottom: 3px; }

/* ─── Coach images ─── */
.bubble-img { display: block; max-width: 220px; width: 100%; border-radius: 10px; margin-bottom: 8px; }
.bubble-img-gone { font-size: .8rem; color: var(--muted); background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 6px 10px; margin-bottom: 8px; display: inline-block; }
.composer-wrap { position: sticky; bottom: calc(80px + env(safe-area-inset-bottom)); background: var(--bg); padding-top: 10px; margin-top: auto; }
.composer-wrap::before { content: ""; position: absolute; left: 0; right: 0; top: -16px; height: 16px; background: linear-gradient(transparent, var(--bg)); pointer-events: none; }
.attach-preview { display: flex; align-items: center; gap: 10px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 8px; margin-bottom: 8px; position: relative; animation: riseIn .3s var(--ease-out) both; }
.attach-preview img { width: 48px; height: 48px; object-fit: cover; border-radius: 8px; }
.attach-label { font-size: .82rem; color: var(--text-2); }
.attach-x { margin-left: auto; background: var(--surface-2); border: none; color: var(--text); width: 26px; height: 26px; border-radius: 50%; cursor: pointer; font-size: 1rem; line-height: 1; flex-shrink: 0; }
.attach-btn { width: 46px; height: 46px; min-width: 46px; border-radius: 13px; background: var(--surface-2); border: 1px solid var(--border); cursor: pointer; font-size: 1.15rem; flex-shrink: 0; display: flex; align-items: center; justify-content: center; transition: transform .12s ease, background .15s; -webkit-tap-highlight-color: transparent; }
.attach-btn:active { transform: scale(.9); }
.attach-btn:disabled { opacity: .4; }

/* ─── Diet photo choices ─── */
.photo-choices { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
.photo-choice { background: var(--surface-2); border: 1px solid var(--border); border-radius: 12px; padding: 22px 12px; display: flex; flex-direction: column; align-items: center; gap: 8px; cursor: pointer; color: var(--text); font-family: inherit; font-size: .85rem; font-weight: 500; transition: transform .12s ease, border-color .15s, background .15s; -webkit-tap-highlight-color: transparent; }
.photo-choice:hover { border-color: var(--accent); background: var(--accent-dim); }
.photo-choice:active { transform: scale(.96); }
.photo-choice-icon { font-size: 1.8rem; }
.upload.has-img { position: relative; padding: 0; min-height: 0; }
.upload-replace { position: absolute; bottom: 8px; right: 8px; background: rgba(0,0,0,0.6); color: #fff; font-size: .72rem; padding: 4px 10px; border-radius: 12px; backdrop-filter: blur(4px); }

/* ─── Streak chip ─── */
.greeting-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.streak-chip { font-size: .78rem; font-weight: 600; color: var(--warn); background: rgba(249,201,126,0.12); border: 1px solid rgba(249,201,126,0.25); padding: 3px 10px; border-radius: 14px; animation: streakPop .5s var(--spring) both; }
@keyframes streakPop { 0% { opacity: 0; transform: scale(.6); } 60% { transform: scale(1.12); } 100% { opacity: 1; transform: scale(1); } }

/* ─── Day progress bar ─── */
.day-progress { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--border); }
.day-progress-bar { height: 6px; background: var(--track); border-radius: 3px; overflow: hidden; }
.day-progress-fill { height: 100%; border-radius: 3px; background: linear-gradient(90deg, var(--accent), #8fd989); transition: width 1s var(--ease-out); box-shadow: 0 0 10px var(--accent-glow); }
.day-progress-label { display: block; text-align: center; font-size: .78rem; color: var(--text-2); margin-top: 8px; }

/* ─── Mobile friendliness ─── */
@media (max-width: 520px) {
  .app { padding: 0 14px 96px; padding-bottom: calc(96px + env(safe-area-inset-bottom)); }
  .topbar { padding: 18px 0 12px; }
  .brand { font-size: 1.55rem; }
  .greeting-h { font-size: 1.62rem; }
  .greeting { padding: 2px 2px 4px; }
  .stack { gap: 12px; }
  .rings-row { gap: 2px; }
  .ring-val.big { font-size: 1.15rem; }
  .ring svg { width: 104px; height: 104px; }
  .quick-actions { grid-template-columns: 1fr 1fr; }
  .ring-targets { font-size: .66rem; flex-wrap: wrap; gap: 4px; }
  .card { padding: 16px; border-radius: 16px; }
  .field-grid, .field-grid.three { grid-template-columns: 1fr 1fr; }
  .macros { grid-template-columns: repeat(2, 1fr); }
  .bubble { max-width: 88%; }
  .subtab { font-size: .77rem; padding: 9px 10px; min-width: 52px; }
  .tabbtn-label { font-size: .63rem; }
}
@media (max-width: 360px) {
  .field-grid, .field-grid.three { grid-template-columns: 1fr; }
  .quick-actions { grid-template-columns: 1fr; }
  .brand { font-size: 1.45rem; }
  .greeting-h { font-size: 1.5rem; }
}
/* Larger tap targets + no tap highlight on interactive things */
button, .qa, .subtab, .seg-btn, .exp-card, .photo-choice, .tabbtn { -webkit-tap-highlight-color: transparent; }
input, select, textarea { font-size: 16px; } /* prevents iOS zoom-on-focus */
@media (min-width: 521px) { input, select, textarea { font-size: .92rem; } }

/* ─── Macro donut ─── */
.donut { position: relative; flex-shrink: 0; }
.donut-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.donut-center span { font-family: 'DM Serif Display', serif; font-size: 1.1rem; line-height: 1; }
.donut-center small { font-size: .58rem; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
.result-with-donut { display: flex; align-items: center; gap: 16px; margin-bottom: 12px; }
.macros-compact { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; flex: 1; margin-bottom: 0; }

/* ─── Running total ─── */
.running-total { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px; }
.rt-row { display: flex; justify-content: space-between; gap: 8px; }
.rt-item { display: flex; flex-direction: column; gap: 2px; align-items: center; flex: 1; }
.rt-v { font-family: 'DM Serif Display', serif; font-size: 1.35rem; line-height: 1; color: var(--text); }
.rt-v.rt-over { color: var(--bad); }
.rt-sub { font-family: 'Inter', sans-serif; font-size: .62rem; color: var(--muted); font-weight: 500; }
.rt-l { font-size: .64rem; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; font-weight: 600; }
.rt-bar { height: 5px; background: var(--track); border-radius: 3px; overflow: hidden; margin: 12px 0 8px; }
.rt-bar-fill { height: 100%; background: linear-gradient(90deg, var(--accent), #8fd989); border-radius: 3px; transition: width .6s var(--ease-out); }
.rt-hint { text-align: center; font-size: .74rem; color: var(--text-2); }

/* ─── Workout parse preview ─── */
.parse-preview { background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; padding: 12px; margin: 4px 0 12px; }
.parse-head { display: flex; justify-content: space-between; font-size: .76rem; color: var(--text-2); margin-bottom: 8px; flex-wrap: wrap; gap: 4px; }
.parse-vol { color: var(--accent); font-weight: 500; }
.parse-list { display: flex; flex-direction: column; gap: 5px; }
.parse-ex { display: flex; justify-content: space-between; gap: 8px; font-size: .82rem; }
.parse-ex-name { color: var(--text); font-weight: 500; }
.parse-ex-detail { color: var(--muted); flex-shrink: 0; }

/* ─── Plan tab ─── */
.weekgrid-label { font-size: .73rem; color: var(--muted); font-weight: 500; text-transform: uppercase; letter-spacing: .04em; margin: 14px 0 8px; }
.weekgrid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }
.weekday { aspect-ratio: 1; border-radius: 10px; border: 1px solid var(--border); background: var(--surface-2); color: var(--muted); font-family: inherit; font-size: .76rem; font-weight: 600; cursor: pointer; transition: transform .12s ease, background .15s, color .15s, border-color .15s; -webkit-tap-highlight-color: transparent; }
.weekday:active { transform: scale(.9); }
.weekday.on { background: var(--accent-dim); color: var(--accent); border-color: rgba(110,231,247,0.4); }
.weekday.today { box-shadow: 0 0 0 2px var(--accent-glow); }
.week-outline { display: flex; flex-direction: column; gap: 6px; }
.wo-day { display: flex; align-items: center; gap: 12px; padding: 10px 12px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; }
.wo-day.today { border-color: rgba(110,231,247,0.4); }
.wo-day-name { width: 64px; flex-shrink: 0; font-size: .82rem; font-weight: 600; color: var(--text); display: flex; flex-direction: column; gap: 2px; }
.wo-today-tag { font-size: .6rem; color: var(--accent); font-weight: 500; text-transform: uppercase; }
.wo-input { flex: 1; background: var(--bg); border: 1px solid var(--border); border-radius: 7px; padding: 8px 10px; font-size: .85rem; }
.wo-rest { flex: 1; font-size: .82rem; color: var(--muted); font-style: italic; }
.rec-result { animation: riseIn .3s var(--ease-out) both; }
.rec-badge { display: inline-block; padding: 6px 14px; border-radius: 16px; border: 1px solid; font-size: .85rem; font-weight: 600; margin-bottom: 10px; }
.rec-reason { font-size: .88rem; line-height: 1.55; color: var(--text); margin-bottom: 8px; }
.rec-tip { font-size: .82rem; color: var(--text-2); line-height: 1.5; background: var(--surface-2); border-radius: 8px; padding: 8px 10px; }

/* Recovery band (rule-based verdict) */
.rec-band { display: flex; align-items: center; gap: 13px; padding: 15px; border-radius: 14px; border: 1px solid var(--border); background: var(--surface-2); }
.rec-band-dot { width: 14px; height: 14px; border-radius: 50%; flex-shrink: 0; }
.rec-band-label { font-size: 1.05rem; font-weight: 700; color: var(--text); }
.rec-band-ctx { font-size: .76rem; color: var(--muted); margin-top: 2px; }
.rec-band-go { border-color: rgba(143,217,137,0.3); background: rgba(143,217,137,0.07); }
.rec-band-caution { border-color: rgba(249,201,126,0.3); background: rgba(249,201,126,0.07); }
.rec-band-rest { border-color: rgba(244,126,110,0.35); background: rgba(244,126,110,0.08); }
.rec-reconcile { font-size: .84rem; line-height: 1.5; color: var(--text-2); background: var(--surface-2); border-radius: 10px; padding: 10px 12px; margin-top: 12px; }
.rec-sleep-timing { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.rec-st-item { display: flex; align-items: center; gap: 7px; font-size: .8rem; color: var(--text-2); background: var(--surface-2); border-radius: 9px; padding: 8px 11px; }
.rec-st-item strong { color: var(--text); }
.rec-st-icon { font-size: .9rem; }
.rec-reasons { margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
.rec-reason-row { display: flex; gap: 9px; font-size: .85rem; line-height: 1.45; color: var(--text); }
.rec-reason-mark { flex-shrink: 0; font-size: .7rem; margin-top: 3px; }
.rec-reason-row.neg .rec-reason-mark { color: var(--bad); }
.rec-reason-row.pos .rec-reason-mark { color: var(--good); }
.rec-reason-row.pos { color: var(--text-2); }
.rec-ai { margin-top: 14px; padding: 12px 14px; border-radius: 12px; background: var(--accent-dim); border: 1px solid rgba(110,231,247,0.2); animation: fadeIn .25s var(--ease-out); }
.rec-ai-h { font-size: .76rem; font-weight: 700; color: var(--accent); text-transform: uppercase; letter-spacing: .04em; margin-bottom: 6px; }
.rec-ai-reason { font-size: .87rem; line-height: 1.55; color: var(--text); margin: 0 0 8px; }
.rec-ai-tip { font-size: .83rem; color: var(--text-2); line-height: 1.5; margin: 0 0 8px; }

/* Build / week-view day "why" + flags */
.build-day.has-why { cursor: pointer; flex-wrap: wrap; }
.build-day-why-chev { margin-left: auto; color: var(--muted); font-size: .72rem; }
.build-day-why { flex-basis: 100%; font-size: .8rem; line-height: 1.5; color: var(--text-2); margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border); }
.build-alt { font-size: .84rem; line-height: 1.55; color: var(--text); background: rgba(249,201,126,0.08); border: 1px solid rgba(249,201,126,0.25); border-radius: 10px; padding: 10px 12px; margin-top: 12px; }
.build-alt strong { color: #f9c97e; }
.week-flag { font-size: .83rem; line-height: 1.5; color: #f9c97e; background: rgba(249,201,126,0.08); border: 1px solid rgba(249,201,126,0.22); border-radius: 10px; padding: 10px 12px; margin-bottom: 12px; }

/* ─── Achievements ─── */
.ach-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(76px, 1fr)); gap: 8px; }
.ach { display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 12px 6px; border-radius: 10px; border: 1px solid var(--border); text-align: center; transition: transform .15s; }
.ach.got { background: var(--accent-dim); border-color: rgba(110,231,247,0.25); }
.ach.got:hover { transform: translateY(-2px); }
.ach.locked { background: var(--surface-2); opacity: .45; filter: grayscale(1); }
.ach-icon { font-size: 1.5rem; line-height: 1; }
.ach-title { font-size: .64rem; color: var(--text-2); font-weight: 500; line-height: 1.2; }

/* ─── Chart tooltip + legend ─── */
.chart-wrap { position: relative; }
.chart-tip { position: absolute; top: -4px; transform: translateX(-50%); background: var(--surface-2); border: 1px solid var(--border-strong); border-radius: 8px; padding: 4px 9px; display: flex; flex-direction: column; align-items: center; pointer-events: none; z-index: 5; white-space: nowrap; animation: fade .12s ease; }
.chart-tip-v { font-size: .8rem; font-weight: 600; color: var(--accent); }
.chart-tip-d { font-size: .64rem; color: var(--muted); }
.chart-legend { display: flex; align-items: center; gap: 6px; font-size: .68rem; color: var(--muted); margin-top: 6px; justify-content: flex-end; }
.cl-line { display: inline-block; width: 14px; height: 0; border-top: 2px solid var(--accent); }
.cl-line.dash { border-top: 2px dashed #f9c97e; }

/* ─── Heatmap ─── */
.heatmap { display: flex; gap: 3px; overflow-x: auto; padding-bottom: 4px; scrollbar-width: none; }
.heatmap::-webkit-scrollbar { display: none; }
.hm-col { display: flex; flex-direction: column; gap: 3px; }
.hm-cell { width: 14px; height: 14px; border-radius: 3px; background: var(--surface-2); flex-shrink: 0; }
.hm-cell.hm--1 { background: transparent; }
.hm-cell.hm-0 { background: rgba(255,255,255,0.04); }
.hm-cell.hm-1 { background: rgba(110,231,247,0.25); }
.hm-cell.hm-2 { background: rgba(110,231,247,0.45); }
.hm-cell.hm-3 { background: rgba(110,231,247,0.7); }
.hm-cell.hm-4 { background: var(--accent); }
.hm-legend { display: flex; align-items: center; gap: 4px; justify-content: flex-end; margin-top: 10px; font-size: .68rem; color: var(--muted); }

/* ─── Onboarding ─── */
.ob { min-height: 100vh; min-height: 100dvh; display: flex; align-items: center; justify-content: center; padding: 24px; }
.ob-box { width: 100%; max-width: 380px; }
.ob-progress { display: flex; gap: 6px; justify-content: center; margin-bottom: 24px; }
.ob-dot { width: 28px; height: 4px; border-radius: 2px; background: var(--surface-2); transition: background .3s; }
.ob-dot.on { background: var(--accent); }
.ob-step { animation: riseIn .35s var(--ease-out) both; }
.ob-logo { font-family: 'DM Serif Display', serif; font-size: 2.6rem; text-align: center; background: linear-gradient(100deg, var(--text) 30%, var(--accent)); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 8px; }
.ob-h { font-family: 'DM Serif Display', serif; font-size: 1.6rem; font-weight: 400; text-align: center; margin-bottom: 10px; }
.ob-p { color: var(--text-2); text-align: center; font-size: .9rem; line-height: 1.55; margin-bottom: 22px; }
.ob-choices { display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; }
.ob-choice { padding: 14px; border-radius: 12px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font-family: inherit; font-size: .92rem; font-weight: 500; cursor: pointer; transition: transform .12s ease, background .15s, border-color .15s; -webkit-tap-highlight-color: transparent; }
.ob-choice:active { transform: scale(.97); }
.ob-choice.on { background: var(--accent-dim); border-color: var(--accent); color: var(--accent); }
.ob-cal { display: flex; align-items: center; justify-content: center; gap: 18px; margin-bottom: 14px; }
.ob-cal-val { font-family: 'DM Serif Display', serif; font-size: 2.4rem; min-width: 130px; text-align: center; }
.ob-cal-val span { font-family: 'Inter', sans-serif; font-size: .9rem; color: var(--muted); margin-left: 4px; }
.ob-step-btn { width: 48px; height: 48px; border-radius: 50%; border: 1px solid var(--border-strong); background: var(--surface-2); color: var(--text); font-size: 1.5rem; cursor: pointer; -webkit-tap-highlight-color: transparent; transition: transform .12s ease; }
.ob-step-btn:active { transform: scale(.88); }
.ob-macros { text-align: center; font-size: .8rem; color: var(--muted); margin-bottom: 22px; }
.ob-back { display: block; margin: 14px auto 0; }

@media (max-width: 520px) {
  .result-with-donut { gap: 12px; }
  .hm-cell { width: 12px; height: 12px; }
}

/* ─── History detail extras ─── */
.diet-detail { display: flex; align-items: center; gap: 16px; }
.diet-detail-macros { font-size: .82rem; line-height: 1.7; }
.pr-banner { background: rgba(249,201,126,0.12); border: 1px solid rgba(249,201,126,0.3); color: var(--warn); border-radius: 8px; padding: 8px 10px; font-size: .8rem; font-weight: 500; margin-bottom: 10px; }
.ex-detail-list { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
.ex-detail-row { display: flex; justify-content: space-between; gap: 8px; font-size: .82rem; }

/* ─── AI plan builder ─── */
.prompt-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.prompt-chip { background: var(--surface-2); border: 1px solid var(--border); border-radius: 14px; padding: 6px 11px; color: var(--text-2); font-family: inherit; font-size: .74rem; cursor: pointer; transition: color .15s, border-color .15s; text-align: left; -webkit-tap-highlight-color: transparent; }
.prompt-chip:hover { color: var(--accent); border-color: rgba(110,231,247,0.3); }
.build-result { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--border); animation: riseIn .35s var(--ease-out) both; }
.build-split-tag { display: inline-block; background: var(--accent-dim); border: 1px solid rgba(110,231,247,0.3); color: var(--accent); font-size: .76rem; font-weight: 600; padding: 4px 12px; border-radius: 14px; margin-bottom: 12px; }
.build-week { display: flex; flex-direction: column; gap: 5px; }
.build-day { display: flex; align-items: center; gap: 12px; padding: 9px 12px; border-radius: 9px; background: var(--surface-2); border: 1px solid var(--border); }
.build-day.on { background: var(--accent-dim); border-color: rgba(110,231,247,0.25); }
.build-day-name { width: 42px; font-size: .8rem; font-weight: 600; color: var(--text); flex-shrink: 0; }
.build-day-w { font-size: .85rem; color: var(--text-2); }
.build-day.on .build-day-w { color: var(--text); font-weight: 500; }
.build-summary { font-size: .86rem; line-height: 1.55; color: var(--text); margin-top: 12px; }
.build-tips { margin: 10px 0 0; padding-left: 18px; }
.build-tips li { font-size: .82rem; color: var(--text-2); line-height: 1.5; margin: 4px 0; }

/* ─── Coach view segmented ─── */
.coach-seg { margin-bottom: 14px; }

/* ─── Physique check ─── */
.phys-img { width: 100%; max-height: 360px; object-fit: contain; border-radius: 12px; background: var(--surface-2); margin-bottom: 6px; }
.phys-result { animation: riseIn .35s var(--ease-out) both; }
.phys-summary { font-size: .92rem; line-height: 1.55; color: var(--text); margin-bottom: 14px; padding-bottom: 14px; border-bottom: 1px solid var(--border); }
.phys-section { margin-bottom: 14px; }
.phys-section:last-child { margin-bottom: 0; }
.phys-section-h { font-size: .76rem; font-weight: 600; color: var(--accent); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 6px; }
.phys-list { margin: 0; padding-left: 0; list-style: none; }
.phys-list li { position: relative; padding-left: 14px; margin: 5px 0; font-size: .86rem; line-height: 1.55; color: var(--text); }
.phys-list li::before { content: "→"; position: absolute; left: 0; color: var(--accent); font-weight: 700; }
.phys-p { font-size: .86rem; line-height: 1.55; color: var(--text); }

/* ─── Sound settings ─── */
.sound-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.sound-info { display: flex; flex-direction: column; gap: 2px; }
.sound-state { font-size: .95rem; font-weight: 600; color: var(--text); }
.toggle-switch { width: 52px; height: 30px; border-radius: 15px; background: var(--surface-2); border: 1px solid var(--border); position: relative; cursor: pointer; flex-shrink: 0; transition: background .2s, border-color .2s; -webkit-tap-highlight-color: transparent; padding: 0; }
.toggle-switch.on { background: var(--accent-dim); border-color: var(--accent); }
.toggle-knob { position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%; background: var(--muted); transition: transform .2s var(--spring), background .2s; }
.toggle-switch.on .toggle-knob { transform: translateX(22px); background: var(--accent); }
.sound-samples { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.sample-btn { background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; padding: 8px 14px; color: var(--text-2); font-family: inherit; font-size: .82rem; font-weight: 500; cursor: pointer; transition: transform .12s ease, border-color .15s, color .15s; -webkit-tap-highlight-color: transparent; }
.sample-btn:hover { color: var(--accent); border-color: rgba(110,231,247,0.3); }
.sample-btn:active { transform: scale(.93); }

/* ─── Barcode scanner ─── */
.seg-three .seg-btn { font-size: .82rem; padding: 9px 6px; }
.bc-start { padding: 8px 0; }
.scan-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 100; display: flex; align-items: center; justify-content: center; padding: 20px; backdrop-filter: blur(6px); }
.scan-modal { background: var(--surface); border: 1px solid var(--border-strong); border-radius: 18px; width: 100%; max-width: 420px; overflow: hidden; animation: riseIn .3s var(--ease-out) both; }
.scan-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid var(--border); font-weight: 600; }
.scan-x { background: var(--surface-2); border: none; color: var(--text); width: 30px; height: 30px; border-radius: 50%; font-size: 1.3rem; line-height: 1; cursor: pointer; }
.scan-view { position: relative; background: #000; aspect-ratio: 4 / 3; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.scan-video { width: 100%; height: 100%; object-fit: cover; }
.scan-frame { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 72%; height: 42%; border: 2px solid var(--accent); border-radius: 12px; box-shadow: 0 0 0 9999px rgba(0,0,0,0.35); overflow: hidden; }
.scan-line { position: absolute; left: 0; right: 0; height: 2px; background: var(--accent); box-shadow: 0 0 8px var(--accent); animation: scanline 2s ease-in-out infinite; }
@keyframes scanline { 0%, 100% { top: 8%; } 50% { top: 92%; } }
.scan-hint { position: absolute; bottom: 12px; left: 0; right: 0; text-align: center; color: #fff; font-size: .82rem; text-shadow: 0 1px 3px rgba(0,0,0,0.8); }
.scan-fallback { padding: 18px 16px 4px; }
.scan-err { color: var(--bad); font-size: .85rem; line-height: 1.5; margin-bottom: 12px; }
.scan-manual { display: flex; gap: 8px; padding: 0 16px 18px; }
.scan-manual input { flex: 1; }
.bc-portion { margin-bottom: 12px; }
@media (prefers-reduced-motion: reduce) { .scan-line { animation: none; top: 50%; } }

/* ─── Nicotine ─── */
.seg-four .seg-btn { font-size: .78rem; padding: 9px 4px; }
.qa-wide { width: 100%; margin-top: 8px; background: var(--surface); border: 1px solid var(--border); border-radius: 13px; padding: 15px 14px; display: flex; align-items: center; justify-content: center; gap: 11px; color: var(--text); font-family: inherit; font-size: .88rem; font-weight: 600; cursor: pointer; min-height: 56px; transition: border-color .2s, transform .15s var(--spring), box-shadow .2s; -webkit-tap-highlight-color: transparent; }
.qa-wide:hover { border-color: var(--border-strong); transform: translateY(-2px); box-shadow: var(--shadow-card); }
.qa-wide:active { transform: translateY(0) scale(.97); }

.nic-quick { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.nic-quick-btn { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 16px 8px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 13px; color: var(--text); font-family: inherit; font-size: .82rem; font-weight: 600; cursor: pointer; min-height: 78px; justify-content: center; transition: border-color .2s, transform .14s var(--spring), background .2s; -webkit-tap-highlight-color: transparent; }
.nic-quick-btn:hover { border-color: var(--accent-glow); background: var(--surface); }
.nic-quick-btn:active { transform: scale(.95); }
.nic-quick-icon { font-size: 1.5rem; }

.nic-types { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 14px; }

.nic-stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 14px; }
.nic-stat { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 12px 4px; background: var(--surface-2); border-radius: 11px; text-align: center; }
.nic-stat-v { font-family: 'DM Serif Display', serif; font-size: 1.35rem; color: var(--accent); line-height: 1; }
.nic-stat-l { font-size: .62rem; color: var(--muted); text-transform: uppercase; letter-spacing: .03em; line-height: 1.2; }
.nic-mg-row { font-size: .85rem; color: var(--text-2); padding: 10px 12px; background: var(--surface-2); border-radius: 10px; margin-bottom: 12px; }
.nic-mg-row strong { color: var(--text); }
.nic-types-breakdown { display: flex; flex-wrap: wrap; gap: 8px; }
.nic-type-pill { font-size: .8rem; color: var(--text-2); background: var(--surface-2); border: 1px solid var(--border); padding: 5px 11px; border-radius: 9px; }
.nic-trend-wrap { margin-top: 16px; }

/* Timing band readout */
.nic-band { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px; border-radius: 14px; border: 1px solid var(--border); background: var(--surface-2); cursor: pointer; font-family: inherit; text-align: left; transition: transform .12s ease, border-color .2s; -webkit-tap-highlight-color: transparent; }
.nic-band:active { transform: scale(.98); }
.nic-band-main { display: flex; align-items: center; gap: 13px; }
.nic-band-dot { width: 14px; height: 14px; border-radius: 50%; flex-shrink: 0; }
.nic-band-label { font-size: 1rem; font-weight: 700; color: var(--text); }
.nic-band-ctx { font-size: .76rem; color: var(--muted); margin-top: 2px; }
.nic-band-chev { color: var(--muted); font-size: .7rem; }
/* band colors — higher = warm/red, moderate = amber, lower = neutral-green (NOT a celebratory green) */
.nic-band-higher { border-color: rgba(244,126,110,0.35); background: rgba(244,126,110,0.08); }
.nic-band-higher .nic-band-dot { background: var(--bad); box-shadow: 0 0 10px rgba(244,126,110,0.5); }
.nic-band-moderate { border-color: rgba(249,201,126,0.35); background: rgba(249,201,126,0.07); }
.nic-band-moderate .nic-band-dot { background: #f9c97e; box-shadow: 0 0 10px rgba(249,201,126,0.4); }
.nic-band-lower { border-color: var(--border-strong); background: var(--surface-2); }
.nic-band-lower .nic-band-dot { background: var(--muted); }

.nic-band-detail { margin-top: 14px; animation: fadeIn .25s var(--ease-out); }
.nic-band-note { font-size: .86rem; color: var(--text-2); line-height: 1.5; margin: 0 0 14px; }
.nic-reasons { margin-bottom: 14px; }
.nic-reasons-h { font-size: .72rem; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 7px; }
.nic-reasons-h.raising { color: var(--bad); }
.nic-reasons-h.easing { color: var(--text-2); }
.nic-reasons ul { margin: 0; padding-left: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
.nic-reasons li { position: relative; padding-left: 16px; font-size: .85rem; line-height: 1.5; color: var(--text); }
.nic-reasons-h.raising + ul li::before { content: "▲"; position: absolute; left: 0; color: var(--bad); font-size: .6rem; top: 4px; }
.nic-reasons-h.easing + ul li::before { content: "•"; position: absolute; left: 2px; color: var(--muted); }
.nic-band-disclaimer { font-size: .76rem; color: var(--muted); line-height: 1.5; font-style: italic; margin: 14px 0 0; padding-top: 12px; border-top: 1px solid var(--border); }

@media (max-width: 520px) {
  .nic-stat-grid { grid-template-columns: repeat(2, 1fr); }
  .nic-quick { grid-template-columns: 1fr 1fr; }
}

/* ─── Journal (paper-style notebook) ─── */
.journal { display: flex; flex-direction: column; gap: 22px; padding-top: 4px; }
.journal-composer {
  background: linear-gradient(180deg, #faf6ec 0%, #f4eedd 100%);
  border-radius: 16px; padding: 16px; box-shadow: 0 6px 22px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.5);
  position: relative;
}
/* subtle ruled-paper feel via a faint left margin line */
.journal-composer::before { content: ""; position: absolute; left: 30px; top: 12px; bottom: 64px; width: 1px; background: rgba(210,120,110,0.25); }
.journal-input {
  width: 100%; background: transparent; border: none; outline: none; resize: none;
  font-family: 'DM Serif Display', Georgia, serif; font-size: 1.08rem; line-height: 1.65;
  color: #2a2620; padding: 2px 2px 2px 14px; min-height: 84px;
}
.journal-input::placeholder { color: #b3a892; font-style: italic; }
.journal-composer-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 10px; padding-left: 14px; }
.journal-hint { font-size: .72rem; color: #9c9079; }
.journal-save { padding: 10px 18px; min-height: 42px; background: #2a2620; color: #faf6ec; }
.journal-save:hover:not(:disabled) { box-shadow: 0 4px 14px rgba(0,0,0,0.3); }
.journal-save:disabled { opacity: .4; }

.journal-day { display: flex; flex-direction: column; gap: 10px; }
.journal-day-head { font-family: 'DM Serif Display', serif; font-size: 1.05rem; color: var(--text); padding-left: 2px; position: relative; }
.journal-day-head::after { content: ""; display: block; height: 1px; background: var(--border); margin-top: 8px; }

.journal-entry {
  background: linear-gradient(180deg, #faf7f0 0%, #f6f1e6 100%);
  border-radius: 13px; padding: 14px 16px; box-shadow: 0 3px 12px rgba(0,0,0,0.22);
  position: relative;
}
.journal-entry-time { font-size: .7rem; color: #a89c84; font-weight: 600; letter-spacing: .03em; text-transform: uppercase; margin-bottom: 6px; }
.journal-edited { color: #b9ad95; font-weight: 400; text-transform: none; letter-spacing: 0; }
.journal-entry-text { font-family: 'DM Serif Display', Georgia, serif; font-size: 1.02rem; line-height: 1.6; color: #2a2620; margin: 0; white-space: pre-wrap; }
.journal-snapshot { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; padding-top: 11px; border-top: 1px dashed rgba(150,135,110,0.3); }
.journal-snap-pill { display: inline-flex; align-items: center; gap: 5px; font-size: .72rem; color: #6b6354; background: rgba(150,135,110,0.12); padding: 4px 9px; border-radius: 8px; }
.journal-snap-icon { font-size: .8rem; }
.journal-entry-actions { display: flex; gap: 14px; margin-top: 11px; }
.journal-act { background: none; border: none; font-family: inherit; font-size: .76rem; font-weight: 600; color: #9c8f78; cursor: pointer; padding: 2px 0; -webkit-tap-highlight-color: transparent; }
.journal-act:active { opacity: .6; }
.journal-act-del { color: #c17b6e; }
.journal-edit { margin-top: 4px; }
.journal-edit .journal-input { background: rgba(255,255,255,0.4); border-radius: 8px; min-height: 80px; }
.journal-edit-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
.journal-edit-actions .btn, .journal-edit-actions .btn-ghost { padding: 8px 16px; min-height: 38px; }

.journal-empty { text-align: center; padding: 40px 24px; }
.journal-empty-mark { font-size: 2.4rem; color: var(--muted); margin-bottom: 12px; }
.journal-empty-title { font-family: 'DM Serif Display', serif; font-size: 1.2rem; color: var(--text); margin: 0 0 8px; }
.journal-empty-hint { font-size: .88rem; line-height: 1.6; color: var(--text-2); max-width: 420px; margin: 0 auto; }

/* ─── NAVIGATION REDESIGN: 5-tab bar + raised center ＋ ─────────────────────── */
.tabbar-5 { display: flex; align-items: flex-end; justify-content: space-around; }
.tabbar-5 .tabbtn { flex: 1; }
.tab-plus {
  position: relative;
  flex: 0 0 auto;
  width: 50px; height: 50px; min-width: 50px;
  margin: 0 6px; align-self: center; /* inline with the other tab icons */
  border: none; border-radius: 50%;
  background: linear-gradient(135deg, #8af0ff 0%, #6ee7f7 35%, #5cc8df 60%, #b4a8e8 100%);
  background-size: 220% 220%;
  color: #04181d; font-size: 26px; font-weight: 300; line-height: 1;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  box-shadow: 0 6px 18px var(--accent-glow), 0 2px 6px rgba(0,0,0,.4);
  transition: transform .3s var(--spring), box-shadow .25s var(--ease-out);
  animation:
    plusIn .55s var(--spring) both,
    plusGradient 6s ease-in-out 0.6s infinite,
    plusFloat 3.6s ease-in-out 0.6s infinite;
}
/* the glyph sits above the rotating glow ring */
.tab-plus { z-index: 1; }
.tab-plus > * { position: relative; z-index: 2; transition: transform .3s var(--spring); }
/* rotating conic glow ring behind the button */
.tab-plus::before {
  content: ""; position: absolute; inset: -4px; border-radius: 50%; z-index: 0;
  background: conic-gradient(from 0deg, transparent 0deg, rgba(110,231,247,.55) 80deg, rgba(180,168,232,.55) 180deg, transparent 260deg, transparent 360deg);
  filter: blur(5px); opacity: .75;
  animation: plusSpin 4.5s linear infinite;
}
/* soft pulsing halo */
.tab-plus::after {
  content: ""; position: absolute; inset: 0; border-radius: 50%; z-index: 0;
  box-shadow: 0 0 0 0 rgba(110,231,247,.45);
  animation: plusPulse 2.8s ease-out 0.6s infinite;
}
.tab-plus:hover {
  box-shadow: 0 12px 30px var(--accent-glow), 0 2px 10px rgba(0,0,0,.5);
  transform: scale(1.1) translateY(-2px);
}
.tab-plus:hover > * { transform: rotate(90deg) scale(1.05); }
.tab-plus:active { transform: scale(.9); }
.tab-plus:active > * { transform: rotate(180deg) scale(.85); }

@keyframes plusIn { 0% { opacity: 0; transform: scale(0) rotate(-120deg); } 60% { opacity: 1; transform: scale(1.15) rotate(10deg); } 100% { opacity: 1; transform: scale(1) rotate(0); } }
@keyframes plusGradient { 0%, 100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
@keyframes plusFloat { 0%, 100% { box-shadow: 0 6px 18px var(--accent-glow), 0 2px 6px rgba(0,0,0,.4); } 50% { box-shadow: 0 12px 28px var(--accent-glow), 0 2px 6px rgba(0,0,0,.4); } }
@keyframes plusSpin { to { transform: rotate(360deg); } }
@keyframes plusPulse { 0% { box-shadow: 0 0 0 0 rgba(110,231,247,.45); } 70%, 100% { box-shadow: 0 0 0 14px rgba(110,231,247,0); } }

@media (prefers-reduced-motion: reduce) {
  .tab-plus, .tab-plus::before, .tab-plus::after { animation: none; }
  .tab-plus::before, .tab-plus::after { opacity: 0; }
  .tab-plus:hover, .tab-plus:active { transform: scale(1); }
  .tab-plus:hover > *, .tab-plus:active > * { transform: none; }
}

/* ─── WELCOME SPLASH (every entry) ─────────────────────────────────────────── */
.welcome-splash {
  position: fixed; inset: 0; z-index: 400;
  display: flex; align-items: center; justify-content: center;
  background: radial-gradient(120% 90% at 50% 35%, rgba(20,22,28,.96) 0%, rgba(10,11,15,.99) 70%);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  animation: welcomeIn .4s var(--ease-out) both;
  cursor: pointer; overflow: hidden;
}
.welcome-splash::before {
  content: ""; position: absolute; width: 420px; height: 420px; border-radius: 50%;
  background: radial-gradient(circle, rgba(110,231,247,.18) 0%, transparent 65%);
  filter: blur(20px); animation: welcomeGlow 3s ease-in-out infinite;
}
.welcome-splash.leaving { animation: welcomeOut .48s var(--ease-out) forwards; }
.welcome-inner { position: relative; text-align: center; padding: 0 24px; animation: welcomeRise .6s var(--spring) both; }
.welcome-logo {
  font-family: 'DM Serif Display', serif; font-size: 2.6rem; line-height: 1;
  background: linear-gradient(120deg, #8af0ff, #6ee7f7 40%, #b4a8e8);
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
  margin-bottom: 14px; animation: welcomePop .7s var(--spring) both;
}
.welcome-greet { font-size: 1.15rem; font-weight: 600; color: var(--text); margin-bottom: 6px; animation: welcomeRise .6s var(--spring) .12s both; }
.welcome-sub { font-size: .9rem; color: var(--muted); animation: welcomeRise .6s var(--spring) .22s both; }
@keyframes welcomeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes welcomeOut { to { opacity: 0; transform: scale(1.04); } }
@keyframes welcomeRise { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
@keyframes welcomePop { 0% { opacity: 0; transform: scale(.6); } 60% { opacity: 1; transform: scale(1.08); } 100% { transform: scale(1); } }
@keyframes welcomeGlow { 0%, 100% { opacity: .6; transform: scale(.92); } 50% { opacity: 1; transform: scale(1.08); } }
@media (prefers-reduced-motion: reduce) {
  .welcome-splash, .welcome-splash::before, .welcome-inner, .welcome-logo, .welcome-greet, .welcome-sub { animation: none; }
  .welcome-logo { -webkit-text-fill-color: var(--accent); }
}

/* ─── LOG HUB OVERLAY ──────────────────────────────────────────────────────── */
.log-overlay {
  position: fixed; inset: 0; z-index: 200;
  background: var(--bg);
  display: flex; flex-direction: column;
  animation: log-rise .22s cubic-bezier(.4,0,.2,1);
}
@keyframes log-rise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
.log-overlay-head {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 16px; border-bottom: 1px solid var(--border);
  flex: 0 0 auto;
}
.log-overlay-title { font-family: 'DM Serif Display', serif; font-size: 1.25rem; color: var(--text); flex: 1; }
.log-overlay-mid { flex: 1; text-align: center; font-weight: 600; color: var(--text); font-size: .95rem; }
.log-back {
  background: none; border: none; color: var(--accent);
  font-size: .95rem; cursor: pointer; padding: 4px 2px; font-weight: 600;
}
.log-close {
  margin-left: auto; flex: 0 0 auto;
  width: 34px; height: 34px; border-radius: 50%;
  background: var(--surface-2); border: 1px solid var(--border);
  color: var(--text-2); font-size: 1rem; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.log-close:active { background: var(--surface); }
.log-overlay-body { flex: 1; overflow-y: auto; padding: 16px 16px 40px; }
.log-overlay-inner { max-width: 600px; margin: 0 auto; width: 100%; }
.log-overlay-head-inner { max-width: 600px; margin: 0 auto; width: 100%; display: flex; align-items: center; gap: 10px; }
.log-group-title {
  font-size: .72rem; text-transform: uppercase; letter-spacing: .08em;
  color: var(--muted); font-weight: 700; margin: 16px 2px 8px;
}
.log-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.log-tile {
  background: var(--surface); border: 1px solid var(--border); border-radius: 16px;
  padding: 16px 6px 13px;
  display: flex; flex-direction: column; align-items: center; gap: 9px;
  cursor: pointer; color: var(--text);
  transition: transform .1s ease, border-color .2s ease, background .2s ease;
}
.log-tile:active { transform: scale(.95); background: var(--surface-2); border-color: var(--border-strong); }
.log-tile-icon { font-size: 1.5rem; line-height: 1; }
.log-tile-label { font-size: .82rem; font-weight: 600; }

/* ─── ME PAGE ──────────────────────────────────────────────────────────────── */
.me-profile {
  display: flex; align-items: center; gap: 14px;
  padding: 6px 2px 4px;
}
.me-avatar {
  width: 54px; height: 54px; flex: 0 0 auto; border-radius: 50%;
  background: linear-gradient(135deg, var(--accent), var(--accent-dim));
  color: #06222a; font-size: 1.4rem; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
}
.me-name { font-weight: 600; color: var(--text); font-size: 1rem; word-break: break-word; }
.me-group-title {
  font-size: .72rem; text-transform: uppercase; letter-spacing: .08em;
  color: var(--muted); font-weight: 700; margin: 4px 2px 8px;
}
.me-rows { display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; overflow: hidden; }
.me-row {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 14px; background: none; border: none; cursor: pointer;
  color: var(--text); font-size: .94rem; text-align: left; width: 100%;
  border-bottom: 1px solid var(--border);
}
.me-row:last-child { border-bottom: none; }
.me-row:active { background: var(--surface-2); }
.me-row-icon { font-size: 1.1rem; width: 24px; text-align: center; color: var(--accent); flex: 0 0 auto; }
.me-row-label { flex: 1; }
.me-row-chev { color: var(--muted); font-size: 1.2rem; }

/* ─── SLEEP INTELLIGENCE SECTION ───────────────────────────────────────────── */
.sleep-pill { font-size: .72rem; font-weight: 700; padding: 3px 10px; border-radius: 999px; border: 1px solid; white-space: nowrap; }
.sleep-need-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
.sleep-need-v { font-size: 2rem; font-weight: 700; line-height: 1; }
.sleep-need-v span { font-size: 1rem; color: var(--muted); margin-left: 3px; }
.sleep-lever-card { border-color: var(--accent); background: linear-gradient(180deg, var(--accent-dim), transparent); }
.sleep-lever-text { font-size: .95rem; line-height: 1.55; color: var(--text); margin: 2px 0 0; }
.sleep-anchor { display: flex; align-items: center; justify-content: center; gap: 16px; padding: 6px 0 2px; }
.sleep-anchor-item { display: flex; flex-direction: column; align-items: center; gap: 3px; }
.sleep-anchor-v { font-size: 1.5rem; font-weight: 700; color: var(--accent); }
.sleep-anchor-arrow { color: var(--muted); font-size: 1.2rem; }
.sleep-axis-stats { display: flex; gap: 10px; flex-wrap: wrap; }
.sleep-axis-stats .ts { flex: 1; min-width: 90px; }
.sleep-flag { margin-top: 10px; padding: 10px 12px; border-radius: 10px; background: rgba(249,201,126,.1); border: 1px solid rgba(249,201,126,.3); font-size: .82rem; line-height: 1.5; color: var(--text-2); }
.sleep-couple-row { display: flex; gap: 10px; align-items: flex-start; }
.sleep-couple-dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 6px; flex: 0 0 auto; }
.sleep-screen-band { font-weight: 600; font-size: .9rem; padding: 10px 12px; border-radius: 10px; }
.sleep-screen-band.elevated { background: rgba(244,126,110,.12); border: 1px solid rgba(244,126,110,.35); color: var(--bad); }
.sleep-screen-band.some { background: rgba(249,201,126,.1); border: 1px solid rgba(249,201,126,.3); color: #f9c97e; }
.sleep-screen-band.low { background: rgba(143,217,137,.1); border: 1px solid rgba(143,217,137,.3); color: var(--good); }
.screen-item { display: flex; align-items: center; gap: 10px; text-align: left; padding: 11px 12px; border-radius: 10px; background: var(--surface-2); border: 1px solid var(--border); color: var(--text); font-size: .86rem; line-height: 1.4; cursor: pointer; }
.screen-item.on { border-color: var(--accent); background: var(--accent-dim); }
.screen-check { width: 20px; height: 20px; flex: 0 0 auto; border-radius: 6px; border: 1.5px solid var(--border-strong); display: flex; align-items: center; justify-content: center; color: var(--accent); font-size: .8rem; }
.screen-item.on .screen-check { border-color: var(--accent); }
.sleep-block-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.sbg-item { display: flex; flex-direction: column; gap: 2px; background: var(--surface-2); border-radius: 10px; padding: 10px 12px; }
.sbg-l { font-size: .72rem; color: var(--muted); }
.sbg-v { font-size: 1.05rem; font-weight: 600; }
.sbg-v .good { color: var(--good); font-size: .85rem; }
.sbg-v .bad { color: var(--bad); font-size: .85rem; }
.sbg-v .muted { font-size: .8rem; }

/* ─── SLEEP LOG FORM (simplified) ──────────────────────────────────────────── */
.sleep-date { width: auto; min-height: 34px; padding: 5px 8px; font-size: .8rem; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; color: var(--text-2); }
.sleep-hero { text-align: center; padding: 6px 0 10px; }
.sleep-hero-moon { font-size: 1.5rem; color: var(--accent); line-height: 1; }
.sleep-hero-dur { font-size: 2.7rem; font-weight: 700; line-height: 1.05; letter-spacing: -.01em; }
.sleep-hero-dur span { font-size: 1rem; color: var(--muted); margin-left: 4px; font-weight: 600; }
.sleep-hero-range { color: var(--text-2); font-size: .85rem; margin-top: 3px; }
.sleep-hero-range strong { color: var(--accent); font-weight: 600; }
.sleep-field-label { font-size: .72rem; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 700; margin: 16px 2px 8px; }
.sleep-q-chips { display: flex; gap: 7px; }
.sleep-q-chip { flex: 1; padding: 11px 4px; border-radius: 12px; background: var(--surface-2); border: 1px solid var(--border); color: var(--text-2); font-size: .82rem; font-weight: 600; cursor: pointer; transition: background .15s, border-color .15s, color .15s, transform .1s; }
.sleep-q-chip:active { transform: scale(.95); }
.sleep-q-chip.on { background: var(--accent-dim); border-color: var(--accent); color: var(--accent); }
.sleep-detail-toggle { display: block; width: 100%; text-align: center; background: none; border: none; color: var(--accent); font-size: .85rem; font-weight: 600; cursor: pointer; padding: 16px 2px 4px; }
.sleep-detail { animation: log-rise .2s ease; }
.sleep-detail > .field-grid { margin-bottom: 4px; }

/* ─── ENERGY BALANCE / TDEE CARD ───────────────────────────────────────────── */
.eb-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.eb-cell { display: flex; flex-direction: column; gap: 2px; background: var(--surface-2); border-radius: 10px; padding: 9px 10px; text-align: center; align-items: center; }
.eb-l { font-size: .68rem; color: var(--muted); }
.eb-v { font-size: 1.1rem; font-weight: 700; }
.eb-flag { margin-top: 10px; padding: 9px 12px; border-radius: 10px; border: 1px solid; font-size: .82rem; line-height: 1.45; background: rgba(255,255,255,.02); }
.eb-building { padding: 4px 0; }

/* ─── TRAINING INTELLIGENCE CARD ───────────────────────────────────────────── */
.train-sub { font-size: .72rem; text-transform: uppercase; letter-spacing: .06em; color: var(--text-2); font-weight: 700; margin: 2px 0 10px; }
.train-sub .muted { text-transform: none; letter-spacing: 0; font-weight: 400; }
.train-lifts { display: flex; flex-direction: column; gap: 8px; }
.train-lift-row { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 10px; }
.train-lift-name { font-size: .9rem; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.train-lift-e1rm { font-weight: 700; font-size: .95rem; }
.train-vol { display: flex; flex-direction: column; gap: 7px; }
.train-vol-row { display: grid; grid-template-columns: 78px 1fr 30px; align-items: center; gap: 10px; }
.train-vol-label { font-size: .82rem; color: var(--text-2); }
.train-vol-track { height: 8px; background: var(--surface-2); border-radius: 999px; overflow: hidden; }
.train-vol-fill { height: 100%; border-radius: 999px; transition: width .3s; }
.train-vol-sets { font-size: .85rem; font-weight: 700; text-align: right; }

/* ─── SKIN INTELLIGENCE SECTION (own visual identity: softer rose accent) ───── */
/* ─── SKIN: calm light theme (warm beige + sage green), narrowed & centered ─── */
.skin-scope {
  --bg: #ece4d4;
  --surface: #faf7f0;
  --surface-2: #f0e9da;
  --border: rgba(74,92,62,.12);
  --border-strong: rgba(74,92,62,.2);
  --text: #313a2c;
  --text-2: #56624f;
  --muted: #8a937c;
  --accent: #5f8d57;
  --accent-dim: rgba(95,141,87,.14);
  --good: #5f8d57;
  --bad: #c0673e;
  max-width: 580px; margin: 0 auto;
  background: #ece4d4; border-radius: 22px; padding: 16px;
}
.skin-scope .card { background: var(--surface); border-color: var(--border); box-shadow: 0 1px 3px rgba(74,92,62,.06); }
.skin-scope input, .skin-scope textarea { background: var(--surface-2); color: var(--text); border-color: var(--border-strong); }
.skin-scope input::placeholder, .skin-scope textarea::placeholder { color: var(--muted); }
.skin-scope .sleep-q-chip { background: var(--surface-2); color: var(--text-2); border-color: var(--border-strong); }
.skin-scope .sleep-q-chip.on { background: var(--accent-dim); color: var(--accent); border-color: var(--accent); }
/* skin coach */
.skin-chat { display: flex; flex-direction: column; gap: 8px; max-height: 340px; overflow-y: auto; padding: 2px; }
.skin-msg { max-width: 88%; padding: 9px 13px; border-radius: 14px; font-size: .88rem; line-height: 1.5; white-space: pre-wrap; }
.skin-msg.user { align-self: flex-end; background: var(--accent-dim); color: var(--text); border-bottom-right-radius: 4px; }
.skin-msg.ai { align-self: flex-start; background: var(--surface-2); color: var(--text); border-bottom-left-radius: 4px; }
.skin-msg.typing { display: flex; gap: 4px; padding: 13px; }
.skin-msg.typing span { width: 6px; height: 6px; background: var(--muted); border-radius: 50%; animation: bounce .9s infinite; }
.skin-msg.typing span:nth-child(2) { animation-delay: .15s; }
.skin-msg.typing span:nth-child(3) { animation-delay: .3s; }
.skin-coach-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.skin-coach-chip { font-size: .76rem; padding: 6px 11px; border-radius: 999px; background: var(--accent-dim); color: var(--accent); border: 1px solid var(--border-strong); cursor: pointer; }
.skin-coach-row { display: flex; gap: 8px; margin-top: 10px; align-items: flex-end; }
.skin-coach-row textarea { flex: 1; resize: none; min-height: 42px; }
/* skin procedures */
.skin-proc-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.skin-proc-chip { font-size: .8rem; padding: 7px 12px; border-radius: 10px; background: var(--surface-2); color: var(--text-2); border: 1px solid var(--border-strong); cursor: pointer; }
.skin-proc-chip.on { background: var(--accent-dim); color: var(--accent); border-color: var(--accent); }
.skin-proc-item { display: flex; align-items: flex-start; gap: 10px; background: var(--surface-2); border-radius: 10px; padding: 10px 12px; }
.skin-routine-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.skin-routine-col { background: var(--surface-2); border-radius: 12px; padding: 12px; }
.skin-routine-head { font-size: .8rem; font-weight: 700; color: var(--text-2); margin-bottom: 8px; }
.skin-routine-step { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 10px; background: var(--surface); border-radius: 8px; margin-bottom: 6px; font-size: .82rem; color: var(--text); }
.skin-x { background: none; border: none; color: var(--muted); font-size: 1.1rem; line-height: 1; cursor: pointer; flex: 0 0 auto; padding: 0 2px; }
.skin-x:active { color: var(--bad); }
.skin-add-step { background: none; border: 1px dashed var(--border-strong); color: var(--accent); border-radius: 8px; padding: 7px; width: 100%; font-size: .8rem; cursor: pointer; margin-top: 2px; }
.skin-research-item { display: flex; gap: 10px; align-items: flex-start; background: var(--surface-2); border-radius: 10px; padding: 10px 12px; }
.skin-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
.skin-tag { font-size: .68rem; padding: 2px 8px; border-radius: 999px; background: var(--accent-dim); color: var(--accent); }
.skin-photo-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.skin-photo { position: relative; aspect-ratio: 3/4; border-radius: 10px; overflow: hidden; background: var(--surface-2); }
.skin-photo img { width: 100%; height: 100%; object-fit: cover; }
.skin-photo-date { position: absolute; bottom: 0; left: 0; right: 0; font-size: .62rem; padding: 3px 6px; background: linear-gradient(transparent, rgba(0,0,0,.7)); color: #fff; }
.skin-photo-x { position: absolute; top: 4px; right: 4px; width: 22px; height: 22px; border-radius: 50%; border: none; background: rgba(0,0,0,.55); color: #fff; font-size: .9rem; line-height: 1; cursor: pointer; }
.skin-compare { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.skin-compare-cell { display: flex; flex-direction: column; gap: 4px; align-items: center; }
.skin-compare-cell img { width: 100%; aspect-ratio: 3/4; object-fit: cover; border-radius: 10px; }
/* skin tabs + new tab content */
.skin-tabs { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; -ms-overflow-style: none; scrollbar-width: none; }
.skin-tabs::-webkit-scrollbar { display: none; }
.skin-tab { flex: 0 0 auto; padding: 8px 14px; border-radius: 999px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--text-2); font-size: .82rem; font-weight: 600; cursor: pointer; white-space: nowrap; }
.skin-tab.on { background: var(--accent); color: #fff; border-color: var(--accent); }
.lever-grid { display: flex; gap: 8px; }
.lever { flex: 1; background: var(--surface-2); border-radius: 12px; padding: 12px 8px; text-align: center; border: 1px solid transparent; }
.lever[data-tone="warn"] { border-color: rgba(224,162,60,.5); }
.lever[data-tone="ok"] { border-color: rgba(95,141,87,.4); }
.lever-v { display: block; font-size: 1.15rem; font-weight: 700; line-height: 1; text-transform: capitalize; }
.lever-l { display: block; font-size: .68rem; color: var(--muted); margin-top: 5px; }
.routine-check { display: flex; gap: 8px; }
.routine-toggle { flex: 1; padding: 11px; border-radius: 12px; border: 1px solid var(--border-strong); background: var(--surface-2); color: var(--text-2); font-size: .86rem; font-weight: 600; cursor: pointer; }
.routine-toggle.on { background: var(--accent-dim); color: var(--accent); border-color: var(--accent); }
.advice-action { font-size: 1.05rem; font-weight: 700; color: var(--accent); }
.advice-action[data-tone="warn"] { color: #d98a3c; }
.intro-block { background: var(--surface-2); border-radius: 12px; padding: 12px; }
.intro-steps { margin: 8px 0 0; padding-left: 18px; display: flex; flex-direction: column; gap: 5px; font-size: .82rem; line-height: 1.4; }
.proc-guide { margin-top: 8px; background: var(--surface-2); border-radius: 10px; padding: 10px 12px; border-left: 3px solid var(--accent); }
.proc-guide[data-mode="prep"] { border-left-color: #6ee7f7; }
.proc-guide-h { font-size: .72rem; text-transform: uppercase; letter-spacing: .04em; color: var(--accent); font-weight: 700; margin-bottom: 5px; }
.skin-section-h { font-size: .74rem; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); font-weight: 700; margin-bottom: 8px; }
.skin-proc-block { margin-bottom: 10px; }
.cond-spark { display: flex; align-items: flex-end; gap: 2px; height: 46px; margin-top: 12px; }
.cond-bar { flex: 1; background: var(--accent); border-radius: 2px; min-height: 3px; }
/* stylish log-meal card + embedded energy check + done meal blocks */
.log-meal-card { position: relative; overflow: hidden; border: 1px solid var(--border-strong); background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 7%, var(--surface)) 0%, var(--surface) 64%); }
.log-meal-card::before { content: ""; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, #f9c97e, #f47e6e, #b4a8e8); }
.log-meal-card .seg-btn.active { box-shadow: 0 1px 6px rgba(0,0,0,.18); }
.es-embed { margin: 4px 0 12px; padding: 12px; border-radius: 12px; background: var(--surface-2); border: 1px solid var(--border); }
.fuel-block.done { opacity: .5; }
.fuel-block.done .fuel-time::after { content: " ✓"; color: var(--good); }

/* ─── GLYCEMIC LOAD PILL ───────────────────────────────────────────────────── */
.gl-pill { display: inline-flex; align-items: center; font-size: .62rem; font-weight: 800; letter-spacing: .03em; text-transform: uppercase; padding: 2px 7px; border-radius: 999px; border: 1px solid; vertical-align: middle; white-space: nowrap; }
.gl-pill[data-band="low"] { color: #62b06a; background: rgba(98,176,106,.13); border-color: rgba(98,176,106,.32); }
.gl-pill[data-band="moderate"] { color: #e0a23c; background: rgba(224,162,60,.13); border-color: rgba(224,162,60,.32); }
.gl-pill[data-band="high"] { color: #e6713f; background: rgba(230,113,63,.14); border-color: rgba(230,113,63,.34); }
.gl-pill[data-band="none"] { color: var(--muted); background: var(--surface-2); border-color: var(--border); }
.rt-gl { text-align: center; font-size: .82rem; color: var(--text-2); margin-top: 8px; display: flex; align-items: center; justify-content: center; gap: 7px; flex-wrap: wrap; }
.pt-divider { height: 1px; background: var(--border); margin: 16px 0 14px; }
.pt-gl-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.pt-gl-label { font-weight: 600; font-size: .92rem; }

/* ─── CARB TIMING CARD ─────────────────────────────────────────────────────── */
.ct-hero { display: flex; gap: 10px; margin-bottom: 4px; }
.ct-stat { flex: 1; background: var(--surface-2); border-radius: 12px; padding: 11px 8px; text-align: center; }
.ct-v { display: block; font-size: 1.3rem; font-weight: 700; line-height: 1; }
.ct-l { display: block; font-size: .68rem; color: var(--muted); margin-top: 4px; }
.ct-status { font-weight: 700; font-size: .95rem; margin-top: 12px; }
.ct-status[data-tone="warn"] { color: #e0a23c; }
.ct-status[data-tone="ok"] { color: var(--good); }
.ct-list { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; }
.ct-row { display: flex; align-items: center; gap: 8px; font-size: .78rem; background: var(--surface-2); border-radius: 8px; padding: 7px 10px; }
.ct-row-when { color: var(--muted); white-space: nowrap; }
.ct-row-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ct-row-carbs { white-space: nowrap; font-weight: 600; }

/* ─── FUEL PLAN ────────────────────────────────────────────────────────────── */
.fuel-sessions { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
.fuel-sess { display: flex; align-items: center; justify-content: space-between; gap: 8px; background: var(--surface-2); border-radius: 8px; padding: 8px 11px; font-size: .82rem; }
.fuel-type-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.fuel-type-chip { font-size: .8rem; padding: 7px 12px; border-radius: 999px; background: var(--accent-dim); color: var(--accent); border: 1px solid var(--border-strong); cursor: pointer; }
.fuel-plan { margin-top: 14px; }
.fuel-totals { display: flex; gap: 8px; margin-bottom: 12px; }
.fuel-tot { flex: 1; background: var(--surface-2); border-radius: 12px; padding: 11px 8px; text-align: center; }
.fuel-tot-v { display: block; font-size: 1.15rem; font-weight: 700; line-height: 1; text-transform: capitalize; }
.fuel-tot-l { display: block; font-size: .66rem; color: var(--muted); margin-top: 4px; }
.fuel-timeline { display: flex; flex-direction: column; gap: 8px; }
.fuel-block { display: flex; gap: 10px; padding: 9px 11px; border-radius: 10px; background: var(--surface-2); border-left: 3px solid var(--border-strong); }
.fuel-block[data-kind="pre"] { border-left-color: #6ee7f7; }
.fuel-block[data-kind="during"] { border-left-color: #f9c97e; }
.fuel-block[data-kind="post"] { border-left-color: var(--good); }
.fuel-block[data-kind="meal"] { border-left-color: var(--muted); }
.fuel-block[data-kind="eaten"] { border-left-color: var(--accent); }
.fuel-block.done[data-kind="eaten"] { opacity: 1; }
.fuel-block.next { box-shadow: inset 0 0 0 1.5px var(--accent); }
.fuel-session-row { background: transparent; border: 1px dashed var(--border-strong); border-left: 3px dashed var(--accent); }
.fuel-session-row .fuel-label { color: var(--text-2); font-weight: 700; }
.carb-chip { display: inline-block; font-size: .58rem; text-transform: uppercase; letter-spacing: .03em; padding: 1px 6px; border-radius: 999px; margin-left: 6px; font-weight: 700; vertical-align: middle; }
.carb-chip.fast { background: #fde6c7; color: #9a5b16; }
.carb-chip.slow { background: #d9ecd6; color: #3f6b3a; }
.carb-chip.mixed { background: var(--surface); color: var(--text-2); border: 1px solid var(--border); }
.fuel-time { font-weight: 700; font-size: .82rem; width: 44px; flex: 0 0 auto; padding-top: 1px; }
.fuel-bd { flex: 1; }
.fuel-label { font-size: .86rem; font-weight: 600; }
.fuel-macros { font-weight: 700; color: var(--accent); font-size: .8rem; margin-left: 4px; }

/* ─── ENERGY CHECK CARD ────────────────────────────────────────────────────── */
.es-bars { display: flex; flex-direction: column; gap: 9px; }
.es-bar-row { display: flex; align-items: center; gap: 10px; }
.es-bar-lab { font-size: .76rem; color: var(--muted); width: 52px; flex: 0 0 auto; }
.es-bar-v { font-size: .78rem; font-weight: 600; width: 78px; text-align: right; flex: 0 0 auto; }
.es-status { font-weight: 700; font-size: .95rem; margin-top: 12px; }
.es-status[data-tone="warn"] { color: #e0a23c; }
.es-status[data-tone="ok"] { color: var(--good); }
.es-upcoming { margin-top: 12px; }
.es-up-title { font-size: .72rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin-bottom: 6px; }
.es-up-row { display: flex; align-items: center; gap: 8px; font-size: .78rem; background: var(--surface-2); border-radius: 8px; padding: 7px 10px; margin-bottom: 5px; }
.es-up-time { font-weight: 700; width: 44px; flex: 0 0 auto; }
.es-up-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.es-up-carbs { white-space: nowrap; font-weight: 600; color: var(--accent); }

/* ─── SkinLog ambient theme (calm leafy background, dark text) ─── */
.log-overlay.skinlog-active {
  background: linear-gradient(160deg, #e8efe2 0%, #f3eee3 45%, #ece2d1 100%);
  --text: #2f3b30; --text-2: #54615a; --muted: #8a958c; --accent: #5f8d57; --accent-dim: #e3ecde;
  --border: #ddd6c6; --border-strong: #cfc7b4; --surface: #fbf8f1; --surface-2: #f1ece0; --good: #5f8d57; --bg: #eef1e8;
}
.log-overlay.skinlog-active .log-overlay-head { position: relative; z-index: 2; background: rgba(248,244,236,.72); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border-bottom-color: rgba(0,0,0,.06); }
.log-overlay.skinlog-active .log-overlay-body { position: relative; z-index: 1; }
.skinlog-bg { position: fixed; inset: 0; z-index: -1; pointer-events: none; overflow: hidden; }
.sl-bloom { position: absolute; border-radius: 50%; filter: blur(44px); }
.sl-bloom.b1 { width: 340px; height: 340px; background: radial-gradient(circle, rgba(180,210,160,.55), transparent 70%); top: 6%; left: -8%; animation: sl-drift1 28s ease-in-out infinite; }
.sl-bloom.b2 { width: 280px; height: 280px; background: radial-gradient(circle, rgba(238,224,188,.55), transparent 70%); bottom: 4%; right: -6%; animation: sl-drift2 34s ease-in-out infinite; }
.sl-bloom.b3 { width: 240px; height: 240px; background: radial-gradient(circle, rgba(200,224,190,.45), transparent 70%); top: 44%; left: 58%; animation: sl-drift1 31s ease-in-out infinite reverse; }
@keyframes sl-drift1 { 0%,100% { transform: translate(0,0); } 50% { transform: translate(26px,32px); } }
@keyframes sl-drift2 { 0%,100% { transform: translate(0,0); } 50% { transform: translate(-32px,-24px); } }
.sl-leaf { position: absolute; width: 26px; height: 26px; background: linear-gradient(135deg, #7da874, #5f8d57); opacity: .14; border-radius: 0 100% 0 100%; box-shadow: inset -1px 1px 0 rgba(255,255,255,.25); }
.sl-leaf.l1 { left: 10%; animation: sl-fall 20s linear infinite; }
.sl-leaf.l2 { left: 34%; width: 20px; height: 20px; animation: sl-fall 25s linear infinite 3s; }
.sl-leaf.l3 { left: 66%; width: 31px; height: 31px; animation: sl-fall 23s linear infinite 6s; }
.sl-leaf.l4 { left: 82%; animation: sl-fall 28s linear infinite 2s; }
.sl-leaf.l5 { left: 50%; width: 18px; height: 18px; animation: sl-fall 21s linear infinite 9s; }
.sl-leaf.l6 { left: 22%; width: 24px; height: 24px; animation: sl-fall 31s linear infinite 5s; }
@keyframes sl-fall {
  0% { transform: translateY(-12vh) rotate(0deg); opacity: 0; }
  12% { opacity: .15; }
  88% { opacity: .15; }
  100% { transform: translateY(112vh) rotate(230deg); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) { .sl-leaf, .sl-bloom { animation: none !important; } }

.skinlog-brand { display: flex; align-items: center; gap: 9px; font-family: 'DM Serif Display', serif; font-size: 1.55rem; color: var(--accent); margin: 0 0 2px; }
.skinlog-mark { width: 18px; height: 18px; background: linear-gradient(135deg, #7da874, #5f8d57); border-radius: 0 100% 0 100%; display: inline-block; }

/* lever readability + wrap for 5 tiles */
.lever-grid { display: flex; gap: 8px; flex-wrap: wrap; }
.lever { flex: 1 1 84px; min-width: 84px; }
.lever-v { color: var(--text); font-size: .98rem; line-height: 1.2; }
.lever-l { color: var(--text-2); }

/* dashboard procedure countdown */
.proc-countdown { border-left: 3px solid var(--accent); }

/* procedure science timeline */
.proc-timeline { margin-top: 8px; background: var(--surface-2); border-radius: 12px; padding: 12px 14px; }
.proc-timeline[data-medical="1"] { border-left: 3px solid #d98a3c; }
.proc-tl-head { font-size: .72rem; text-transform: uppercase; letter-spacing: .04em; color: var(--accent); font-weight: 700; margin-bottom: 10px; }
.proc-tl-row { display: flex; gap: 12px; padding: 7px 0 7px 14px; margin-left: 4px; border-left: 2px solid var(--border); position: relative; }
.proc-tl-row::before { content: ""; position: absolute; left: -6px; top: 11px; width: 9px; height: 9px; border-radius: 50%; background: var(--border-strong); }
.proc-tl-row.past { opacity: .48; }
.proc-tl-row.now { border-left-color: var(--accent); }
.proc-tl-row.now::before { background: var(--accent); box-shadow: 0 0 0 3px var(--accent-dim); }
.proc-tl-when { flex: 0 0 50px; font-weight: 700; font-size: .8rem; color: var(--text); display: flex; flex-direction: column; }
.proc-tl-when small { font-weight: 500; color: var(--muted); font-size: .64rem; }
.proc-tl-body { flex: 1; }
.proc-tl-act { font-size: .86rem; font-weight: 600; line-height: 1.35; }

/* product effects (before/after) */
.prod-effect { background: var(--surface-2); border-radius: 10px; padding: 10px 12px; }
.prod-effect-h { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 4px; }

/* routine suggestions */
.rs-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; background: var(--surface-2); border-radius: 10px; padding: 10px 12px; border-left: 3px solid var(--border); }
.rs-row[data-tone="warn"] { border-left-color: #d98a3c; }
.rs-row[data-tone="ok"] { border-left-color: var(--good); }
.rs-ev { flex: 0 0 auto; font-size: .6rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); border: 1px solid var(--border); border-radius: 999px; padding: 2px 8px; }

.coach-conclude { width: 100%; margin-bottom: 10px; border-color: var(--accent); color: var(--accent); font-weight: 600; }
.coach-plan { background: var(--surface-2); border-radius: 12px; padding: 12px 14px; }
.coach-plan-h { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 6px; }
.coach-plan-item { display: flex; gap: 10px; align-items: flex-start; width: 100%; text-align: left; background: none; border: none; border-top: 1px solid var(--border); padding: 8px 2px; cursor: pointer; color: var(--text); }
.coach-plan-item:first-of-type { border-top: none; }
.cpi-box { flex: 0 0 auto; width: 20px; height: 20px; border-radius: 6px; border: 1.5px solid var(--border-strong); display: flex; align-items: center; justify-content: center; font-size: .78rem; color: var(--good); margin-top: 1px; }
.coach-plan-item.done .cpi-box { background: var(--good); color: #fff; border-color: var(--good); }
.coach-plan-item.done .cpi-text { text-decoration: line-through; color: var(--muted); }
.cpi-text { font-size: .9rem; line-height: 1.4; }

/* ─── Goal Plan ─── */
.gp-brand { display: flex; align-items: center; gap: 9px; font-family: 'DM Serif Display', serif; font-size: 1.5rem; color: var(--text); margin: 0 0 2px; }
.gp-mark { width: 17px; height: 17px; border-radius: 50%; border: 3px solid #7cc4a0; box-sizing: border-box; display: inline-block; }
.gp-field { margin-bottom: 12px; }
.gp-field > label { display: block; font-size: .78rem; color: var(--text-2); margin-bottom: 5px; font-weight: 600; }
.gp-field input { width: 100%; }
.gp-row2 { display: flex; gap: 10px; }
.gp-row2 .gp-field { flex: 1; }
.gp-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.gp-chip { padding: 6px 11px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text-2); font-size: .82rem; font-weight: 600; }
.gp-chip.on { background: var(--accent); color: #0e1116; border-color: var(--accent); }
.tier-badge { display: inline-block; font-size: .56rem; text-transform: uppercase; letter-spacing: .04em; font-weight: 700; padding: 1px 6px; border-radius: 999px; border: 1px solid; vertical-align: middle; margin-left: 4px; }
.gp-verdict { display: inline-block; font-weight: 700; font-size: 1.05rem; padding: 4px 12px; border-radius: 999px; border: 1.5px solid; }
.gp-stat-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 6px 0; border-top: 1px solid var(--border); font-size: .9rem; }
.gp-stat-row:first-child { border-top: none; }
.gp-split { margin-top: 8px; }
.gp-primary { border-left: 3px solid var(--accent); }
.gp-primary-name { font-weight: 700; font-size: 1.05rem; }
.gp-lever { margin-bottom: 12px; }
.gp-lever-top { display: flex; justify-content: space-between; align-items: center; }
.gp-lever-name { font-weight: 600; font-size: .9rem; }
.gp-lever-score { font-weight: 700; font-size: .9rem; }
.gp-lever-bar { height: 7px; background: var(--surface-2); border-radius: 999px; overflow: hidden; margin-top: 5px; }
.gp-lever-fill { height: 100%; border-radius: 999px; transition: width .4s; }
.gp-chart { width: 100%; height: auto; display: block; }
.gp-axis { fill: var(--muted); font-size: 9px; }
.gp-legend { display: flex; gap: 14px; margin-top: 8px; font-size: .74rem; color: var(--text-2); }
.gp-legend span { display: flex; align-items: center; gap: 5px; }
.gp-legend i { width: 14px; height: 3px; border-radius: 2px; display: inline-block; }
.gp-legend i.dash { opacity: .7; }
.gp-prob { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.gp-sim-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 9px 0; border-top: 1px solid var(--border); }
.gp-sim-row:first-child { border-top: none; }
.gp-sim-label { font-size: .92rem; }
.gp-stepper { display: flex; align-items: center; gap: 4px; }
.gp-stepper button { width: 34px; height: 34px; border-radius: 9px; border: 1px solid var(--border-strong); background: var(--surface-2); color: var(--text); font-size: 1.2rem; font-weight: 600; line-height: 1; }
.gp-stepper button:disabled { opacity: .35; }
.gp-sim-val { min-width: 64px; text-align: center; font-weight: 700; font-size: .95rem; }
.gp-sim-out { display: flex; align-items: center; justify-content: center; gap: 14px; padding: 4px 0 6px; }
.gp-sim-col { text-align: center; }
.gp-sim-big { font-family: 'DM Serif Display', serif; font-size: 1.7rem; line-height: 1.1; margin-top: 2px; }
.gp-sim-big small { font-size: .8rem; font-family: inherit; color: var(--muted); }
.gp-sim-arrow { color: var(--muted); font-size: 1.3rem; }
.gp-sim-env { margin-top: 10px; background: var(--surface-2); border-radius: 10px; padding: 9px 12px; font-size: .88rem; line-height: 1.45; }
.gp-prob-num { font-family: 'DM Serif Display', serif; font-size: 2.4rem; color: var(--accent); line-height: 1; }
.gp-prob-bar { height: 9px; background: var(--surface-2); border-radius: 999px; overflow: hidden; margin-top: 10px; }
.gp-prob-fill { height: 100%; background: linear-gradient(90deg, #6ee7f7, #8fd989); border-radius: 999px; }
.gp-risk { padding: 9px 0; border-top: 1px solid var(--border); }
.gp-risk:first-child { border-top: none; }
.gp-risk-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.gp-risk-name { font-weight: 600; font-size: .92rem; display: flex; align-items: center; gap: 7px; }
.gp-risk-dot { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto; }
.gp-risk-level { font-size: .74rem; text-transform: uppercase; letter-spacing: .03em; font-weight: 700; }
.gp-report-body { white-space: pre-wrap; line-height: 1.6; font-size: .92rem; color: var(--text); }

/* ═══════════ SLEEP DASHBOARD (Goals › Sleep) — scoped under .sleepx ═══════════ */
.sleepx{
  --gh-text:#eef2f6; --gh-muted:#6b7480; --gh-hair:#232c38;
  --gh-accent:#4fb3bd; --gh-teal:#6ee7f7; --gh-good:#5fcf80; --gh-amber:#f9c97e; --gh-red:#f47e6e;
  --gh-deep:#4f6bff; --gh-rem:#8b6cff; --gh-light:#4fb3bd; --gh-awake:#f9c97e;
  --gh-card1:#141b24; --gh-card2:#0f151d;
  --gh-shadow:0 18px 40px -24px rgba(0,0,0,.9), 0 2px 8px -4px rgba(0,0,0,.6);
  --gh-font:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  color:var(--gh-text); font-family:var(--gh-font);
}
.sleepx .num{font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1}
.sleepx .topbar{display:flex;align-items:center;justify-content:space-between;margin:2px 4px 14px;flex-wrap:wrap;gap:6px}
.sleepx .crumbs{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--gh-muted)}
.sleepx .crumbs b{color:var(--gh-text);font-weight:600}
.sleepx .sync{display:inline-flex;align-items:center;gap:8px;font-size:12px;color:var(--gh-muted);padding:6px 10px;border:1px solid var(--gh-hair);border-radius:999px;background:rgba(255,255,255,.02);cursor:default}
.sleepx .sync.tap{cursor:pointer;transition:border-color .15s,color .15s}
.sleepx .sync.tap:hover{border-color:#33404f;color:var(--gh-text)}
.sleepx .sync .dot{width:7px;height:7px;border-radius:50%;background:var(--gh-good);box-shadow:0 0 0 3px rgba(95,207,128,.16)}
.sleepx .sync .syncx{margin-left:4px;opacity:.5;font-size:11px}
.sleepx .sync .syncx:hover{opacity:1;color:var(--gh-red)}
.sleepx .syncstatus{width:100%;font-size:12px;color:var(--gh-muted);margin-top:2px;text-align:right}
.sleepx .card{position:relative;background:linear-gradient(165deg,var(--gh-card1),var(--gh-card2));border:1px solid var(--gh-hair);border-radius:22px;box-shadow:var(--gh-shadow);padding:18px;margin-bottom:14px;overflow:hidden}
.sleepx .card::before{content:"";position:absolute;inset:0 0 auto 0;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.10),transparent)}
.sleepx .eyebrow{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--gh-muted);display:flex;align-items:center;gap:8px;margin:0 0 2px}
.sleepx .lead{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.sleepx .lead h2{margin:0;font-size:15px;font-weight:600;letter-spacing:-.01em}
.sleepx .divider{height:1px;background:var(--gh-hair);margin:16px -18px;border:0}
.sleepx .pill{display:inline-flex;align-items:center;gap:7px;font-size:12px;color:var(--gh-muted);padding:5px 9px;border:1px solid var(--gh-hair);border-radius:999px;background:rgba(255,255,255,.015)}
.sleepx .swatch{width:9px;height:9px;border-radius:3px;flex:none}
.sleepx .link-btn{background:none;border:0;color:var(--gh-accent);cursor:pointer;padding:0}
.sleepx .ghbtn{width:100%;padding:11px;border-radius:12px;border:1px solid var(--gh-accent);background:rgba(79,179,189,.14);color:var(--gh-teal);font-weight:600;cursor:pointer;font-size:14px}
.sleepx .ghbtn:hover{background:rgba(79,179,189,.22)}
.sleepx input[type=number]{background:rgba(255,255,255,.03);border:1px solid var(--gh-hair);border-radius:10px;color:var(--gh-text);padding:9px 11px;width:90px}
.sleepx .txt{font-size:12px;color:var(--gh-muted)}
/* hero */
.sleepx .hero{padding:20px}
.sleepx .hero .date{font-size:20px;font-weight:600;letter-spacing:-.02em;margin-top:2px}
.sleepx .ringwrap{display:flex;flex-direction:column;align-items:center;margin:14px 0 2px}
.sleepx .ring{position:relative;width:172px;height:172px}
.sleepx .ring svg{width:172px;height:172px;display:block}
.sleepx .ring .center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.sleepx .ring .score{font-size:48px;font-weight:800;letter-spacing:-.04em;line-height:1;background:linear-gradient(180deg,#fff,#c8d2dc);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.sleepx .ring .cap{font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:var(--gh-muted);margin-top:4px}
.sleepx .ring .delta{font-size:11.5px;margin-top:7px;font-weight:600;padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.05)}
.sleepx .breakdown{display:grid;grid-template-columns:1fr 1fr;gap:12px 18px;margin-top:16px;width:100%}
.sleepx .bd{display:flex;flex-direction:column;gap:6px}
.sleepx .bd-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
.sleepx .bd .swatch{width:9px;height:9px;border-radius:3px;margin-right:7px}
.sleepx .bd .lbl{font-size:12.5px;color:#c3ccd6;display:flex;align-items:center;font-weight:500}
.sleepx .bd .val{font-size:12px;color:var(--gh-text);font-weight:600}
.sleepx .bd .val i{color:var(--gh-muted);font-style:normal;font-size:10.5px;margin-left:1px;font-weight:400}
.sleepx .bd-bar{display:block;height:5px;border-radius:999px;background:rgba(255,255,255,.06);overflow:hidden}
.sleepx .bd-bar i{display:block;height:100%;border-radius:999px;opacity:.9}
.sleepx .stages-head{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px}
.sleepx .stages-head .t{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--gh-muted)}
.sleepx .stages-head .clock{font-size:12px;color:#aab3bd}
.sleepx .hypno svg,.sleepx .comp svg,.sleepx .tst svg{width:100%;height:auto;display:block}
.sleepx .stagechips{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
.sleepx .stagechips .pill{padding:6px 11px;border-color:transparent;background:rgba(255,255,255,.04)}
.sleepx .stagechips .pill b{color:var(--gh-text);font-weight:700;margin-left:1px}
.sleepx .continuity{display:grid;grid-template-columns:repeat(5,1fr);margin-top:16px;border:1px solid var(--gh-hair);border-radius:16px;overflow:hidden;background:rgba(255,255,255,.02)}
.sleepx .continuity .c{padding:13px 6px;text-align:center;position:relative}
.sleepx .continuity .c+.c::before{content:"";position:absolute;left:0;top:22%;bottom:22%;width:1px;background:var(--gh-hair)}
.sleepx .continuity .c .v{font-size:16px;font-weight:700;letter-spacing:-.02em;color:var(--gh-text)}
.sleepx .continuity .c .k{font-size:9px;letter-spacing:.11em;text-transform:uppercase;color:var(--gh-muted);margin-top:4px}
.sleepx .hero .divider{margin:18px -20px}
/* need+debt */
.sleepx .nd-top{display:flex;gap:12px}
.sleepx .nd-top .block{flex:1;min-width:0}
.sleepx .nd-top .k{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--gh-muted)}
.sleepx .nd-top .big{font-size:26px;font-weight:700;letter-spacing:-.02em;margin-top:3px}
.sleepx .nd-top .big small{font-size:15px;color:var(--gh-muted);font-weight:600}
.sleepx .nd-top .sub{font-size:12px;color:#aab3bd;margin-top:2px}
.sleepx .nd-top .block.debt .big{color:var(--gh-amber)}
.sleepx .conf{display:flex;align-items:center;gap:7px;margin-top:6px}
.sleepx .conf .bar{flex:1;height:4px;border-radius:999px;background:var(--gh-hair);overflow:hidden;max-width:96px}
.sleepx .conf .bar i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--gh-accent),var(--gh-teal))}
.sleepx .conf .txt{font-size:11px;color:var(--gh-muted);text-transform:capitalize}
.sleepx .tst{margin-top:16px}
.sleepx .plan{display:flex;align-items:center;gap:10px;margin-top:14px;padding:11px 12px;border:1px solid var(--gh-hair);border-radius:14px;background:rgba(249,201,126,.05)}
.sleepx .plan .ic{width:24px;height:24px;flex:none;border-radius:8px;display:grid;place-items:center;background:rgba(249,201,126,.14);color:var(--gh-amber);font-size:13px}
.sleepx .plan .tx{font-size:13px;color:#d9dfe6}
.sleepx .plan .tx b{color:var(--gh-text);font-weight:600}
/* lever */
.sleepx .lever{position:relative;display:flex;gap:13px;align-items:flex-start;padding:16px 18px 16px 17px;margin-bottom:14px;border-radius:18px;border:1px solid rgba(79,179,189,.32);background:linear-gradient(120deg,rgba(79,179,189,.14),rgba(110,231,247,.05) 55%,rgba(20,27,36,.2));box-shadow:var(--gh-shadow)}
.sleepx .lever::before{content:"";position:absolute;left:0;top:12px;bottom:12px;width:3px;border-radius:3px;background:linear-gradient(180deg,var(--gh-teal),var(--gh-accent))}
.sleepx .lever .ic{font-size:19px;line-height:1;margin-top:1px}
.sleepx .lever .eyebrow{color:var(--gh-accent);margin-bottom:4px}
.sleepx .lever p{margin:0;font-size:13.5px;color:#c8d0d8;line-height:1.5}
.sleepx .lever p b{color:var(--gh-text);font-weight:600}
/* circadian */
.sleepx .circ{display:flex;gap:16px;align-items:center}
.sleepx .circ .clockwrap{width:176px;flex:none}
.sleepx .circ .clockwrap svg{width:176px;height:176px;display:block}
.sleepx .circ .facts{flex:1;min-width:0;display:flex;flex-direction:column;gap:12px}
.sleepx .fact .k{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--gh-muted)}
.sleepx .fact .v{font-size:18px;font-weight:600;letter-spacing:-.01em;margin-top:1px}
.sleepx .fact.jet .v{color:var(--gh-amber)}
/* composition */
.sleepx .comp svg{margin-top:6px}
.sleepx .complegend{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}
/* recent */
.sleepx .row{display:flex;align-items:center;gap:12px;padding:12px 2px;border-bottom:1px solid var(--gh-hair)}
.sleepx .row:last-of-type{border-bottom:0}
.sleepx .row .tag{width:20px;flex:none;text-align:center;font-size:14px;color:var(--gh-muted)}
.sleepx .row .when{width:58px;flex:none}
.sleepx .row .when .d{font-size:12.5px;font-weight:600}
.sleepx .row .mini{flex:1;min-width:0}
.sleepx .row .mini svg{width:100%;height:auto;display:block}
.sleepx .row .mini .arch{font-size:12px;color:var(--gh-muted)}
.sleepx .row .dur{font-size:12.5px;color:#aab3bd;width:52px;text-align:right;flex:none}
.sleepx .row .sc{width:34px;height:34px;flex:none;border-radius:11px;display:grid;place-items:center;font-size:14px;font-weight:700;border:1px solid var(--gh-hair)}
.sleepx .row.archived{opacity:.72}
.sleepx .archnote{font-size:12px;color:var(--gh-muted);margin-top:12px;padding-top:12px;border-top:1px dashed var(--gh-hair);text-align:center}
.sleepx .sectionlabel{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--gh-muted);margin:22px 6px 10px;display:flex;justify-content:space-between;align-items:center}
@media (max-width:400px){
  .sleepx .continuity{grid-template-columns:repeat(3,1fr)}
  .sleepx .continuity .c:nth-child(n+4){border-top:1px solid var(--gh-hair)}
  .sleepx .circ{flex-direction:column}
  .sleepx .circ .facts{flex-direction:row;flex-wrap:wrap;width:100%}
  .sleepx .circ .facts .fact{flex:1 1 40%}
}
`;
