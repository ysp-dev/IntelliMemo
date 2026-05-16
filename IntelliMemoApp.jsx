import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CalendarDays,
  Check,
  Circle,
  Copy,
  Flame,
  KeyRound,
  ListFilter,
  MessageSquareText,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";

const TAGS = ["#업무", "#아이디어", "#개인"];
const TAG_COLORS = {
  "#업무": { bg: "rgba(124,58,237,0.18)", border: "rgba(124,58,237,0.35)", text: "#a78bfa" },
  "#아이디어": { bg: "rgba(6,182,212,0.15)", border: "rgba(6,182,212,0.32)", text: "#22d3ee" },
  "#개인": { bg: "rgba(236,72,153,0.14)", border: "rgba(236,72,153,0.3)", text: "#f472b6" },
};
const ACTION_FILTERS = [
  { key: "all", label: "전체" },
  { key: "active", label: "진행 중" },
  { key: "done", label: "완료" },
];
const DEFAULT_AI_MODEL = "gemini-2.5-flash";
const AI_MODELS = [
  { key: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { key: "gemini-2.5-flash", label: "Gemini 2.5 Flash 추천" },
  { key: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite" },
  { key: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash-Lite" },
];

const nowIso = () => new Date().toISOString();

const unwrapStorageValue = (value) => {
  if (typeof value === "string") return value;
  if (value && typeof value.value === "string") return value.value;
  return null;
};

const loadStoredJson = async (key, fallback) => {
  try {
    if (!window.storage?.get) return fallback;
    const raw = unwrapStorageValue(await window.storage.get(key));
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const saveStoredJson = async (key, value) => {
  try {
    if (!window.storage?.set) return;
    await window.storage.set(key, JSON.stringify(value));
  } catch {}
};

const relativeTime = (iso, tick) => {
  const then = new Date(iso).getTime();
  const diff = Math.max(0, tick - then);
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  if (hours < 24) return `${hours}시간 전`;
  if (hours < 48) return "어제";
  const date = new Date(iso);
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
};

const isPastDue = (date, done) => {
  if (!date || done) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(`${date}T00:00:00`) < today;
};

const formatDueDate = (date) => {
  if (!date) return "마감 없음";
  const due = new Date(`${date}T00:00:00`);
  return `${due.getMonth() + 1}/${due.getDate()}`;
};

const createId = () =>
  window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const copyToClipboard = async (text) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.cssText = "position:fixed;top:-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
};

const getModelFallbacks = (selectedModel) => {
  const modelKeys = AI_MODELS.map((m) => m.key);
  const startIndex = Math.max(0, modelKeys.indexOf(selectedModel));
  return modelKeys.slice(startIndex);
};

const normalizeAiModel = (model) =>
  AI_MODELS.some((o) => o.key === model) ? model : DEFAULT_AI_MODEL;

const extractResponseText = (response) => {
  for (const candidate of response.candidates ?? []) {
    const text = (candidate.content?.parts ?? [])
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("")
      .trim();
    if (text) return text;
  }
  return "";
};

const isResponseTruncated = (response) =>
  (response.candidates ?? []).some((c) => c.finishReason === "MAX_TOKENS");

const summarizeApiError = (status, errorText) => {
  let message = errorText;
  try {
    const parsed = JSON.parse(errorText);
    message = parsed?.error?.message || parsed?.message || errorText;
  } catch {}
  const n = message.toLowerCase();
  if (n.includes("api key not valid") || n.includes("api_key_invalid") || n.includes("invalid api key"))
    return "Gemini API 키를 확인해주세요.";
  if (n.includes("quota") || n.includes("rate limit") || n.includes("resource_exhausted"))
    return "Gemini API 사용량 한도 또는 요청 빈도를 확인해주세요.";
  if (n.includes("billing")) return "Google Cloud 결제 설정 또는 Gemini API 사용 권한을 확인해주세요.";
  if (n.includes("permission") || n.includes("forbidden") || n.includes("access"))
    return "Gemini API 키 권한을 확인해주세요.";
  if (status === 400) return "Gemini API 키 또는 요청 형식을 확인해주세요.";
  if (status === 401) return "Gemini API 키를 확인해주세요.";
  if (status === 403) return "Gemini API 키 권한 또는 결제 설정을 확인해주세요.";
  if (status === 404 && n.includes("model")) return "선택한 모델을 사용할 수 없습니다.";
  if (status === 429) return "Gemini API 사용량 한도 또는 요청 빈도를 확인해주세요.";
  if (status >= 500) return "Gemini API 서버 응답이 불안정합니다.";
  return message || `Gemini API 오류 ${status}`;
};

const correctKoreanText = async ({ apiKey, model, text, type }) => {
  let response;
  const instruction =
    "You proofread Korean quick-capture notes. Return only the fully corrected Korean text. Preserve every idea, detail, line break, meaning, intent, and tone. Do not summarize, shorten, omit, add explanations, labels, quotation marks, markdown, or alternatives. If the text is already natural, return it unchanged.";
  const prompt = `${instruction}\n\n${type === "actions" ? "액션 아이템" : "메모"} 전체 내용을 자연스러운 한국어로 교정해줘. 절대 줄이거나 누락하지 마.\n\n${text}`;

  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 1024, temperature: 0.2 },
        }),
      },
    );
  } catch (error) {
    throw new Error(
      error instanceof TypeError
        ? "브라우저가 Gemini API 호출을 막았거나 네트워크에 연결할 수 없습니다."
        : "API 호출에 실패했습니다.",
    );
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(summarizeApiError(response.status, errorText));
  }

  const data = await response.json();
  if (isResponseTruncated(data))
    throw new Error("교정 결과가 너무 길어 중간에 끊겼습니다. 문장을 나눠서 다시 교정해주세요.");
  const corrected = extractResponseText(data);
  if (!corrected) throw new Error("교정 결과가 비어 있습니다.");
  return corrected;
};

// ─── CSS ────────────────────────────────────────────────────────────────────

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Pretendard:wght@400;500;600;700;800&display=swap');

  html, body, #root {
    margin: 0;
    min-height: 100%;
  }

  body {
    background: #060608;
  }

  *, *::before, *::after {
    box-sizing: border-box;
    -webkit-tap-highlight-color: transparent;
  }

  button, input, textarea, select {
    font: inherit;
  }

  button {
    border: 0;
    cursor: pointer;
    min-width: 44px;
    min-height: 44px;
  }

  :root {
    color-scheme: dark;
    --bg: #060608;
    --surface: #0d0d14;
    --surface2: #12121c;
    --text: rgba(255,255,255,0.94);
    --text-muted: rgba(255,255,255,0.52);
    --text-faint: rgba(255,255,255,0.28);
    --line: rgba(255,255,255,0.07);
    --line-strong: rgba(255,255,255,0.12);

    --violet: #7c3aed;
    --violet-soft: rgba(124,58,237,0.18);
    --violet-glow: rgba(124,58,237,0.28);
    --cyan: #06b6d4;
    --cyan-soft: rgba(6,182,212,0.14);
    --cyan-glow: rgba(6,182,212,0.22);
    --rose: #f43f5e;
    --amber: #f59e0b;

    font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', system-ui, sans-serif;
    letter-spacing: -0.01em;
  }

  /* ── Aurora background ── */
  .app-shell {
    position: relative;
    min-height: 100vh;
    min-height: 100dvh;
    overflow: hidden;
    display: flex;
    justify-content: center;
    background: var(--bg);
    color: var(--text);
  }

  .aurora {
    position: fixed;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
    z-index: 0;
  }

  .aurora-orb {
    position: absolute;
    border-radius: 50%;
    filter: blur(80px);
    opacity: 0.55;
  }

  .aurora-orb-1 {
    width: 520px;
    height: 520px;
    top: -180px;
    left: -140px;
    background: radial-gradient(circle, rgba(124,58,237,0.7), rgba(67,20,180,0.3) 60%, transparent);
    animation: orb1 18s ease-in-out infinite alternate;
  }

  .aurora-orb-2 {
    width: 440px;
    height: 440px;
    top: -60px;
    right: -120px;
    background: radial-gradient(circle, rgba(6,182,212,0.55), rgba(2,100,150,0.25) 60%, transparent);
    animation: orb2 22s ease-in-out infinite alternate;
  }

  .aurora-orb-3 {
    width: 360px;
    height: 360px;
    bottom: 100px;
    right: -80px;
    background: radial-gradient(circle, rgba(244,63,94,0.35), transparent 65%);
    animation: orb3 26s ease-in-out infinite alternate;
  }

  .aurora-orb-4 {
    width: 300px;
    height: 300px;
    bottom: 60px;
    left: -60px;
    background: radial-gradient(circle, rgba(124,58,237,0.3), transparent 65%);
    animation: orb4 20s ease-in-out infinite alternate;
  }

  @keyframes orb1 {
    0%   { transform: translate(0, 0) scale(1); }
    100% { transform: translate(60px, 80px) scale(1.1); }
  }
  @keyframes orb2 {
    0%   { transform: translate(0, 0) scale(1); }
    100% { transform: translate(-50px, 60px) scale(0.92); }
  }
  @keyframes orb3 {
    0%   { transform: translate(0, 0) scale(1); }
    100% { transform: translate(-40px, -50px) scale(1.08); }
  }
  @keyframes orb4 {
    0%   { transform: translate(0, 0) scale(1); }
    100% { transform: translate(30px, -40px) scale(0.95); }
  }

  .noise-overlay {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 1;
    opacity: 0.028;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    background-size: 180px;
  }

  /* ── Phone frame ── */
  .phone-frame {
    position: relative;
    z-index: 2;
    width: min(100vw, 430px);
    min-height: 100vh;
    min-height: 100dvh;
    overflow: hidden;
    border-left: 1px solid rgba(255,255,255,0.055);
    border-right: 1px solid rgba(255,255,255,0.055);
  }

  /* ── Top chrome / header ── */
  .top-chrome {
    position: fixed;
    z-index: 20;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    width: min(100vw, 430px);
    padding-top: env(safe-area-inset-top);
    padding-bottom: 14px;
    background: linear-gradient(180deg, rgba(6,6,8,0.9) 0%, rgba(6,6,8,0.6) 100%);
    backdrop-filter: blur(28px) saturate(1.4);
    -webkit-backdrop-filter: blur(28px) saturate(1.4);
    border-bottom: 1px solid rgba(255,255,255,0.06);
    transition: padding-bottom 200ms ease;
  }

  .top-chrome.is-compact {
    padding-bottom: 10px;
    background: rgba(6,6,8,0.82);
    border-color: rgba(255,255,255,0.09);
  }

  .header-inner {
    margin: 0 auto;
    max-width: 430px;
    padding: 10px 16px 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .brand-block {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .brand-eyebrow {
    font-family: 'SF Mono', ui-monospace, Menlo, Consolas, monospace;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    background: linear-gradient(90deg, var(--violet) 0%, var(--cyan) 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .brand-title {
    margin: 0;
    font-size: 22px;
    font-weight: 800;
    line-height: 1.1;
    letter-spacing: -0.03em;
    color: var(--text);
  }

  .top-chrome.is-compact .brand-title {
    font-size: 18px;
  }

  .ai-orb {
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    border-radius: 14px;
    position: relative;
    overflow: hidden;
    background: linear-gradient(135deg, rgba(124,58,237,0.22), rgba(6,182,212,0.16));
    border: 1px solid rgba(124,58,237,0.3);
    color: #a78bfa;
    box-shadow: 0 0 20px rgba(124,58,237,0.18), inset 0 1px 0 rgba(255,255,255,0.1);
  }

  .ai-orb::before {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(135deg, rgba(255,255,255,0.08), transparent 50%);
    border-radius: inherit;
  }

  /* ── Mode tabs ── */
  .mode-tabs {
    position: relative;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
    padding: 4px;
    border-radius: 14px;
    background: rgba(255,255,255,0.055);
    border: 1px solid var(--line);
    overflow: hidden;
  }

  .mode-indicator {
    position: absolute;
    top: 4px;
    left: 4px;
    width: calc(50% - 4px);
    height: calc(100% - 8px);
    border-radius: 10px;
    background: linear-gradient(135deg, rgba(124,58,237,0.9), rgba(100,40,220,0.9));
    box-shadow: 0 4px 16px rgba(124,58,237,0.35), inset 0 1px 0 rgba(255,255,255,0.15);
  }

  .mode-tabs button {
    position: relative;
    z-index: 1;
    min-height: 46px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    background: transparent;
    border-radius: 10px;
    color: var(--text-muted);
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.01em;
    transition: color 180ms ease;
  }

  .mode-tabs button.is-active {
    color: #fff;
  }

  /* ── Filter tabs ── */
  .filter-tabs {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px;
    border-radius: 12px;
    background: rgba(255,255,255,0.045);
    border: 1px solid var(--line);
    min-height: 42px;
  }

  .filter-tabs-icon {
    margin: 0 6px;
    color: var(--text-faint);
    flex-shrink: 0;
  }

  .filter-tabs button {
    flex: 1;
    min-height: 34px;
    border-radius: 8px;
    background: transparent;
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 600;
    transition: background 160ms ease, color 160ms ease;
  }

  .filter-tabs button.is-active {
    background: rgba(255,255,255,0.1);
    color: var(--text);
  }

  /* ── Scroll stage ── */
  .scroll-stage {
    width: min(100vw, 430px);
    height: 100vh;
    height: 100dvh;
    overflow-y: auto;
    scrollbar-width: none;
    padding: 184px 14px 240px;
  }

  .scroll-stage::-webkit-scrollbar {
    display: none;
  }

  /* ── Stats bar ── */
  .stats-bar {
    display: flex;
    gap: 8px;
    margin-bottom: 14px;
  }

  .stat-chip {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 999px;
    background: rgba(255,255,255,0.05);
    border: 1px solid var(--line);
    font-size: 11px;
    font-weight: 700;
    color: var(--text-muted);
    letter-spacing: 0.02em;
  }

  .stat-chip .stat-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }

  .stat-chip.violet .stat-dot { background: var(--violet); box-shadow: 0 0 6px var(--violet); }
  .stat-chip.cyan .stat-dot   { background: var(--cyan);   box-shadow: 0 0 6px var(--cyan); }
  .stat-chip.rose .stat-dot   { background: var(--rose);   box-shadow: 0 0 6px var(--rose); }

  /* ── Memo list (bento style) ── */
  .memo-list {
    display: flex;
    flex-direction: column;
    gap: 0;
    border-radius: 18px;
    overflow: hidden;
    border: 1px solid rgba(255,255,255,0.07);
    background: rgba(255,255,255,0.025);
    backdrop-filter: blur(24px);
  }

  .swipe-shell {
    position: relative;
    overflow: hidden;
  }

  .memo-list .swipe-shell {
    border-bottom: 1px solid rgba(255,255,255,0.055);
  }

  .memo-list .swipe-shell:last-child {
    border-bottom: 0;
  }

  .delete-reveal {
    position: absolute;
    inset: 0;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    padding-right: 20px;
    background: linear-gradient(90deg, transparent 30%, rgba(244,63,94,0.55));
    color: #fff;
  }

  /* ── Memo card ── */
  .memo-card {
    position: relative;
    width: 100%;
    min-height: 84px;
    padding: 14px 14px 15px;
    background: transparent;
    border: 0;
    border-radius: 0;
    touch-action: pan-y;
    cursor: pointer;
    transition: background 160ms ease;
  }

  .memo-card:active {
    background: rgba(255,255,255,0.04);
  }

  .memo-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 8px;
  }

  .memo-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .tag-chip {
    display: inline-flex;
    align-items: center;
    padding: 2px 10px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.01em;
    white-space: nowrap;
  }

  .memo-time {
    font-family: 'SF Mono', ui-monospace, monospace;
    font-size: 10px;
    color: var(--text-faint);
    white-space: nowrap;
  }

  .memo-body {
    margin: 0;
    color: rgba(255,255,255,0.87);
    font-size: 14px;
    line-height: 1.6;
    font-weight: 400;
    overflow-wrap: anywhere;
  }

  .memo-copy {
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    min-width: 32px;
    min-height: 32px;
    display: grid;
    place-items: center;
    border-radius: 10px;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.08);
    color: var(--text-muted);
    transition: background 160ms ease, color 160ms ease, border-color 160ms ease;
  }

  .memo-copy.is-copied {
    background: rgba(124,58,237,0.22);
    border-color: rgba(124,58,237,0.4);
    color: #a78bfa;
  }

  .memo-edit {
    width: 100%;
    min-height: 72px;
    margin-top: 6px;
    resize: none;
    border: 1px solid rgba(124,58,237,0.3);
    outline: 0;
    color: var(--text);
    background: rgba(124,58,237,0.08);
    border-radius: 10px;
    padding: 10px 12px;
    line-height: 1.6;
    font-size: 13px;
    caret-color: #a78bfa;
  }

  /* ── Action list ── */
  .action-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .action-card {
    position: relative;
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 78px;
    padding: 14px 16px;
    border-radius: 16px;
    background: rgba(255,255,255,0.038);
    border: 1px solid var(--line);
    backdrop-filter: blur(20px);
    touch-action: pan-y;
    transition: opacity 200ms ease, filter 200ms ease;
  }

  .action-card.is-high {
    background: rgba(124,58,237,0.07);
    border-color: rgba(124,58,237,0.22);
    box-shadow: inset 2px 0 0 var(--violet), 0 0 28px rgba(124,58,237,0.1);
  }

  .action-card.is-done {
    opacity: 0.38;
    filter: saturate(0.5);
  }

  .action-text {
    margin: 0;
    color: var(--text);
    font-size: 15px;
    line-height: 1.45;
    font-weight: 520;
    overflow-wrap: anywhere;
  }

  .action-card.is-done .action-text {
    text-decoration: line-through;
    color: var(--text-muted);
  }

  /* ── Check mark ── */
  .check-wrap {
    flex-shrink: 0;
    width: 42px;
    height: 42px;
    display: grid;
    place-items: center;
    border-radius: 13px;
    color: var(--text-faint);
    background: rgba(255,255,255,0.05);
    border: 1px solid var(--line);
    transition: background 200ms ease, border-color 200ms ease, color 200ms ease;
  }

  .check-wrap.is-done {
    background: linear-gradient(135deg, rgba(124,58,237,0.85), rgba(100,40,220,0.85));
    border-color: rgba(124,58,237,0.5);
    color: #fff;
    box-shadow: 0 4px 16px rgba(124,58,237,0.3);
  }

  /* ── Action meta ── */
  .action-meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 6px;
  }

  .meta-tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 9px;
    border-radius: 999px;
    font-family: 'SF Mono', ui-monospace, monospace;
    font-size: 10px;
    font-weight: 600;
    color: var(--text-faint);
    background: rgba(255,255,255,0.05);
    border: 1px solid var(--line);
  }

  .meta-tag.is-past {
    color: rgba(245,158,11,0.9);
    background: rgba(245,158,11,0.1);
    border-color: rgba(245,158,11,0.25);
  }

  .priority-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 9px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 700;
    color: var(--text-faint);
    background: rgba(255,255,255,0.05);
    border: 1px solid var(--line);
  }

  .priority-pill.is-high {
    color: #fbbf24;
    background: rgba(245,158,11,0.12);
    border-color: rgba(245,158,11,0.28);
  }

  /* ── Empty state ── */
  .empty-state {
    min-height: 280px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    text-align: center;
  }

  .empty-icon-wrap {
    width: 64px;
    height: 64px;
    display: grid;
    place-items: center;
    border-radius: 20px;
    background: linear-gradient(135deg, var(--violet-soft), var(--cyan-soft));
    border: 1px solid rgba(124,58,237,0.2);
    color: #a78bfa;
  }

  .empty-label {
    color: var(--text-muted);
    font-size: 14px;
    font-weight: 500;
    line-height: 1.5;
    max-width: 240px;
  }

  /* ── Skeleton ── */
  .skeleton-wrap {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .skeleton-card {
    height: 80px;
    border-radius: 16px;
    border: 1px solid var(--line);
    background: linear-gradient(100deg,
      rgba(255,255,255,0.03) 25%,
      rgba(124,58,237,0.07) 50%,
      rgba(255,255,255,0.03) 75%);
    background-size: 240% 100%;
    animation: shimmer 1.4s ease-in-out infinite;
  }

  .skeleton-card:nth-child(2) { height: 96px; }
  .skeleton-card:nth-child(3) { height: 68px; }

  @keyframes shimmer {
    0%   { background-position: 120% 0; }
    100% { background-position: -120% 0; }
  }

  /* ── Bottom composer ── */
  .bottom-sheet {
    position: fixed;
    z-index: 30;
    left: 50%;
    bottom: 0;
    transform: translateX(-50%);
    width: min(calc(100vw - 16px), 414px);
    padding: 14px 14px calc(14px + env(safe-area-inset-bottom));
    border-radius: 26px 26px 0 0;
    background: rgba(10,10,18,0.88);
    border: 1px solid rgba(255,255,255,0.09);
    border-bottom: 0;
    backdrop-filter: blur(32px) saturate(1.3);
    -webkit-backdrop-filter: blur(32px) saturate(1.3);
    box-shadow:
      0 -1px 0 rgba(124,58,237,0.12),
      0 -30px 80px rgba(0,0,0,0.5);
  }

  /* handle bar */
  .bottom-sheet::before {
    content: '';
    display: block;
    width: 36px;
    height: 4px;
    border-radius: 999px;
    background: rgba(255,255,255,0.15);
    margin: 0 auto 12px;
  }

  /* ── Tag row ── */
  .chip-row {
    display: flex;
    gap: 7px;
    margin-bottom: 10px;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .chip-row::-webkit-scrollbar { display: none; }

  .tag-choice {
    flex: 1;
    min-height: 42px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255,255,255,0.055);
    border: 1px solid var(--line);
    color: var(--text-muted);
    transition: background 160ms ease, border-color 160ms ease, color 160ms ease;
  }

  .tag-choice[data-tag="#업무"].is-active   { background: rgba(124,58,237,0.2); border-color: rgba(124,58,237,0.38); color: #a78bfa; }
  .tag-choice[data-tag="#아이디어"].is-active { background: rgba(6,182,212,0.16); border-color: rgba(6,182,212,0.34); color: #22d3ee; }
  .tag-choice[data-tag="#개인"].is-active   { background: rgba(236,72,153,0.16); border-color: rgba(236,72,153,0.32); color: #f472b6; }

  /* ── Composer line ── */
  .composer-line {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 56px;
    padding: 5px 5px 5px 16px;
    border-radius: 16px;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.09);
    transition: border-color 180ms ease, box-shadow 180ms ease;
  }

  .composer-line:focus-within {
    border-color: rgba(124,58,237,0.4);
    box-shadow: 0 0 0 3px rgba(124,58,237,0.08), 0 0 20px rgba(124,58,237,0.08);
  }

  .composer-line input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text);
    font-size: 15px;
    font-weight: 500;
    caret-color: #a78bfa;
  }

  .composer-line input::placeholder {
    color: rgba(255,255,255,0.3);
  }

  .send-btn {
    flex-shrink: 0;
    width: 46px;
    height: 46px;
    display: grid;
    place-items: center;
    border-radius: 12px;
    background: linear-gradient(135deg, #7c3aed, #5b21b6);
    color: #fff;
    box-shadow: 0 4px 16px rgba(124,58,237,0.35);
    transition: transform 120ms ease, box-shadow 120ms ease;
  }

  .send-btn:active {
    transform: scale(0.93);
    box-shadow: 0 2px 8px rgba(124,58,237,0.25);
  }

  .correct-btn {
    flex-shrink: 0;
    width: 42px;
    height: 42px;
    display: grid;
    place-items: center;
    border-radius: 11px;
    background: rgba(124,58,237,0.1);
    border: 1px solid rgba(124,58,237,0.22);
    color: #a78bfa;
    transition: background 160ms ease;
  }

  .correct-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .correct-btn:not(:disabled):active {
    background: rgba(124,58,237,0.2);
  }

  /* ── Action controls ── */
  .action-controls {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
    margin-bottom: 10px;
  }

  .date-label {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    padding: 0 14px;
    border-radius: 12px;
    background: rgba(255,255,255,0.05);
    border: 1px solid var(--line);
    color: var(--text-muted);
  }

  .date-label input[type="date"] {
    flex: 1;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text);
    color-scheme: dark;
    font-family: 'SF Mono', ui-monospace, monospace;
    font-size: 12px;
  }

  .priority-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 14px;
    min-height: 44px;
    border-radius: 12px;
    background: rgba(255,255,255,0.05);
    border: 1px solid var(--line);
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 700;
    white-space: nowrap;
    transition: background 160ms ease, border-color 160ms ease, color 160ms ease;
  }

  .priority-btn.is-high {
    background: rgba(245,158,11,0.12);
    border-color: rgba(245,158,11,0.28);
    color: #fbbf24;
  }

  /* ── AI row ── */
  .ai-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 2px 0;
  }

  .ai-toggle-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 32px;
    padding: 0 12px;
    border-radius: 999px;
    background: rgba(255,255,255,0.05);
    border: 1px solid var(--line);
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.02em;
  }

  .ai-status-btn {
    flex: 1;
    min-height: 32px;
    min-width: 0;
    background: transparent;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: right;
    color: var(--text-faint);
    font-size: 11px;
    font-weight: 600;
  }

  .ai-status-btn.loading,
  .ai-status-btn.success {
    color: #a78bfa;
  }

  .ai-status-btn.error {
    color: rgba(244,63,94,0.9);
  }

  /* ── AI panel ── */
  .ai-panel {
    display: grid;
    grid-template-columns: 1fr 152px;
    gap: 8px;
    overflow: hidden;
    padding: 10px 2px 0;
  }

  .ai-panel input,
  .ai-panel select {
    min-height: 42px;
    min-width: 0;
    border-radius: 12px;
    border: 1px solid var(--line);
    outline: 0;
    background: rgba(255,255,255,0.05);
    color: var(--text);
    padding: 0 12px;
    font-size: 12px;
    font-weight: 500;
    transition: border-color 160ms ease;
  }

  .ai-panel input:focus,
  .ai-panel select:focus {
    border-color: rgba(124,58,237,0.35);
  }

  .ai-panel select {
    color-scheme: dark;
  }

  /* ── Error modal ── */
  .modal-backdrop {
    position: fixed;
    z-index: 80;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 24px;
    background: rgba(0,0,0,0.65);
    backdrop-filter: blur(16px);
  }

  .error-modal {
    width: min(100%, 360px);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    padding: 28px 24px;
    text-align: center;
    border-radius: 24px;
    background: rgba(15,15,22,0.97);
    border: 1px solid rgba(244,63,94,0.2);
    box-shadow: 0 32px 100px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04) inset;
  }

  .error-icon-wrap {
    width: 52px;
    height: 52px;
    display: grid;
    place-items: center;
    border-radius: 16px;
    background: rgba(244,63,94,0.12);
    border: 1px solid rgba(244,63,94,0.22);
    color: #fb7185;
  }

  .error-modal h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  .error-modal p {
    margin: 0;
    color: var(--text-muted);
    font-size: 14px;
    line-height: 1.6;
    overflow-wrap: anywhere;
  }

  .error-meta-row {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-radius: 12px;
    background: rgba(255,255,255,0.04);
    border: 1px solid var(--line);
    font-size: 11px;
  }

  .error-meta-row span { color: var(--text-muted); }
  .error-meta-row strong { color: var(--text); font-family: 'SF Mono', monospace; }

  .error-confirm-btn {
    width: 100%;
    min-height: 48px;
    border-radius: 14px;
    background: linear-gradient(135deg, #7c3aed, #5b21b6);
    color: #fff;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: -0.01em;
    box-shadow: 0 8px 24px rgba(124,58,237,0.32);
    transition: transform 120ms ease;
  }

  .error-confirm-btn:active {
    transform: scale(0.97);
  }

  /* ── Hover states (pointer device) ── */
  @media (hover: hover) {
    .memo-card:hover {
      background: rgba(255,255,255,0.04);
    }
    .action-card:hover {
      border-color: rgba(124,58,237,0.18);
    }
  }

  /* ── Portrait tablet ── */
  @media (min-width: 700px) and (orientation: portrait) {
    .phone-frame,
    .top-chrome,
    .scroll-stage {
      width: min(calc(100vw - 40px), 720px);
    }

    .bottom-sheet {
      width: min(calc(100vw - 64px), 680px);
    }

    .header-inner {
      max-width: 720px;
    }

    .scroll-stage {
      padding: 190px 24px 252px;
    }
  }

  /* ── Landscape compact ── */
  @media (min-width: 640px) and (max-height: 540px) and (orientation: landscape) {
    .app-shell { align-items: stretch; }

    .phone-frame {
      width: 100vw;
      min-height: 100dvh;
      display: grid;
      grid-template-columns: 260px minmax(0, 1fr);
      grid-template-rows: auto minmax(0, 1fr);
      grid-template-areas: "nav content" "composer content";
      border: 0;
    }

    .top-chrome {
      grid-area: nav;
      position: relative;
      top: auto; left: auto; transform: none;
      width: auto;
      padding: max(12px, env(safe-area-inset-top)) 0 12px;
      border-right: 1px solid var(--line);
      border-bottom: 0;
    }

    .scroll-stage {
      grid-area: content;
      width: 100%;
      height: 100dvh;
      padding: 14px;
    }

    .bottom-sheet {
      grid-area: composer;
      position: relative;
      left: auto; bottom: auto; transform: none;
      width: auto; height: 100%;
      padding: 14px 14px max(14px, env(safe-area-inset-bottom));
      border-radius: 0;
      border-left: 0;
      border-right: 1px solid var(--line);
      border-top: 0;
      box-shadow: none;
    }

    .bottom-sheet::before { display: none; }

    .chip-row { flex-wrap: wrap; overflow: visible; }
    .tag-choice { flex: 1 1 calc(50% - 7px); }
    .ai-row { flex-direction: column; align-items: stretch; gap: 4px; }
    .ai-status-btn { text-align: left; }
    .ai-panel { grid-template-columns: 1fr; }
  }

  /* ── Landscape desktop ── */
  @media (min-width: 900px) and (orientation: landscape) {
    .app-shell { align-items: center; padding: 24px; }

    .phone-frame {
      width: min(calc(100vw - 48px), 1200px);
      min-height: min(860px, calc(100dvh - 48px));
      height: min(860px, calc(100dvh - 48px));
      display: grid;
      grid-template-columns: minmax(250px, 0.72fr) minmax(360px, 1.4fr) minmax(320px, 0.88fr);
      grid-template-areas: "nav content composer";
      border: 1px solid rgba(255,255,255,0.07);
      border-radius: 24px;
      background: rgba(10,10,18,0.3);
      box-shadow: 0 40px 120px rgba(0,0,0,0.5);
    }

    .top-chrome {
      grid-area: nav;
      height: 100%;
      border-right: 1px solid var(--line);
      border-bottom: 0;
      overflow-y: auto;
      border-radius: 24px 0 0 24px;
    }

    .header-inner {
      height: 100%;
      justify-content: flex-start;
      gap: 18px;
      padding: 20px 18px;
    }

    .scroll-stage {
      width: 100%;
      height: 100%;
      padding: 20px;
    }

    .memo-list, .action-list, .skeleton-wrap {
      max-width: 600px;
      margin: 0 auto;
    }

    .bottom-sheet {
      height: 100%;
      border-left: 1px solid var(--line);
      border-right: 0;
      border-top: 0;
      padding: 20px 18px;
      border-radius: 0 24px 24px 0;
      box-shadow: none;
    }

    .bottom-sheet::before { display: none; }
    .action-controls { grid-template-columns: 1fr; }
  }

  @media (min-width: 1200px) and (orientation: landscape) {
    .phone-frame {
      grid-template-columns: 280px minmax(420px, 1fr) 360px;
    }
  }

  /* ── min-width: 44px ── */
  .flex-1 { flex: 1 1 0%; }
  .min-w-0 { min-width: 0; }
`;

// ─── Components ─────────────────────────────────────────────────────────────

function ErrorModal({ error, onClose }) {
  if (!error) return null;
  return (
    <motion.div
      className="modal-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="error-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="err-title"
        initial={{ y: 28, opacity: 0, scale: 0.95 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 20, opacity: 0, scale: 0.97 }}
        transition={{ type: "spring", stiffness: 340, damping: 28 }}
      >
        <div className="error-icon-wrap">
          <Sparkles size={22} />
        </div>
        <h2 id="err-title">AI 교정 실패</h2>
        <p>{error.message}</p>
        <div className="error-meta-row">
          <span>마지막 모델</span>
          <strong>{error.model}</strong>
        </div>
        <button type="button" className="error-confirm-btn" onClick={onClose}>
          확인
        </button>
      </motion.div>
    </motion.div>
  );
}

function TopChrome({ activeView, setActiveView, actionFilter, setActionFilter, compact }) {
  return (
    <header className={`top-chrome${compact ? " is-compact" : ""}`}>
      <div className="header-inner">
        <div className="header-row">
          <div className="brand-block">
            <span className="brand-eyebrow">IntelliMemo</span>
            <h1 className="brand-title">인텔리메모</h1>
          </div>
          <motion.div
            className="ai-orb"
            animate={{ scale: compact ? 0.9 : 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 22 }}
          >
            <Zap size={18} />
          </motion.div>
        </div>

        <div className="mode-tabs" role="tablist" aria-label="보기 전환">
          <motion.div
            className="mode-indicator"
            animate={{ x: activeView === "memos" ? 0 : "100%" }}
            transition={{ type: "spring", stiffness: 400, damping: 34 }}
          />
          <button
            type="button"
            className={activeView === "memos" ? "is-active" : ""}
            onClick={() => setActiveView("memos")}
            role="tab"
            aria-selected={activeView === "memos"}
          >
            <MessageSquareText size={16} />
            메모
          </button>
          <button
            type="button"
            className={activeView === "actions" ? "is-active" : ""}
            onClick={() => setActiveView("actions")}
            role="tab"
            aria-selected={activeView === "actions"}
          >
            <Check size={16} />
            액션
          </button>
        </div>

        <AnimatePresence initial={false}>
          {activeView === "actions" && (
            <motion.div
              className="filter-tabs"
              initial={{ y: -10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -10, opacity: 0 }}
              transition={{ duration: 0.16 }}
            >
              <ListFilter size={14} className="filter-tabs-icon" />
              {ACTION_FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={actionFilter === f.key ? "is-active" : ""}
                  onClick={() => setActionFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </header>
  );
}

function SkeletonList() {
  return (
    <div className="skeleton-wrap">
      {Array.from({ length: 5 }).map((_, i) => (
        <div className="skeleton-card" key={i} />
      ))}
    </div>
  );
}

function EmptyState({ type }) {
  return (
    <motion.div
      className="empty-state"
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 240, damping: 24 }}
    >
      <div className="empty-icon-wrap">
        <Sparkles size={24} />
      </div>
      <p className="empty-label">
        {type === "memos"
          ? "머릿속 생각을 여기 내려놓으세요 ☁️"
          : "할 일들이 아직 줄 서기 전이에요"}
      </p>
    </motion.div>
  );
}

function TagChip({ tag }) {
  const colors = TAG_COLORS[tag] ?? { bg: "rgba(255,255,255,0.08)", border: "rgba(255,255,255,0.12)", text: "rgba(255,255,255,0.68)" };
  return (
    <span
      className="tag-chip"
      style={{ background: colors.bg, border: `1px solid ${colors.border}`, color: colors.text }}
    >
      {tag}
    </span>
  );
}

function MemoCard({ memo, index, tick, onDelete, onEdit }) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(memo.text);
  const [isCopied, setIsCopied] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isEditing) inputRef.current?.focus();
  }, [isEditing]);

  useEffect(() => {
    if (!isEditing) setDraft(memo.text);
  }, [isEditing, memo.text]);

  const finishEdit = () => {
    const next = draft.trim();
    if (next) onEdit(memo.id, next);
    setIsEditing(false);
  };

  const handleCopy = async (e) => {
    e.stopPropagation();
    try {
      await copyToClipboard(memo.text);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 1400);
    } catch {
      setIsCopied(false);
    }
  };

  return (
    <motion.div className="swipe-shell">
      <div className="delete-reveal">
        <Trash2 size={18} />
      </div>
      <motion.article
        layout
        drag="x"
        dragConstraints={{ left: -112, right: 0 }}
        dragElastic={0.07}
        onDragEnd={(_, info) => {
          if (info.offset.x < -82 || info.velocity.x < -560) onDelete(memo.id);
        }}
        onTap={() => !isEditing && setIsEditing(true)}
        initial={{ y: 36, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ x: -110, opacity: 0 }}
        whileTap={{ scale: 0.985 }}
        transition={{ type: "spring", stiffness: 300, damping: 26, delay: index * 0.022 }}
        className="memo-card"
      >
        <div className="memo-header">
          <div className="memo-meta">
            <TagChip tag={memo.tag} />
            <time className="memo-time">{relativeTime(memo.createdAt, tick)}</time>
          </div>
          <button
            type="button"
            className={`memo-copy${isCopied ? " is-copied" : ""}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={handleCopy}
            aria-label={isCopied ? "복사됨" : "메모 복사"}
          >
            {isCopied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
        {isEditing ? (
          <textarea
            ref={inputRef}
            className="memo-edit"
            value={draft}
            rows={Math.min(6, Math.max(3, draft.split("\n").length + 1))}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={finishEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) finishEdit();
              if (e.key === "Escape") setIsEditing(false);
            }}
          />
        ) : (
          <p className="memo-body">{memo.text}</p>
        )}
      </motion.article>
    </motion.div>
  );
}

function CheckMark({ done }) {
  return (
    <motion.span
      className={`check-wrap${done ? " is-done" : ""}`}
      animate={done ? { scale: [1, 1.18, 1] } : { scale: 1 }}
      transition={{ duration: 0.32 }}
    >
      {done ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <motion.path
            d="M5 12.5l4.2 4.1L19 7"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
          />
        </svg>
      ) : (
        <Circle size={20} strokeWidth={1.8} />
      )}
    </motion.span>
  );
}

function ActionCard({ action, index, onToggle, onDelete }) {
  const pastDue = isPastDue(action.dueDate, action.done);

  return (
    <motion.div className="swipe-shell" style={{ borderRadius: 16 }}>
      <div className="delete-reveal" style={{ borderRadius: 16 }}>
        <Trash2 size={18} />
      </div>
      <motion.article
        layout
        drag="x"
        dragConstraints={{ left: -112, right: 0 }}
        dragElastic={0.07}
        onDragEnd={(_, info) => {
          if (info.offset.x < -82 || info.velocity.x < -560) onDelete(action.id);
        }}
        onTap={() => onToggle(action.id)}
        initial={{ y: 36, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ x: -110, opacity: 0 }}
        whileTap={{ scale: 0.985 }}
        transition={{ type: "spring", stiffness: 300, damping: 26, delay: index * 0.022 }}
        className={`action-card${action.done ? " is-done" : ""}${action.priority === "high" ? " is-high" : ""}`}
      >
        <CheckMark done={action.done} />
        <div className="flex-1 min-w-0">
          <p className="action-text">{action.text}</p>
          <div className="action-meta">
            <span className={`meta-tag${pastDue ? " is-past" : ""}`}>
              <CalendarDays size={11} />
              {formatDueDate(action.dueDate)}
            </span>
            <span className={`priority-pill${action.priority === "high" ? " is-high" : ""}`}>
              {action.priority === "high" && <Flame size={11} />}
              {action.priority === "high" ? "높음" : "보통"}
            </span>
          </div>
        </div>
      </motion.article>
    </motion.div>
  );
}

function StatsBar({ memos, actions, activeView }) {
  const done = actions.filter((a) => a.done).length;
  const active = actions.filter((a) => !a.done).length;

  if (activeView === "memos") {
    return (
      <div className="stats-bar">
        <div className="stat-chip violet">
          <span className="stat-dot" />
          메모 {memos.length}개
        </div>
        {memos.filter((m) => m.tag === "#업무").length > 0 && (
          <div className="stat-chip cyan">
            <span className="stat-dot" />
            업무 {memos.filter((m) => m.tag === "#업무").length}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="stats-bar">
      <div className="stat-chip violet">
        <span className="stat-dot" />
        진행 {active}개
      </div>
      {done > 0 && (
        <div className="stat-chip cyan">
          <span className="stat-dot" />
          완료 {done}개
        </div>
      )}
    </div>
  );
}

function BottomComposer({
  activeView,
  memoText, setMemoText,
  selectedTag, setSelectedTag,
  onAddMemo,
  actionText, setActionText,
  actionDueDate, setActionDueDate,
  actionPriority, setActionPriority,
  onAddAction,
  aiSettings, setAiSettings,
  aiStatus,
  onCorrectDraft,
}) {
  const inputRef = useRef(null);
  const [isAiOpen, setIsAiOpen] = useState(false);
  const draftText = activeView === "memos" ? memoText : actionText;
  const isCorrecting = aiStatus.state === "loading";

  useEffect(() => {
    if (aiStatus.state === "error") setIsAiOpen(true);
  }, [aiStatus.state]);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, [activeView]);

  return (
    <motion.form
      className="bottom-sheet"
      onSubmit={(e) => {
        e.preventDefault();
        activeView === "memos" ? onAddMemo() : onAddAction();
      }}
      initial={{ y: 120, opacity: 0.9 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
    >
      <AnimatePresence mode="wait" initial={false}>
        {activeView === "memos" ? (
          <motion.div
            key="memo-composer"
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -16, opacity: 0 }}
            transition={{ duration: 0.16 }}
          >
            <div className="chip-row">
              {TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  data-tag={tag}
                  className={`tag-choice${selectedTag === tag ? " is-active" : ""}`}
                  onClick={() => setSelectedTag(tag)}
                >
                  {tag}
                </button>
              ))}
            </div>
            <div className="composer-line">
              <input
                ref={inputRef}
                value={memoText}
                onChange={(e) => setMemoText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    onAddMemo();
                  }
                }}
                placeholder="빠르게 메모"
              />
              <button
                type="button"
                className="correct-btn"
                disabled={!draftText.trim() || isCorrecting}
                onClick={() => onCorrectDraft(activeView, () => setIsAiOpen(true))}
                aria-label="AI 한국어 교정"
              >
                <Sparkles size={16} />
              </button>
              <button type="submit" className="send-btn" aria-label="메모 추가">
                <Send size={17} />
              </button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="action-composer"
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -16, opacity: 0 }}
            transition={{ duration: 0.16 }}
          >
            <div className="action-controls">
              <label className="date-label">
                <CalendarDays size={15} />
                <input
                  type="date"
                  value={actionDueDate}
                  onChange={(e) => setActionDueDate(e.target.value)}
                />
              </label>
              <button
                type="button"
                className={`priority-btn${actionPriority === "high" ? " is-high" : ""}`}
                onClick={() => setActionPriority((v) => (v === "high" ? "normal" : "high"))}
              >
                <Flame size={14} />
                {actionPriority === "high" ? "높음" : "보통"}
              </button>
            </div>
            <div className="composer-line">
              <input
                ref={inputRef}
                value={actionText}
                onChange={(e) => setActionText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    onAddAction();
                  }
                }}
                placeholder="다음 액션"
              />
              <button
                type="button"
                className="correct-btn"
                disabled={!draftText.trim() || isCorrecting}
                onClick={() => onCorrectDraft(activeView, () => setIsAiOpen(true))}
                aria-label="AI 한국어 교정"
              >
                <Sparkles size={16} />
              </button>
              <button type="submit" className="send-btn" aria-label="액션 추가">
                <Plus size={18} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="ai-row">
        <button
          type="button"
          className="ai-toggle-btn"
          onClick={() => setIsAiOpen((v) => !v)}
        >
          <KeyRound size={13} />
          {aiSettings.apiKey ? "AI 설정됨" : "AI 설정"}
        </button>
        <button
          type="button"
          className={`ai-status-btn ${aiStatus.state}`}
          title={aiStatus.message}
          onClick={() => setIsAiOpen(true)}
        >
          {aiStatus.message}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {isAiOpen && (
          <motion.div
            className="ai-panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <input
              type="password"
              value={aiSettings.apiKey}
              onChange={(e) =>
                setAiSettings((s) => ({ ...s, apiKey: e.target.value.trim() }))
              }
              placeholder="Gemini API key"
              aria-label="Gemini API key"
            />
            <select
              value={aiSettings.model}
              onChange={(e) =>
                setAiSettings((s) => ({ ...s, model: e.target.value }))
              }
              aria-label="AI 모델"
            >
              {AI_MODELS.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.form>
  );
}

// ─── Main App ────────────────────────────────────────────────────────────────

export default function IntelliMemoApp() {
  const [activeView, setActiveView] = useState("memos");
  const [memos, setMemos] = useState([]);
  const [actions, setActions] = useState([]);
  const [memoText, setMemoText] = useState("");
  const [selectedTag, setSelectedTag] = useState(TAGS[0]);
  const [actionText, setActionText] = useState("");
  const [actionDueDate, setActionDueDate] = useState("");
  const [actionPriority, setActionPriority] = useState("normal");
  const [actionFilter, setActionFilter] = useState("all");
  const [aiSettings, setAiSettings] = useState({ apiKey: "", model: DEFAULT_AI_MODEL });
  const [aiStatus, setAiStatus] = useState({
    state: "idle",
    message: `Gemini 교정: ${DEFAULT_AI_MODEL}`,
  });
  const [correctionError, setCorrectionError] = useState(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [tick, setTick] = useState(Date.now());
  const hasHydrated = useRef(false);

  useEffect(() => {
    let mounted = true;

    const hydrate = async () => {
      const [storedMemos, storedActions, storedAi] = await Promise.all([
        loadStoredJson("memos", []),
        loadStoredJson("actions", []),
        loadStoredJson("aiSettings", { apiKey: "", model: DEFAULT_AI_MODEL }),
      ]);

      if (!mounted) return;

      setMemos(Array.isArray(storedMemos) ? storedMemos : []);
      setActions(Array.isArray(storedActions) ? storedActions : []);

      if (storedAi && typeof storedAi === "object") {
        const model = normalizeAiModel(storedAi.model);
        setAiSettings({
          apiKey: typeof storedAi.apiKey === "string" ? storedAi.apiKey : "",
          model,
        });
        setAiStatus({ state: "idle", message: `Gemini 교정: ${model}` });
      }

      hasHydrated.current = true;
      setTimeout(() => mounted && setIsLoaded(true), 240);
    };

    hydrate();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => { if (hasHydrated.current) saveStoredJson("memos", memos); }, [memos]);
  useEffect(() => { if (hasHydrated.current) saveStoredJson("actions", actions); }, [actions]);
  useEffect(() => { if (hasHydrated.current) saveStoredJson("aiSettings", aiSettings); }, [aiSettings]);

  const filteredActions = useMemo(() => {
    if (actionFilter === "active") return actions.filter((a) => !a.done);
    if (actionFilter === "done")   return actions.filter((a) => a.done);
    return actions;
  }, [actions, actionFilter]);

  const addMemo = () => {
    const text = memoText.trim();
    if (!text) return;
    setMemos((cur) => [{ id: createId(), text, tag: selectedTag, createdAt: nowIso() }, ...cur]);
    setMemoText("");
  };

  const addAction = () => {
    const text = actionText.trim();
    if (!text) return;
    setActions((cur) => [
      { id: createId(), text, dueDate: actionDueDate, priority: actionPriority, done: false, createdAt: nowIso() },
      ...cur,
    ]);
    setActionText("");
  };

  const deleteMemo   = (id) => setMemos((cur) => cur.filter((m) => m.id !== id));
  const editMemo     = (id, text) => setMemos((cur) => cur.map((m) => m.id === id ? { ...m, text } : m));
  const deleteAction = (id) => setActions((cur) => cur.filter((a) => a.id !== id));
  const toggleAction = (id) => setActions((cur) => cur.map((a) => a.id === id ? { ...a, done: !a.done } : a));

  const correctDraft = async (type, openSettings) => {
    const text = type === "memos" ? memoText.trim() : actionText.trim();
    if (!text) return;

    if (!aiSettings.apiKey) {
      setAiStatus({ state: "error", message: "API 키 필요" });
      openSettings();
      return;
    }

    setCorrectionError(null);

    const fallbacks = getModelFallbacks(normalizeAiModel(aiSettings.model));
    let lastError = null;
    let lastModel = fallbacks.at(-1) ?? DEFAULT_AI_MODEL;

    for (let i = 0; i < fallbacks.length; i++) {
      const model = fallbacks[i];
      lastModel = model;
      setAiSettings((s) => ({ ...s, model }));
      setAiStatus({
        state: "loading",
        message: i === 0 ? `${model} 교정 중...` : `${model}로 재시도 중...`,
      });

      try {
        const corrected = await correctKoreanText({ apiKey: aiSettings.apiKey, model, text, type });
        if (type === "memos") setMemoText(corrected);
        else setActionText(corrected);
        setAiStatus({
          state: "success",
          message: i === 0 ? "교정 완료" : `${model}로 교정 완료`,
        });
        return;
      } catch (err) {
        lastError = err;
      }
    }

    openSettings();
    const message = lastError instanceof Error ? lastError.message : "교정 실패";
    setAiStatus({ state: "error", message });
    setCorrectionError({ model: lastModel, message });
  };

  return (
    <main className="app-shell">
      <style>{CSS}</style>

      {/* Aurora background */}
      <div className="aurora" aria-hidden="true">
        <div className="aurora-orb aurora-orb-1" />
        <div className="aurora-orb aurora-orb-2" />
        <div className="aurora-orb aurora-orb-3" />
        <div className="aurora-orb aurora-orb-4" />
      </div>
      <div className="noise-overlay" aria-hidden="true" />

      <div className="phone-frame">
        <TopChrome
          activeView={activeView}
          setActiveView={setActiveView}
          actionFilter={actionFilter}
          setActionFilter={setActionFilter}
          compact={scrollTop > 24}
        />

        <section
          className="scroll-stage"
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        >
          <AnimatePresence mode="wait" initial={false}>
            {activeView === "memos" ? (
              <motion.div
                key="memos"
                initial={{ x: -20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 20, opacity: 0 }}
                transition={{ duration: 0.18 }}
              >
                {!isLoaded ? (
                  <SkeletonList />
                ) : memos.length === 0 ? (
                  <EmptyState type="memos" />
                ) : (
                  <>
                    <StatsBar memos={memos} actions={actions} activeView="memos" />
                    <motion.div className="memo-list" layout>
                      <AnimatePresence initial={false}>
                        {memos.map((memo, i) => (
                          <MemoCard
                            key={memo.id}
                            memo={memo}
                            index={i}
                            tick={tick}
                            onDelete={deleteMemo}
                            onEdit={editMemo}
                          />
                        ))}
                      </AnimatePresence>
                    </motion.div>
                  </>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="actions"
                initial={{ x: 20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -20, opacity: 0 }}
                transition={{ duration: 0.18 }}
              >
                {!isLoaded ? (
                  <SkeletonList />
                ) : filteredActions.length === 0 ? (
                  <EmptyState type="actions" />
                ) : (
                  <>
                    <StatsBar memos={memos} actions={actions} activeView="actions" />
                    <motion.div className="action-list" layout>
                      <AnimatePresence initial={false}>
                        {filteredActions.map((action, i) => (
                          <ActionCard
                            key={action.id}
                            action={action}
                            index={i}
                            onToggle={toggleAction}
                            onDelete={deleteAction}
                          />
                        ))}
                      </AnimatePresence>
                    </motion.div>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        <BottomComposer
          activeView={activeView}
          memoText={memoText}
          setMemoText={setMemoText}
          selectedTag={selectedTag}
          setSelectedTag={setSelectedTag}
          onAddMemo={addMemo}
          actionText={actionText}
          setActionText={setActionText}
          actionDueDate={actionDueDate}
          setActionDueDate={setActionDueDate}
          actionPriority={actionPriority}
          setActionPriority={setActionPriority}
          onAddAction={addAction}
          aiSettings={aiSettings}
          setAiSettings={setAiSettings}
          aiStatus={aiStatus}
          onCorrectDraft={correctDraft}
        />
      </div>

      <AnimatePresence>
        {correctionError && (
          <ErrorModal error={correctionError} onClose={() => setCorrectionError(null)} />
        )}
      </AnimatePresence>
    </main>
  );
}
