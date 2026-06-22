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
.ring svg { display: block; }
.ring svg circle:last-child { filter: drop-shadow(0 0 4px var(--accent-glow)); }
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
  flex: 0 0 auto;
  width: 56px; height: 56px; min-width: 56px;
  margin: 0 4px -14px; /* raise it above the bar */
  border: none; border-radius: 50%;
  background: var(--accent);
  color: #06222a; font-size: 30px; font-weight: 300; line-height: 1;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  box-shadow: 0 6px 18px var(--accent-glow), 0 2px 6px rgba(0,0,0,.4);
  transition: transform .12s ease, box-shadow .2s ease;
}
.tab-plus:hover { box-shadow: 0 8px 22px var(--accent-glow), 0 2px 8px rgba(0,0,0,.5); }
.tab-plus:active { transform: scale(.92); }

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
.skin-scope { --accent: #e0879f; --accent-dim: rgba(224,135,159,.14); }
.skin-routine-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.skin-routine-col { background: var(--surface-2); border-radius: 12px; padding: 12px; }
.skin-routine-head { font-size: .8rem; font-weight: 700; color: var(--text-2); margin-bottom: 8px; }
.skin-routine-step { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 10px; background: var(--surface); border-radius: 8px; margin-bottom: 6px; font-size: .82rem; }
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
`;
