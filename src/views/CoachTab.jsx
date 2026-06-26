// ─── COACH TAB (lazy-loaded view) ───────────────────────────────────────────────
import { useState, useEffect, useRef } from "react";
import { STORAGE_KEY } from "../lib/keys";
import { MODELS, loadModelPref, currentModelId } from "../config";
import { cloudSync } from "../state/store";
import { callClaude, analyzeAllData, analyzePhysique, fileToResizedBase64, renderMarkdown, WEB_SEARCH_TOOL, COACH_PRINCIPLES } from "../api/client";
import { buildBrain, formatBrainText } from "../brain/brain";
import { Card, Empty, toast, useConfirm } from "../components/primitives";
import { SFX } from "../lib/fx";

const COACH_GREETING = { role: "assistant", text: "Hey! I'm your AI coach. Ask me anything — best exercises for your goal, how to improve your sleep, what to eat before a workout, whether you should rest today. I see your real fitness data and remember our chats. 💪", ts: Date.now() };

function loadMessages() {
  try { const r = localStorage.getItem(STORAGE_KEY + "_chat"); const p = r ? JSON.parse(r) : null; return Array.isArray(p) && p.length ? p : [COACH_GREETING]; } catch { return [COACH_GREETING]; }
}
const saveMessages = m => {
  // Don't persist base64 image previews — they'd bloat storage and the cloud row.
  const stripped = m.map(msg => msg.image ? { ...msg, image: undefined, hadImage: true } : msg);
  localStorage.setItem(STORAGE_KEY + "_chat", JSON.stringify(stripped));
  cloudSync();
};

function CoachTab({ data, goals }) {
  const [messages, setMessages] = useState(loadMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState("chat"); // chat | analysis | physique
  const [analysis, setAnalysis] = useState(null);
  const [analysisLoad, setAnalysisLoad] = useState(false);
  const [analysisErr, setAnalysisErr] = useState("");
  const [confirm, confirmModal] = useConfirm();
  const [attached, setAttached] = useState(null);
  // Physique state
  const [physFile, setPhysFile] = useState(null);
  const [physPreview, setPhysPreview] = useState(null);
  const [physResult, setPhysResult] = useState(null);
  const [physLoading, setPhysLoading] = useState(false);
  const [physErr, setPhysErr] = useState("");
  const endRef = useRef(null);
  const camRef = useRef();
  const galRef = useRef();
  const physCamRef = useRef();
  const physGalRef = useRef();

  function attachFile(f) {
    if (!f) return;
    const r = new FileReader();
    r.onload = ev => {
      const dataUrl = ev.target.result;
      setAttached({ b64: dataUrl.split(",")[1], mediaType: f.type, preview: dataUrl });
    };
    r.readAsDataURL(f);
  }

  useEffect(() => { saveMessages(messages); }, [messages]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  const hasData = data.sleep.length || data.diet.length || data.exercise.length || data.sports.length;

  function ctx() {
    return formatBrainText(buildBrain(data, goals));
  }

  async function compactIfNeeded(msgs) {
    if (msgs.length < 22) return msgs;
    if (msgs.some(m => m.summary)) {
      const sIdx = msgs.findIndex(m => m.summary);
      if (msgs.length - sIdx - 1 < 30) return msgs;
    }
    const toSum = msgs.slice(1, msgs.length - 20);
    const transcript = toSum.map(m => `${m.role.toUpperCase()}: ${m.text}`).join("\n\n");
    try {
      const sum = await callClaude({ system: "Summarize this coaching conversation in 4-6 bullet points: what the user works on, advice given, preferences, progress. Specific, no preamble.", userText: transcript, maxTokens: 400 });
      return [msgs[0], { role: "assistant", summary: true, text: `📝 *Earlier conversation summary:*\n\n${sum}`, ts: Date.now() }, ...msgs.slice(-20)];
    } catch { return msgs; }
  }

  async function send() {
    const q = input.trim();
    if ((!q && !attached) || loading) return;
    setInput("");
    const img = attached;
    setAttached(null);
    const userMsg = { role: "user", text: q || (img ? "(sent a photo)" : ""), ts: Date.now() };
    if (img) userMsg.image = img.preview; // store preview for re-display
    let updated = [...messages, userMsg];
    setMessages(updated);
    setLoading(true);
    try {
      updated = await compactIfNeeded(updated);
      setMessages(updated);
      const apiMsgs = updated.slice(1).map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.text }));
      const lastU = apiMsgs.map(m => m.role).lastIndexOf("user");
      if (lastU >= 0) {
        const textPart = `[Current data]\n${ctx()}\n\n[My message]\n${q || "Please look at this photo and give feedback relevant to my fitness goal."}`;
        if (img) {
          apiMsgs[lastU] = { role: "user", content: [
            { type: "image", source: { type: "base64", media_type: img.mediaType, data: img.b64 } },
            { type: "text", text: textPart }
          ]};
        } else {
          apiMsgs[lastU] = { role: "user", content: textPart };
        }
      }
      const reply = await callClaude({
        model: currentModelId(),
        system: `You are this user's personal coach — an elite strength & conditioning coach and sports nutritionist who actually knows them. The data block is your shared file with them. You also have your full conversation history (including a summary of older chats).

REAL-TIME ACCESS: The "RIGHT NOW" section at the top of the data block contains the ACTUAL current date, day of week, and time. This is real and authoritative — never claim you don't know what time/day it is. If asked "what time is it," answer directly from the RIGHT NOW block.

KNOW THEM AS A PERSON: The "ABOUT THE USER" section (if present) contains body stats, injuries, allergies, equipment access, preferences, and current life context. ALWAYS respect these — never suggest a movement that conflicts with an injury, never suggest a food they can't eat, never ignore their equipment limits or life context.

KNOW THE STRATEGY: The "CURRENT STRATEGY" section (if present) is what you're currently building toward — phase, focus, week of block. Evaluate data AGAINST the strategy, not in a vacuum. If they're in a cut phase and protein is low, that's a critical fix. If they're week 5 of a 6-week strength block, a deload comes next.

SIGNAL PRIORITY: The "KEY SIGNALS" section is ranked. CRITICAL signals must be addressed even if not asked. IMPORTANT signals lead the response when relevant. Notable signals only come up if the user's question touches that area.

CONNECT ACROSS CATEGORIES: Nutrition affects training. Sleep affects recovery. Today's plan affects what to eat. Recent PRs affect deload timing. Never treat these as separate topics.

${COACH_PRINCIPLES}

USE PHOTOS: When the user sends a meal/physique/gym photo, analyze it and tie back to their actual numbers and strategy when relevant.

WEB SEARCH: You can search the web, but only when you genuinely need a current/specific fact (exact branded nutrition, recent research, specific product). For general training/nutrition advice, answer directly.

FORMAT: Markdown — **bold** for key points, bullet lists for steps. Keep it tight — usually 2-3 short paragraphs. Their stated goal: ${goals.goal}.`,
        maxTokens: 1000,
        conversationMessages: apiMsgs,
        tools: WEB_SEARCH_TOOL
      });
      setMessages(m => [...m, { role: "assistant", text: reply || "Sorry, try again.", ts: Date.now() }]);
      SFX.success();
    } catch {
      setMessages(m => [...m, { role: "assistant", text: "Something went wrong. Try again.", ts: Date.now() }]);
      SFX.error();
    }
    setLoading(false);
  }

  async function clearChat() {
    const ok = await confirm({ title: "Clear chat history?", body: "All messages will be deleted. This can't be undone.", confirmLabel: "Clear", danger: true });
    if (ok) { setMessages([COACH_GREETING]); toast("Chat cleared"); }
  }

  async function runAnalysis() {
    setAnalysisLoad(true); setAnalysisErr("");
    try { setAnalysis(await analyzeAllData(data, goals)); }
    catch { setAnalysisErr("Couldn't analyze. Try again."); }
    setAnalysisLoad(false);
  }

  async function handlePhysFile(f) {
    if (!f) return;
    setPhysFile(f); setPhysResult(null); setPhysErr("");
    const r = new FileReader();
    r.onload = ev => setPhysPreview(ev.target.result);
    r.readAsDataURL(f);
  }

  async function analyzePhys() {
    if (!physFile) return;
    setPhysLoading(true); setPhysErr(""); setPhysResult(null);
    try {
      const resized = await fileToResizedBase64(physFile, 1280, 0.85);
      const brain = buildBrain(data, goals);
      const r = await analyzePhysique(resized.base64, resized.mediaType, goals, brain);
      if (r) setPhysResult(r); else setPhysErr("Couldn't analyze that photo. Try a clearer one in better light.");
    } catch { setPhysErr("Couldn't analyze that photo. Try again."); }
    setPhysLoading(false);
  }

  function clearPhys() {
    setPhysFile(null); setPhysPreview(null); setPhysResult(null); setPhysErr("");
  }

  const suggestions = ["Should I train today or rest?", "Am I eating enough protein?", "What should I eat pre-workout?", "How can I improve my sleep?"];
  const statusColor = { good: "var(--good)", warning: "var(--warn)", critical: "var(--bad)" };

  return (
    <div className="coach-wrap">
      {confirmModal}
      <div className="coach-bar">
        <div className="coach-bar-l">
          <span className="coach-bar-title">AI Coach</span>
          <span className="muted small">{view === "chat" ? `${messages.length - 1} messages · ${MODELS[loadModelPref()]?.label}` : MODELS[loadModelPref()]?.label}</span>
        </div>
        {view === "chat" && messages.length > 1 && <button className="link-btn" onClick={clearChat}>Clear</button>}
      </div>

      <div className="seg coach-seg">
        <button className={`seg-btn ${view === "chat" ? "active" : ""}`} onClick={() => setView("chat")}>💬 Chat</button>
        <button className={`seg-btn ${view === "analysis" ? "active" : ""}`} onClick={() => setView("analysis")}>📊 Analysis</button>
        <button className={`seg-btn ${view === "physique" ? "active" : ""}`} onClick={() => setView("physique")}>📸 Physique</button>
      </div>

      {view === "chat" && (
        <>
          <div className="msgs">
            {messages.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                {m.role === "assistant" && <div className="avatar">✦</div>}
                <div className="bubble">
                  {m.image && <img src={m.image} alt="" className="bubble-img" />}
                  {!m.image && m.hadImage && <div className="bubble-img-gone">📷 photo</div>}
                  {m.text && <div className="md">{renderMarkdown(m.text)}</div>}
                </div>
              </div>
            ))}
            {loading && (
              <div className="msg assistant">
                <div className="avatar">✦</div>
                <div className="bubble typing"><span /><span /><span /></div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {messages.length <= 1 && (
            <div className="suggs">
              {suggestions.map((s, i) => <button key={i} className="sugg" onClick={() => setInput(s)}>{s}</button>)}
            </div>
          )}

          <div className="composer-wrap">
            {attached && (
              <div className="attach-preview">
                <img src={attached.preview} alt="" />
                <button className="attach-x" onClick={() => setAttached(null)}>×</button>
                <span className="attach-label">Photo attached</span>
              </div>
            )}
            <div className="composer">
              <button className="attach-btn" onClick={() => camRef.current.click()} disabled={loading} title="Take photo">📷</button>
              <button className="attach-btn" onClick={() => galRef.current.click()} disabled={loading} title="Choose photo">🖼️</button>
              <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder={attached ? "Add a note (optional)…" : "Ask, or attach a photo…"} disabled={loading} />
              <button className="send" onClick={send} disabled={(!input.trim() && !attached) || loading}>{loading ? <span className="spinner" /> : "↑"}</button>
            </div>
            <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={e => attachFile(e.target.files[0])} />
            <input ref={galRef} type="file" accept="image/*" hidden onChange={e => attachFile(e.target.files[0])} />
          </div>
        </>
      )}

      {view === "analysis" && (
        <div className="stack analysis-stack">
          <Card title="Full data analysis" sub={`Reviews your last 14 days vs your ${goals.goal} goal`}>
            {!hasData ? <Empty title="No data yet" hint="Log some sleep, food, or workouts first" /> : (
              <button className="btn full" onClick={runAnalysis} disabled={analysisLoad}>
                {analysisLoad ? <><span className="spinner" />Analyzing…</> : analysis ? "Re-run analysis" : "Run analysis"}
              </button>
            )}
            {analysisErr && <div className="err">{analysisErr}</div>}
          </Card>

          {analysis && (
            <>
              <Card>
                <div className="score-row">
                  <div className="score-ring">
                    <svg viewBox="0 0 80 80">
                      <circle cx="40" cy="40" r="34" fill="none" stroke="var(--track)" strokeWidth="6" />
                      <circle cx="40" cy="40" r="34" fill="none" stroke="var(--accent)" strokeWidth="6" strokeDasharray={`${(analysis.overallScore / 10) * 213.6} 213.6`} strokeLinecap="round" transform="rotate(-90 40 40)" />
                    </svg>
                    <div className="score-n">{analysis.overallScore}<span>/10</span></div>
                  </div>
                  <div>
                    <div className="card-title" style={{ marginBottom: 4 }}>Overall score</div>
                    <p className="md-p">{analysis.summary}</p>
                  </div>
                </div>
              </Card>

              <Card className="priority-card">
                <div className="priority-label">⚡ This week's #1 priority</div>
                <p className="priority-text">{analysis.priorityAction}</p>
              </Card>

              {analysis.sections.map((s, i) => (
                <Card key={i}>
                  <div className="ana-hd">
                    <span className="card-title">{s.category}</span>
                    <div className="ana-score">
                      <span style={{ color: statusColor[s.status] }}>{s.score}/10</span>
                      <span className="ana-dot" style={{ background: statusColor[s.status] }} />
                    </div>
                  </div>
                  <p className="muted" style={{ lineHeight: 1.6, fontSize: ".88rem", marginTop: 8 }}>{s.insight}</p>
                  <ul className="ana-tips">
                    {s.tips.map((t, j) => <li key={j}><span className="ana-arrow">→</span><span>{t}</span></li>)}
                  </ul>
                </Card>
              ))}
            </>
          )}
        </div>
      )}

      {view === "physique" && (
        <div className="stack analysis-stack">
          <Card title="Physique check" sub="Upload a photo for AI feedback toward your goal">
            {!physResult && !physPreview && (
              <>
                <p className="muted small" style={{ marginBottom: 12, lineHeight: 1.5 }}>
                  Tip: front-facing, relaxed, good lighting, fitted clothing or shirtless gives the most useful read. The AI is your coach — it'll be honest, not flattering.
                </p>
                <div className="photo-choices">
                  <button className="photo-choice" onClick={() => physCamRef.current.click()}>
                    <span className="photo-choice-icon">📷</span><span>Take photo</span>
                  </button>
                  <button className="photo-choice" onClick={() => physGalRef.current.click()}>
                    <span className="photo-choice-icon">🖼️</span><span>Choose photo</span>
                  </button>
                </div>
                <input ref={physCamRef} type="file" accept="image/*" capture="environment" hidden onChange={e => handlePhysFile(e.target.files[0])} />
                <input ref={physGalRef} type="file" accept="image/*" hidden onChange={e => handlePhysFile(e.target.files[0])} />
                <p className="muted small" style={{ marginTop: 12, fontSize: ".72rem", lineHeight: 1.5 }}>
                  🔒 The photo is sent only to the AI for this analysis. It's not stored on your device or in the cloud after.
                </p>
              </>
            )}

            {physPreview && !physResult && (
              <>
                <img src={physPreview} alt="" className="phys-img" />
                {physErr && <div className="err">{physErr}</div>}
                <div className="row" style={{ marginTop: 10 }}>
                  <button className="btn flex" onClick={analyzePhys} disabled={physLoading}>
                    {physLoading ? <><span className="spinner" />Analyzing your physique…</> : "✦ Analyze"}
                  </button>
                  <button className="btn-ghost" onClick={clearPhys} disabled={physLoading}>Cancel</button>
                </div>
              </>
            )}

            {physResult && (
              <>
                <div className="phys-result">
                  {physResult.summary && <p className="phys-summary">{physResult.summary}</p>}
                  {physResult.strengths?.length > 0 && (
                    <div className="phys-section">
                      <div className="phys-section-h">💪 Strengths</div>
                      <ul className="phys-list">{physResult.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
                    </div>
                  )}
                  {physResult.observations?.length > 0 && (
                    <div className="phys-section">
                      <div className="phys-section-h">👀 What I see</div>
                      <ul className="phys-list">{physResult.observations.map((s, i) => <li key={i}>{s}</li>)}</ul>
                    </div>
                  )}
                  {physResult.focusAreas?.length > 0 && (
                    <div className="phys-section">
                      <div className="phys-section-h">🎯 Focus areas</div>
                      <ul className="phys-list">{physResult.focusAreas.map((s, i) => <li key={i}>{s}</li>)}</ul>
                    </div>
                  )}
                  {physResult.trainingAdvice && (
                    <div className="phys-section">
                      <div className="phys-section-h">🏋️ Training direction</div>
                      <p className="phys-p">{physResult.trainingAdvice}</p>
                    </div>
                  )}
                  {physResult.nutritionAdvice && (
                    <div className="phys-section">
                      <div className="phys-section-h">🍎 Nutrition direction</div>
                      <p className="phys-p">{physResult.nutritionAdvice}</p>
                    </div>
                  )}
                </div>
                <button className="btn-ghost full" style={{ marginTop: 14 }} onClick={clearPhys}>Analyze another photo</button>
              </>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}


export default CoachTab;
