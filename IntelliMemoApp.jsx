import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUp,
  CalendarDays,
  Camera,
  Check,
  CheckCircle2,
  Copy,
  Flame,
  KeyRound,
  ListFilter,
  MessageSquareText,
  Monitor,
  Pencil,
  RotateCcw,
  Smartphone,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

// ─── Constants ───────────────────────────────────────────────────────────────

const TAGS = ["#업무", "#아이디어", "#개인"];

const TAG_STYLES = {
  "#업무":    { bg: "#ede9fe", color: "#5b21b6", dot: "#7c3aed" },
  "#아이디어": { bg: "#ecfeff", color: "#0e7490", dot: "#06b6d4" },
  "#개인":    { bg: "#fce7f3", color: "#9d174d", dot: "#ec4899" },
};

const DEFAULT_TAG = TAGS[0];

const ACTION_FILTERS = [
  { key: "all",    label: "전체" },
  { key: "active", label: "진행 중" },
  { key: "done",   label: "완료" },
];

const DEFAULT_AI_MODEL = "gemini-2.5-flash";
const AI_SETTINGS_STORAGE_KEY = "aiSettings";
const AI_API_KEY_SESSION_KEY = "aiApiKey";

const AI_MODELS = [
  { key: "gemini-2.5-pro",        label: "Gemini 2.5 Pro" },
  { key: "gemini-2.5-flash",      label: "Gemini 2.5 Flash 추천" },
  { key: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite" },
  { key: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash-Lite" },
];

const UNDO_DELAY_MS = 3500;

// ─── Utilities ───────────────────────────────────────────────────────────────

const nowIso = () => new Date().toISOString();

const createId = () =>
  window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const unwrapStorage = (v) =>
  typeof v === "string" ? v : (v?.value ?? null);

const loadJson = async (key, fallback) => {
  try {
    if (!window.storage?.get) return fallback;
    const raw = unwrapStorage(await window.storage.get(key));
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
};

const saveJson = async (key, value) => {
  try {
    if (!window.storage?.set) return;
    await window.storage.set(key, JSON.stringify(value));
  } catch {}
};

const loadSessionValue = (key) => {
  try { return window.sessionStorage?.getItem(key) ?? ""; }
  catch { return ""; }
};

const saveSessionValue = (key, value) => {
  try {
    if (!window.sessionStorage) return;
    if (value) window.sessionStorage.setItem(key, value);
    else window.sessionStorage.removeItem(key);
  } catch {}
};

const relativeTime = (iso, tick) => {
  const diff = Math.max(0, tick - new Date(iso).getTime());
  const min  = Math.floor(diff / 60_000);
  const hr   = Math.floor(diff / 3_600_000);
  if (min < 1)  return "방금";
  if (min < 60) return `${min}분 전`;
  if (hr  < 24) return `${hr}시간 전`;
  if (hr  < 48) return "어제";
  const d = new Date(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
};

const dateGroupLabel = (iso) => {
  const now    = new Date();
  const date   = new Date(iso);
  const diffMs = now.setHours(0,0,0,0) - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  if (diffMs < 0)          return "오늘";
  if (diffMs < 86_400_000) return "오늘";
  if (diffMs < 172_800_000)return "어제";
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
};

const isPastDue = (date, done) => {
  if (!date || done) return false;
  const today = new Date(); today.setHours(0,0,0,0);
  return new Date(`${date}T00:00:00`) < today;
};

const formatDue = (date) => {
  if (!date) return "마감 없음";
  const d = new Date(`${date}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

const copyToClipboard = async (text) => {
  if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return; }
  const el = Object.assign(document.createElement("textarea"), {
    value: text, style: "position:fixed;top:-9999px",
  });
  document.body.appendChild(el);
  el.select();
  document.execCommand("copy");
  el.remove();
};

const getModelFallbacks = (model) => {
  const keys = AI_MODELS.map((m) => m.key);
  return keys.slice(Math.max(0, keys.indexOf(model)));
};

const normalizeModel = (model) =>
  AI_MODELS.some((m) => m.key === model) ? model : DEFAULT_AI_MODEL;

const extractText = (res) => {
  for (const c of res.candidates ?? []) {
    const t = (c.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
    if (t) return t;
  }
  return "";
};

const apiError = (status, errorText) => {
  let msg = errorText;
  try { const p = JSON.parse(errorText); msg = p?.error?.message || p?.message || errorText; } catch {}
  const n = msg.toLowerCase();
  if (n.includes("api key not valid") || n.includes("invalid api key")) return "API 키가 유효하지 않습니다.";
  if (n.includes("quota") || n.includes("rate limit") || n.includes("resource_exhausted")) return "API 사용량 한도 초과";
  if (n.includes("billing")) return "Google Cloud 결제 설정을 확인하세요.";
  if (n.includes("permission") || n.includes("forbidden")) return "API 키 권한을 확인하세요.";
  if (status === 400) return "API 키 또는 요청 형식 오류";
  if (status === 401) return "API 키 인증 실패";
  if (status === 403) return "API 키 권한 없음";
  if (status === 404 && n.includes("model")) return "선택한 모델 없음";
  if (status === 429) return "요청 한도 초과, 잠시 후 재시도";
  if (status >= 500) return "Gemini 서버 오류";
  return msg || `오류 ${status}`;
};

const correctKorean = async ({ apiKey, model, text, mode = "typo" }) => {
  const prompt = mode === "sentence"
    ? `You are a Korean writing editor. Read the following memo holistically and suggest a naturally improved version. Preserve all original ideas, facts, and intent — only improve flow, clarity, and sentence structure. Return ONLY the improved Korean text, no explanations.\n\n다음 메모를 맥락과 흐름을 고려해 자연스럽게 다듬어줘. 내용과 의미는 그대로 유지해.\n\n${text}`
    : `You proofread Korean quick-capture notes. Return only the fully corrected Korean text. Fix typos and spacing errors only. Preserve every idea, detail, line break, meaning, intent, and tone. Do not summarize, shorten, omit, add explanations, labels, quotation marks, markdown, or alternatives. If already correct, return it unchanged.\n\n오타와 띄어쓰기만 교정해줘. 절대 내용을 바꾸거나 줄이지 마.\n\n${text}`;

  let res;
  try {
    res = await fetch(
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
  } catch (e) {
    throw new Error(e instanceof TypeError ? "네트워크 연결을 확인하세요." : "API 호출 실패");
  }

  if (!res.ok) throw new Error(apiError(res.status, await res.text()));

  const data = await res.json();
  if ((data.candidates ?? []).some((c) => c.finishReason === "MAX_TOKENS"))
    throw new Error("결과가 너무 길어 중단됐습니다. 텍스트를 나눠서 교정하세요.");
  const corrected = extractText(data);
  if (!corrected) throw new Error("교정 결과가 비어 있습니다.");
  return corrected;
};

const imageToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = () => reject(new Error("이미지 읽기 실패"));
    reader.readAsDataURL(file);
  });

const extractTextFromImage = async ({ apiKey, model, file }) => {
  const base64 = await imageToBase64(file);
  const mimeType = file.type || "image/jpeg";
  let res;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: "이미지에서 텍스트를 모두 추출해줘. 레이아웃과 줄바꿈을 최대한 보존하고 텍스트만 반환해. 텍스트가 없으면 빈 문자열을 반환해." },
              { inline_data: { mime_type: mimeType, data: base64 } },
            ],
          }],
          generationConfig: { maxOutputTokens: 2048, temperature: 0.1 },
        }),
      },
    );
  } catch (e) {
    throw new Error(e instanceof TypeError ? "네트워크 연결을 확인하세요." : "API 호출 실패");
  }
  if (!res.ok) throw new Error(apiError(res.status, await res.text()));
  const data = await res.json();
  return extractText(data) ?? "";
};

// ─── CSS ─────────────────────────────────────────────────────────────────────

const CSS = `
  *, *::before, *::after { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body, #root { margin: 0; padding: 0; min-height: 100%; }

  body {
    background: #f0eeea;
    font-family: -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo',
                 'Pretendard', 'Noto Sans KR', system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
    color: #111;
  }

  button, input, textarea, select {
    font: inherit; border: none; outline: none;
    background: none; padding: 0; margin: 0; cursor: pointer;
  }

  textarea { resize: none; }

  :root {
    --bg:       #f0eeea;
    --surface:  #ffffff;
    --raised:   #f7f6f3;

    --t1: #111111;
    --t2: #555555;
    --t3: #999999;

    --border:   rgba(0,0,0,0.07);
    --border-2: rgba(0,0,0,0.13);

    --accent:      #5b21b6;
    --accent-bg:   #ede9fe;
    --accent-mid:  #7c3aed;

    --red:    #dc2626;
    --red-bg: #fee2e2;

    --amber:    #d97706;
    --amber-bg: #fffbeb;

    --green:    #16a34a;
    --green-bg: #f0fdf4;

    --sh1: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
    --sh2: 0 4px 16px rgba(0,0,0,0.07), 0 2px 6px rgba(0,0,0,0.04);
    --sh3: 0 12px 40px rgba(0,0,0,0.09), 0 4px 12px rgba(0,0,0,0.05);

    --r-s: 8px;
    --r-m: 14px;
    --r-l: 20px;
    --r-xl: 26px;
  }

  /* ── App ── */
  .app { min-height: 100vh; min-height: 100dvh; background: var(--bg); display: flex; justify-content: center; }

  /* ── 모바일 세로: flex 3단 (헤더 → 입력 → 목록) ── */
  .frame {
    display: flex;
    flex-direction: column;
    width: min(100vw, 430px);
    height: 100vh;
    height: 100dvh;
    overflow: hidden;
  }

  /* ── Header: flex 첫 번째 영역 ── */
  .hdr {
    flex-shrink: 0;
    width: 100%;
    padding-top: env(safe-area-inset-top);
    background: rgba(240,238,234,0.96);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border-bottom: 1px solid var(--border);
    transition: background 180ms ease;
    z-index: 10;
  }

  .hdr.compact { background: rgba(240,238,234,0.99); }

  .hdr-body {
    padding: 14px 16px 12px;
    display: flex; flex-direction: column; gap: 11px;
  }

  .hdr-top { display: flex; align-items: flex-start; justify-content: space-between; }

  .brand h1 {
    margin: 0;
    font-size: 22px; font-weight: 800;
    letter-spacing: -0.03em; line-height: 1.1;
    color: var(--t3);
  }
  .brand p {
    margin: 3px 0 0;
    font-size: 10px; font-weight: 700;
    letter-spacing: 0.08em; text-transform: uppercase;
    color: var(--t3);
  }

  .hdr.compact .brand h1 { font-size: 20px; }

  .gemini-badge {
    display: inline-flex; align-items: center; gap: 5px;
    height: 30px; padding: 0 11px;
    border-radius: 999px;
    background: var(--accent-bg); color: var(--accent);
    font-size: 11px; font-weight: 700;
  }

  /* ── Segment control ── */
  .seg {
    position: relative; display: grid; grid-template-columns: 1fr 1fr;
    height: 44px; padding: 3px;
    border-radius: var(--r-m);
    background: rgba(0,0,0,0.055);
    overflow: hidden;
  }

  .seg-thumb {
    position: absolute; top: 3px; left: 3px;
    width: calc(50% - 3px); height: calc(100% - 6px);
    border-radius: 11px;
    background: var(--surface);
    box-shadow: var(--sh1);
  }

  .seg button {
    position: relative; z-index: 1;
    display: flex; align-items: center; justify-content: center; gap: 6px;
    border-radius: 11px;
    font-size: 13px; font-weight: 600;
    color: var(--t3);
    min-height: 0; min-width: 0;
    transition: color 160ms ease;
  }
  .seg button.on { color: var(--t1); }

  /* ── Filter bar ── */
  .filter-bar { display: flex; align-items: center; gap: 6px; }

  .filter-bar svg { color: var(--t3); flex-shrink: 0; }

  .f-chip {
    height: 28px; padding: 0 12px; border-radius: 999px;
    font-size: 12px; font-weight: 600; color: var(--t2);
    background: rgba(0,0,0,0.045); border: 1px solid transparent;
    min-height: 0; min-width: 0;
    transition: background 130ms ease, color 130ms ease;
  }
  .f-chip.on { background: var(--accent-bg); color: var(--accent); border-color: rgba(91,33,182,0.15); }

  /* ── Tag filter strip (memo view) ── */
  .tag-filter-strip {
    display: flex; align-items: center; gap: 6px; margin-bottom: 12px;
    overflow-x: auto; scrollbar-width: none;
  }
  .tag-filter-strip::-webkit-scrollbar { display: none; }

  .tf-chip {
    display: inline-flex; align-items: center; gap: 5px;
    height: 28px; padding: 0 10px; border-radius: 999px;
    font-size: 11px; font-weight: 700;
    white-space: nowrap; flex-shrink: 0;
    border: 1.5px solid var(--border); color: var(--t2);
    background: var(--surface);
    min-height: 0; min-width: 0;
    transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
  }

  .tf-chip-dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }

  .tf-chip.on[data-tag="all"]    { background: var(--t1); color: #fff; border-color: var(--t1); }
  .tf-chip.on[data-tag="#업무"]   { background: #ede9fe; color: #5b21b6; border-color: rgba(124,58,237,0.3); }
  .tf-chip.on[data-tag="#아이디어"]{ background: #ecfeff; color: #0e7490; border-color: rgba(6,182,212,0.3); }
  .tf-chip.on[data-tag="#개인"]   { background: #fce7f3; color: #9d174d; border-color: rgba(236,72,153,0.25); }

  /* ── Scroll stage ── */
  /* ── Stage: flex 세 번째 영역 (스크롤 목록) ── */
  .stage {
    flex: 1;
    overflow-y: auto;
    scrollbar-width: none;
    padding: 14px 14px calc(16px + env(safe-area-inset-bottom));
    overscroll-behavior: contain;
  }
  .stage::-webkit-scrollbar { display: none; }

  /* ── Section label ── */
  .sec-label {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 10px;
  }
  .sec-label-text {
    font-size: 11px; font-weight: 700;
    letter-spacing: 0.06em; text-transform: uppercase; color: var(--t3);
  }
  .count-badge {
    display: flex; align-items: center;
    height: 20px; padding: 0 8px; border-radius: 999px;
    background: rgba(0,0,0,0.06);
    font-size: 11px; font-weight: 700; color: var(--t2);
  }

  /* ── Date group ── */
  .date-group { margin-bottom: 16px; }

  .date-group-label {
    font-size: 11px; font-weight: 700;
    letter-spacing: 0.04em; text-transform: uppercase;
    color: var(--t3); margin-bottom: 6px;
    padding: 0 2px;
  }

  /* ── Swipe shell (공통) ─────────────────────────────────
     swipe-wrap 하나만 overflow:hidden. 부모에는 절대 없애기.
     이렇게 해야 스와이프 시 swipe-bg가 제대로 드러남.
  ── */
  .memo-list { display: flex; flex-direction: column; gap: 8px; }

  .swipe-wrap {
    position: relative;
    overflow: hidden;
    border-radius: var(--r-l);
    isolation: isolate;
  }

  /* 삭제 배경: 스와이프 시 드러나는 영역 */
  .swipe-bg {
    position: absolute;
    inset: 0;
    background: var(--bg);   /* 중립색 — 핑크 대신 배경색 */
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding-right: 20px;
  }

  /* 휴지통 아이콘 - 빨간 원 안에 흰 아이콘 */
  .delete-icon-circle {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--red);
    display: grid;
    place-items: center;
    color: #fff;
    flex-shrink: 0;
  }

  /* ── Memo card (독립 카드, 그룹 없음) ── */
  .memo-card {
    position: relative;
    width: 100%;
    padding: 14px 16px;
    background: var(--surface);
    border-radius: var(--r-l);
    border: 1px solid var(--border);
    box-shadow: var(--sh1);
    touch-action: pan-y;
    text-align: left;
    /* layout shift 방지: height 변화를 자연스럽게 */
    transition: box-shadow 120ms ease;
  }

  .memo-card.is-editing {
    border-color: rgba(91,33,182,0.25);
    box-shadow: 0 0 0 3px rgba(91,33,182,0.06), var(--sh1);
  }

  .memo-top {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .memo-meta {
    display: flex; align-items: center; gap: 8px;
    flex: 1; min-width: 0;
  }

  .tag-badge {
    display: inline-flex; align-items: center; gap: 5px;
    height: 22px; padding: 0 9px; border-radius: 999px;
    font-size: 11px; font-weight: 700; flex-shrink: 0;
  }
  .tag-badge-dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }

  .memo-time {
    font-size: 11px; color: var(--t3);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    font-variant-numeric: tabular-nums;
  }

  /* 카드 액션 버튼 그룹 */
  .memo-actions {
    display: flex; align-items: center; gap: 4px; flex-shrink: 0;
  }

  .card-btn {
    display: grid; place-items: center;
    width: 30px; height: 30px;
    border-radius: var(--r-s);
    flex-shrink: 0; min-height: 0; min-width: 0;
    color: var(--t3); background: var(--raised);
    transition: background 110ms ease, color 110ms ease;
  }
  .card-btn:hover { background: rgba(0,0,0,0.08); }
  .card-btn.edit-btn:hover  { background: var(--accent-bg); color: var(--accent); }
  .card-btn.save-btn        { background: var(--accent-bg); color: var(--accent); }
  .card-btn.save-btn:hover  { background: var(--accent); color: #fff; }
  .card-btn.save-btn:active { background: #4c1d95; color: #fff; }
  .card-btn.del-btn:hover   { background: var(--red-bg); color: var(--red); }
  .card-btn.del-btn:active  { background: #fecaca; color: var(--red); }
  .card-btn.copy-btn.copied { background: var(--accent-bg); color: var(--accent); }

  /* 헤더 레이아웃 토글 버튼 */
  .layout-toggle-btn {
    display: inline-flex; align-items: center; justify-content: center;
    width: 32px; height: 32px; border-radius: 50%;
    background: rgba(0,0,0,0.05); color: var(--t2);
    transition: background 120ms ease, color 120ms ease;
    flex-shrink: 0;
  }
  .layout-toggle-btn:hover { background: rgba(0,0,0,0.09); color: var(--t1); }
  .layout-toggle-btn.landscape-active { background: var(--accent-bg); color: var(--accent); }

  .memo-body {
    margin: 0;
    font-size: 14px; font-weight: 400; line-height: 1.65;
    color: var(--t1); overflow-wrap: anywhere;
  }

  .memo-body.truncated {
    display: -webkit-box;
    -webkit-line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .expand-btn {
    display: inline-flex; align-items: center; gap: 3px;
    margin-top: 6px;
    font-size: 12px; font-weight: 600; color: var(--accent);
    background: none; min-height: 0; min-width: 0;
    padding: 0;
  }

  .memo-editor {
    width: 100%; margin-top: 2px;
    padding: 10px 12px;
    border: 1.5px solid rgba(91,33,182,0.3);
    border-radius: var(--r-s);
    background: var(--accent-bg);
    color: var(--t1); font-size: 14px; line-height: 1.65;
    caret-color: var(--accent); min-height: 80px;
    resize: none;
  }

  /* ── Action list ── */
  .action-list { display: flex; flex-direction: column; gap: 8px; }

  /* ── Progress bar ── */
  .progress-bar-wrap { margin-bottom: 12px; }
  .progress-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 6px;
  }
  .progress-label { font-size: 12px; font-weight: 600; color: var(--t2); }
  .progress-pct { font-size: 12px; font-weight: 700; color: var(--accent); }

  .progress-track {
    height: 6px; border-radius: 999px;
    background: rgba(0,0,0,0.07); overflow: hidden;
  }
  .progress-fill {
    height: 100%; border-radius: 999px;
    background: linear-gradient(90deg, var(--accent-mid), var(--accent));
    transition: width 400ms ease;
  }

  /* ── Action card ── */
  .action-card {
    position: relative; display: flex; align-items: center; gap: 12px;
    padding: 12px 14px 14px;
    background: var(--surface);
    border-radius: var(--r-l);
    border: 1px solid var(--border);
    box-shadow: var(--sh1);
    touch-action: pan-y;
    /* layout="position" 없이도 자연스럽게 */
    transition: opacity 200ms ease, box-shadow 120ms ease;
  }
  .action-card.hi { border-left: 3px solid #f59e0b; }
  .action-card.done { opacity: 0.38; }

  /* ── Checkbox ── */
  .chk {
    flex-shrink: 0; width: 24px; height: 24px; margin-top: 1px;
    border-radius: 6px; border: 2px solid var(--border-2);
    background: var(--surface); display: grid; place-items: center;
    color: transparent; min-height: 0; min-width: 0;
    transition: background 180ms ease, border-color 180ms ease, color 180ms ease;
  }
  .chk.checked { background: var(--accent); border-color: var(--accent); color: #fff; }

  .action-body { flex: 1; min-width: 0; }

  .action-text {
    margin: 0 0 6px;
    font-size: 14px; font-weight: 500; line-height: 1.55;
    color: var(--t1); overflow-wrap: anywhere;
  }
  .action-card.done .action-text { text-decoration: line-through; color: var(--t3); }

  .action-meta { display: flex; align-items: center; gap: 6px; flex-wrap: nowrap; overflow: hidden; }

  .m-chip {
    display: inline-flex; align-items: center; gap: 3px;
    height: 20px; padding: 0 7px; border-radius: 999px;
    font-size: 10px; font-weight: 600;
    color: var(--t3); background: var(--raised); border: 1px solid var(--border);
    white-space: nowrap; flex-shrink: 0;
  }
  .m-chip.overdue { color: var(--amber); background: var(--amber-bg); border-color: rgba(217,119,6,0.2); }
  .m-chip.hi-pill { color: var(--amber); background: var(--amber-bg); border-color: rgba(217,119,6,0.2); }

  /* ── Empty state ── */
  .empty {
    min-height: 260px;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 14px; text-align: center;
  }
  .empty-icon {
    width: 54px; height: 54px;
    border-radius: var(--r-l);
    background: var(--accent-bg); color: var(--accent);
    display: grid; place-items: center;
  }
  .empty p {
    margin: 0; font-size: 14px; font-weight: 500;
    color: var(--t3); line-height: 1.6; max-width: 220px;
  }

  /* ── Skeleton ── */
  .skel-wrap { display: flex; flex-direction: column; gap: 8px; }
  .skel {
    border-radius: var(--r-l);
    background: linear-gradient(90deg, rgba(0,0,0,0.04) 25%, rgba(0,0,0,0.07) 50%, rgba(0,0,0,0.04) 75%);
    background-size: 300% 100%;
    animation: skel 1.3s ease-in-out infinite;
  }
  @keyframes skel { 0% { background-position: 120% 0; } 100% { background-position: -120% 0; } }

  /* ── Composer (bottom sheet) ── */
  /* ── Composer: flex 두 번째 영역 (입력 영역) ── */
  .composer {
    flex-shrink: 0;
    width: 100%;
    padding: 12px 16px 14px;
    background: #fff;
    border-bottom: 1px solid var(--border);
    /* 아래쪽 그림자 → 목록과 입력 영역 분리감 */
    box-shadow: 0 3px 14px rgba(0,0,0,0.05);
    z-index: 5;
  }

  /* 핸들바: flex 중간 패널에서는 숨김 */
  .handle { display: none; }

  /* Tag selector */
  .tag-row { display: flex; gap: 6px; margin-bottom: 10px; }

  .tag-btn {
    flex: 1; height: 38px; border-radius: var(--r-s);
    font-size: 12px; font-weight: 700;
    color: var(--t2); background: var(--raised);
    border: 1.5px solid var(--border);
    min-height: 0; min-width: 0;
    transition: background 130ms ease, color 130ms ease, border-color 130ms ease;
  }
  .tag-btn.on[data-tag="#업무"]    { background: #ede9fe; color: #5b21b6; border-color: rgba(124,58,237,0.28); }
  .tag-btn.on[data-tag="#아이디어"] { background: #ecfeff; color: #0e7490; border-color: rgba(6,182,212,0.28); }
  .tag-btn.on[data-tag="#개인"]    { background: #fce7f3; color: #9d174d; border-color: rgba(236,72,153,0.25); }

  /* Textarea composer */
  .textarea-wrap {
    position: relative;
    border-radius: var(--r-m); border: 1.5px solid var(--border);
    background: var(--raised);
    transition: border-color 160ms ease, box-shadow 160ms ease;
  }
  .textarea-wrap:focus-within {
    border-color: rgba(91,33,182,0.35);
    box-shadow: 0 0 0 3px rgba(91,33,182,0.06);
    background: #fff;
  }

  .composer-textarea {
    width: 100%; min-height: 52px; max-height: 160px;
    padding: 14px 16px 10px;
    font-size: 15px; font-weight: 400; line-height: 1.5;
    color: var(--t1); overflow-y: auto;
    caret-color: var(--accent);
    display: block;
  }
  .composer-textarea::placeholder { color: var(--t3); }

  .textarea-footer {
    display: flex; align-items: center; justify-content: space-between;
    padding: 6px 10px 8px;
  }

  .char-hint {
    font-size: 11px; color: var(--t3);
    font-variant-numeric: tabular-nums;
  }

  .btn-row { display: flex; align-items: center; gap: 6px; }

  .icon-btn {
    display: grid; place-items: center;
    width: 36px; height: 36px;
    border-radius: var(--r-s);
    flex-shrink: 0; min-height: 0; min-width: 0;
  }

  .btn-ai {
    color: var(--accent); background: var(--accent-bg);
    transition: background 120ms ease, opacity 120ms ease;
  }
  .btn-ai:disabled { opacity: 0.3; cursor: default; }
  .btn-ai.spinning svg { animation: spin 0.7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .btn-clear {
    color: var(--t3); background: var(--raised);
  }

  .btn-camera {
    color: var(--t2); background: var(--raised);
    transition: background 120ms ease, color 120ms ease;
  }
  .btn-camera:hover  { background: rgba(0,0,0,0.08); color: var(--t1); }
  .btn-camera:disabled { opacity: 0.3; cursor: default; }
  .btn-camera.scanning svg { animation: spin 0.9s linear infinite; }

  .btn-submit {
    width: 36px; height: 36px; border-radius: 50%;
    background: var(--accent); color: #fff;
    box-shadow: 0 2px 8px rgba(91,33,182,0.28);
    transition: transform 120ms ease, background 120ms ease, box-shadow 120ms ease;
  }
  .btn-submit:hover { background: var(--accent-mid); }
  .btn-submit:active { transform: scale(0.9); background: #4c1d95; box-shadow: none; }
  .btn-submit:disabled { opacity: 0.25; cursor: default; box-shadow: none; }

  /* Action controls */
  .action-ctrl { display: flex; gap: 8px; margin-bottom: 10px; }

  .ctrl {
    flex: 1; height: 38px;
    display: flex; align-items: center; justify-content: center; gap: 6px;
    border-radius: var(--r-s);
    font-size: 12px; font-weight: 600;
    color: var(--t2); background: var(--raised); border: 1.5px solid var(--border);
    min-height: 0; min-width: 0;
    transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
  }
  .ctrl.hi-on { background: var(--amber-bg); color: var(--amber); border-color: rgba(217,119,6,0.25); }
  .ctrl input[type="date"] {
    font-size: 12px; font-weight: 600; color: var(--t1);
    color-scheme: light; cursor: pointer; flex: 1; text-align: center;
  }

  /* AI 처리 유형 선택 칩 (메모 전용) */
  .ai-mode-row {
    display: flex; align-items: center; gap: 5px; margin-top: 8px;
  }
  .ai-mode-chip {
    display: inline-flex; align-items: center; gap: 3px;
    height: 24px; padding: 0 10px; border-radius: 999px;
    font-size: 11px; font-weight: 600;
    color: var(--t3); background: var(--raised); border: 1px solid var(--border);
    white-space: nowrap; min-height: 0; min-width: 0;
    transition: background 110ms ease, color 110ms ease, border-color 110ms ease;
  }
  .ai-mode-chip.on {
    background: var(--accent-bg); color: var(--accent);
    border-color: rgba(91,33,182,0.22);
  }

  /* AI row */
  .ai-row {
    display: flex; align-items: center; justify-content: space-between;
    gap: 8px; margin-top: 10px;
  }

  /* 문장 교정 모달 */
  .correction-overlay {
    position: fixed; inset: 0; z-index: 200;
    background: rgba(0,0,0,0.36);
    display: flex; align-items: center; justify-content: center;
    padding: 24px;
  }
  .correction-modal {
    width: 100%; max-width: 500px;
    background: var(--surface);
    border-radius: 20px;
    box-shadow: 0 24px 60px rgba(0,0,0,0.18);
    display: flex; flex-direction: column;
    overflow: hidden;
  }
  .correction-modal-hdr {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 18px 12px;
    border-bottom: 1px solid var(--border);
  }
  .correction-modal-hdr h2 {
    margin: 0; font-size: 14px; font-weight: 700; color: var(--t1);
  }
  .correction-modal-hdr h2 span {
    font-weight: 400; color: var(--t3); font-size: 12px; margin-left: 6px;
  }
  .correction-close-btn {
    display: grid; place-items: center;
    width: 28px; height: 28px; border-radius: 50%;
    color: var(--t3); background: var(--raised);
    transition: background 110ms ease;
  }
  .correction-close-btn:hover { background: rgba(0,0,0,0.08); }
  .correction-body {
    padding: 14px 18px; display: flex; flex-direction: column; gap: 10px;
    overflow-y: auto; max-height: 55vh;
  }
  .correction-label {
    font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
    text-transform: uppercase; color: var(--t3); margin: 0 0 5px;
  }
  .correction-text {
    margin: 0; font-size: 13.5px; line-height: 1.65;
    color: var(--t1); white-space: pre-wrap; overflow-wrap: anywhere;
  }
  .correction-box {
    padding: 11px 13px; border-radius: 12px;
  }
  .correction-box.original  { background: var(--raised); }
  .correction-box.suggested { background: var(--accent-bg); border: 1px solid rgba(91,33,182,0.15); }
  .correction-arrow { text-align: center; font-size: 14px; color: var(--t3); line-height: 1; }
  .correction-footer {
    display: flex; gap: 8px; padding: 12px 18px 16px;
    border-top: 1px solid var(--border);
  }
  .correction-apply-btn {
    flex: 1; height: 38px; border-radius: 999px;
    background: var(--accent); color: #fff;
    font-size: 13px; font-weight: 700;
    display: flex; align-items: center; justify-content: center;
    min-height: 0; transition: background 110ms ease;
  }
  .correction-apply-btn:active { background: #4c1d95; }
  .correction-cancel-btn {
    height: 38px; padding: 0 18px; border-radius: 999px;
    background: var(--raised); color: var(--t2);
    border: 1px solid var(--border);
    font-size: 13px; font-weight: 600;
    display: flex; align-items: center; justify-content: center;
    min-height: 0;
  }
  .correction-cancel-btn:active { opacity: 0.7; }

  .ai-key-btn {
    display: flex; align-items: center; gap: 5px;
    height: 26px; padding: 0 10px; border-radius: 999px;
    font-size: 11px; font-weight: 700;
    color: var(--t2); background: var(--raised); border: 1px solid var(--border);
    min-height: 0; min-width: 0; white-space: nowrap;
  }

  .ai-msg {
    font-size: 11px; font-weight: 600; color: var(--t3);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    min-width: 0; background: none; min-height: 0; cursor: pointer;
  }
  .ai-msg.loading, .ai-msg.success { color: var(--accent); }
  .ai-msg.error { color: var(--red); }

  /* AI panel */
  .ai-panel {
    display: grid; grid-template-columns: 1fr 148px; gap: 8px;
    overflow: hidden; margin-top: 10px;
  }
  .ai-panel input,
  .ai-panel select {
    height: 40px; padding: 0 12px;
    border-radius: var(--r-s); border: 1.5px solid var(--border);
    background: var(--raised); font-size: 12px; font-weight: 500;
    color: var(--t1); min-width: 0;
    transition: border-color 140ms ease;
  }
  .ai-panel input:focus, .ai-panel select:focus { border-color: rgba(91,33,182,0.3); }

  /* ── Toast ── */
  .toast {
    position: fixed; z-index: 60;
    bottom: calc(env(safe-area-inset-bottom) + 16px);
    left: 50%; transform: translateX(-50%);
    width: min(calc(100vw - 32px), 380px);
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 0 16px;
    height: 52px;
    border-radius: var(--r-l);
    background: #1a1a1a; color: #fff;
    box-shadow: var(--sh3);
    pointer-events: all;
  }

  .toast-msg { font-size: 13px; font-weight: 500; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .toast-undo {
    display: flex; align-items: center; gap: 5px;
    height: 32px; padding: 0 12px; border-radius: 999px;
    background: rgba(255,255,255,0.15); color: #fff;
    font-size: 12px; font-weight: 700;
    flex-shrink: 0; min-height: 0; min-width: 0;
    transition: background 120ms ease;
  }
  .toast-undo:hover { background: rgba(255,255,255,0.22); }

  /* ── Error modal ── */
  .err-overlay {
    position: fixed; z-index: 70;
    inset: 0;
    display: flex; align-items: center; justify-content: center;
    padding: 24px;
    background: rgba(0,0,0,0.42);
  }

  .err-modal {
    width: min(calc(100vw - 40px), 430px);
    display: flex; flex-direction: column; align-items: center; gap: 14px;
    padding: 28px 22px 22px;
    border-radius: 22px;
    background: var(--surface); color: var(--t1);
    border: 1px solid rgba(220,38,38,0.18);
    box-shadow: var(--sh3);
    text-align: center;
  }

  .err-modal-icon {
    width: 42px; height: 42px; border-radius: 50%;
    display: grid; place-items: center;
    color: var(--red); background: var(--red-bg);
  }
  .err-modal-title { margin: 0; font-size: 18px; font-weight: 800; }
  .err-modal-msg { margin: 0; font-size: 14px; color: var(--t2); line-height: 1.6; overflow-wrap: anywhere; }
  .err-modal-model {
    width: 100%;
    margin: 2px 0 0; padding: 11px 13px;
    border-radius: var(--r-s);
    color: var(--t2); background: var(--raised);
    font-size: 12px; font-weight: 600; font-family: ui-monospace, monospace;
    overflow-wrap: anywhere;
  }
  .err-modal-close {
    width: 100%; height: 42px; margin-top: 2px;
    border-radius: 999px;
    background: var(--accent); color: #fff;
    font-size: 14px; font-weight: 800;
    min-height: 0; min-width: 0;
    transition: background 110ms ease;
  }
  .err-modal-close:active { background: #4c1d95; }

  /* ── Hover states ── */
  @media (hover: hover) {
    .copy-btn:hover { background: var(--accent-bg); color: var(--accent); }
    .memo-card:hover { background: var(--raised); }
    .action-card:hover { border-color: rgba(91,33,182,0.14); }
    .tag-btn:hover:not(.on) { background: rgba(0,0,0,0.07); }
    .ctrl:hover:not(.hi-on) { background: rgba(0,0,0,0.06); }
  }

  /* ── 강제 레이아웃 토글 (헤더 버튼) ── */

  /* 강제 가로모드: .app은 세로 중앙 정렬 + 상하 패딩 */
  .app:has(.frame.force-landscape) {
    align-items: center;
    padding: 24px 32px;
    box-sizing: border-box;
  }

  /* 가로 모드: 2열 그리드 — 좌(헤더+목록) | 우(입력) */
  .frame.force-landscape {
    display: grid !important;
    flex-direction: unset !important;
    width: 100% !important;
    max-width: 1080px !important;
    height: calc(100dvh - 48px) !important;
    border-radius: 20px !important;
    border: 1px solid var(--border-2);
    box-shadow: var(--sh3);
    overflow: hidden;
    grid-template-columns: 1fr 420px;
    grid-template-rows: auto 1fr;
    grid-template-areas:
      "hdr      composer"
      "stage    composer";
    background: var(--bg);
  }

  /* 가로 모드: 헤더(좌상단) — 일반 헤더처럼 가로로 */
  .frame.force-landscape .hdr {
    grid-area: hdr;
    width: 100%; height: auto;
    padding-top: 0;
    border-bottom: 1px solid var(--border);
    border-right: none;
    border-radius: 0;
    background: var(--bg);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    overflow: visible;
  }
  .frame.force-landscape .hdr .hdr-body {
    height: auto;
    padding: 14px 16px 12px;
    display: flex;
    flex-direction: column;
    gap: 11px;
  }

  /* 가로 모드: 목록(좌하단) */
  .frame.force-landscape .stage {
    grid-area: stage;
    flex: none;
    width: 100%;
    height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 16px 20px;
    background: var(--bg);
  }
  .frame.force-landscape .memo-list,
  .frame.force-landscape .action-list,
  .frame.force-landscape .skel-wrap {
    max-width: none;
  }

  /* 가로 모드: 입력 패널(우측 전체) */
  .frame.force-landscape .composer {
    grid-area: composer;
    width: 100%; height: 100%;
    border-top: none; border-bottom: none;
    border-left: 1px solid var(--border-2);
    border-radius: 0;
    box-shadow: none;
    background: var(--surface);
    padding: 20px 18px;
    overflow-y: auto;
    overflow-x: hidden;
  }
  .frame.force-landscape .handle { display: none; }
  /* 날짜·긴급성 컨트롤 — landscape media query의 column 방향을 row로 되돌림 */
  .frame.force-landscape .action-ctrl { flex-direction: row !important; }

  /* 세로 모드: 미디어쿼리 landscape 규칙 강제 취소 */
  .frame.force-portrait {
    display: flex !important;
    flex-direction: column !important;
    width: min(100vw, 430px) !important;
    height: 100dvh !important;
    max-width: none !important;
    border-radius: 0 !important;
    overflow: hidden;
    grid-template-columns: unset !important;
    grid-template-areas: unset !important;
    background: transparent;
  }
  .frame.force-portrait .hdr {
    grid-area: unset !important;
    width: 100% !important; height: auto !important;
    border-right: none;
    border-bottom: 1px solid var(--border);
    overflow: visible;
  }
  .frame.force-portrait .hdr .hdr-body {
    height: auto !important;
    padding: 14px 16px 12px !important;
    display: flex !important;
    flex-direction: column !important;
    gap: 11px !important;
  }
  .frame.force-portrait .stage {
    grid-area: unset !important;
    flex: 1 !important;
    width: 100% !important; height: auto !important;
    padding: 14px 14px calc(16px + env(safe-area-inset-bottom)) !important;
  }
  .frame.force-portrait .composer {
    grid-area: unset !important;
    flex-shrink: 0 !important;
    width: 100% !important; height: auto !important;
    border-left: none;
    border-top: none;
    border-bottom: 1px solid var(--border);
    box-shadow: 0 3px 14px rgba(0,0,0,0.05);
    padding: 12px 16px 14px !important;
    overflow: visible !important;
  }
  .frame.force-portrait .memo-list,
  .frame.force-portrait .action-list,
  .frame.force-portrait .skel-wrap {
    max-width: none;
  }
  .frame.force-portrait .action-ctrl { flex-direction: row !important; }
`;

// ─── Sub-components ───────────────────────────────────────────────────────────

function TagBadge({ tag }) {
  const s = TAG_STYLES[tag] ?? { bg: "#f3f4f6", color: "#6b7280", dot: "#9ca3af" };
  return (
    <span className="tag-badge" style={{ background: s.bg, color: s.color }}>
      <span className="tag-badge-dot" style={{ background: s.dot }} />
      {tag}
    </span>
  );
}

function Header({ activeView, setActiveView, actionFilter, setActionFilter, compact, layoutMode, onToggleLayout }) {
  const isLandscape = layoutMode === "landscape";
  return (
    <header className={`hdr${compact ? " compact" : ""}`}>
      <div className="hdr-body">
        <div className="hdr-top">
          <div className="brand">
            <h1>Intelligent Memo</h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              type="button"
              className={`layout-toggle-btn${isLandscape ? " landscape-active" : ""}`}
              onClick={onToggleLayout}
              aria-label={isLandscape ? "세로 모드로 전환" : "가로 모드로 전환"}
              title={isLandscape ? "세로 모드" : "가로 모드"}
            >
              {isLandscape ? <Smartphone size={15} /> : <Monitor size={15} />}
            </button>
            <span className="gemini-badge">
              <Sparkles size={11} />
              Gemini AI
            </span>
          </div>
        </div>

        <div className="seg" role="tablist">
          <motion.div
            className="seg-thumb"
            animate={{ x: activeView === "memos" ? 0 : "100%" }}
            transition={{ type: "spring", stiffness: 440, damping: 38 }}
          />
          <button
            type="button"
            className={activeView === "memos" ? "on" : ""}
            onClick={() => setActiveView("memos")}
            role="tab"
            aria-selected={activeView === "memos"}
          >
            <MessageSquareText size={14} />
            메모
          </button>
          <button
            type="button"
            className={activeView === "actions" ? "on" : ""}
            onClick={() => setActiveView("actions")}
            role="tab"
            aria-selected={activeView === "actions"}
          >
            <CheckCircle2 size={14} />
            액션
          </button>
        </div>

        <AnimatePresence initial={false}>
          {activeView === "actions" && (
            <motion.div
              className="filter-bar"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <ListFilter size={13} />
              {ACTION_FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={`f-chip${actionFilter === f.key ? " on" : ""}`}
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
    <div className="skel-wrap">
      {[82, 104, 68, 94, 76].map((h, i) => (
        <div key={i} className="skel" style={{ height: h }} />
      ))}
    </div>
  );
}

function EmptyState({ type }) {
  return (
    <motion.div
      className="empty"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 26 }}
    >
      <div className="empty-icon">
        <Sparkles size={22} />
      </div>
      <p>{type === "memos" ? "생각이 떠오르면 바로 기록하세요" : "할 일을 추가해 보세요"}</p>
    </motion.div>
  );
}

function MemoCard({ memo, index, tick, onDelete, onEdit }) {
  const [editing,  setEditing]  = useState(false);
  const [draft,    setDraft]    = useState(memo.text);
  const [copied,   setCopied]   = useState(false);
  const [expanded, setExpanded] = useState(false);
  const editorRef   = useRef(null);

  const isLong = memo.text.split("\n").length > 4 || memo.text.length > 200;

  useEffect(() => {
    if (editing) {
      const el = editorRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [editing]);

  useEffect(() => {
    if (!editing) setDraft(memo.text);
  }, [editing, memo.text]);

  const commit = () => {
    const t = draft.trim();
    if (t) onEdit(memo.id, t);
    setEditing(false);
  };

  const cancelEdit = () => {
    setDraft(memo.text);
    setEditing(false);
  };

  const handleCopy = async (e) => {
    e.stopPropagation();
    try {
      await copyToClipboard(memo.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {}
  };

  const stopProp = (e) => e.stopPropagation();

  return (
    // swipe-wrap: 단일 overflow:hidden 레이어
    <div className="swipe-wrap">
      {/* 삭제 배경: 편집 중에는 숨김 (스와이프 불가 + 핑크 노출 방지) */}
      {!editing && (
        <div className="swipe-bg">
          <div className="delete-icon-circle">
            <Trash2 size={17} />
          </div>
        </div>
      )}

      {/* 카드: drag로 왼쪽 밀기 → 삭제 */}
      <motion.article
        drag={editing ? false : "x"}          /* 편집 중 드래그 비활성 */
        dragConstraints={{ left: -80, right: 0 }}
        dragElastic={{ left: 0.1, right: 0 }}
        dragMomentum={false}
        onDragEnd={(_, info) => {
          if (info.offset.x < -60 || info.velocity.x < -400) onDelete(memo.id);
        }}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, x: -60 }}
        transition={{ duration: 0.22, delay: index * 0.018, ease: [0.2, 0, 0, 1] }}
        className={`memo-card${editing ? " is-editing" : ""}`}
      >
        {/* 상단 행: 태그 / 시간 / 액션버튼들 */}
        <div className="memo-top">
          <div className="memo-meta">
            <TagBadge tag={memo.tag} />
            <time className="memo-time">{relativeTime(memo.createdAt, tick)}</time>
          </div>
          <div className="memo-actions">
            {editing ? (
              <>
                <button
                  type="button"
                  className="card-btn save-btn"
                  onClick={commit}
                  aria-label="저장"
                >
                  <Check size={13} />
                </button>
                <button
                  type="button"
                  className="card-btn"
                  onClick={cancelEdit}
                  aria-label="취소"
                >
                  <X size={13} />
                </button>
              </>
            ) : (
              <button
                type="button"
                className="card-btn edit-btn"
                onClick={(e) => { stopProp(e); setEditing(true); }}
                aria-label="메모 편집"
              >
                <Pencil size={13} />
              </button>
            )}
            <button
              type="button"
              className="card-btn del-btn"
              onClick={(e) => { stopProp(e); onDelete(memo.id); }}
              aria-label="메모 삭제"
            >
              <Trash2 size={13} />
            </button>
            <button
              type="button"
              className={`card-btn copy-btn${copied ? " copied" : ""}`}
              onClick={handleCopy}
              aria-label={copied ? "복사됨" : "메모 복사"}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
          </div>
        </div>

        {/* 본문 영역 */}
        {editing ? (
          <textarea
            ref={editorRef}
            className="memo-editor"
            value={draft}
            rows={Math.min(10, Math.max(3, draft.split("\n").length + 1))}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
              if (e.key === "Escape") cancelEdit();
            }}
          />
        ) : (
          <>
            <p className={`memo-body${isLong && !expanded ? " truncated" : ""}`}>
              {memo.text}
            </p>
            {isLong && (
              <button
                type="button"
                className="expand-btn"
                onClick={(e) => { stopProp(e); setExpanded((v) => !v); }}
              >
                {expanded ? "접기 ↑" : "더 보기 ↓"}
              </button>
            )}
          </>
        )}
      </motion.article>
    </div>
  );
}

function ActionCard({ action, index, onToggle, onDelete }) {
  const overdue = isPastDue(action.dueDate, action.done);
  const isHigh  = action.priority === "high";

  return (
    <div className="swipe-wrap">
      {/* 삭제 배경 */}
      <div className="swipe-bg">
        <div className="delete-icon-circle">
          <Trash2 size={17} />
        </div>
      </div>

      <motion.article
        drag="x"
        dragConstraints={{ left: -80, right: 0 }}
        dragElastic={{ left: 0.1, right: 0 }}
        dragMomentum={false}
        onDragEnd={(_, info) => {
          if (info.offset.x < -60 || info.velocity.x < -400) onDelete(action.id);
        }}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, x: -60 }}
        transition={{ duration: 0.22, delay: index * 0.018, ease: [0.2, 0, 0, 1] }}
        className={`action-card${action.done ? " done" : ""}${isHigh ? " hi" : ""}`}
      >
        {/* 체크박스: 클릭 시 토글, 드래그와 분리 */}
        <button
          type="button"
          className={`chk${action.done ? " checked" : ""}`}
          onClick={() => onToggle(action.id)}
          aria-label={action.done ? "완료 취소" : "완료 처리"}
        >
          {action.done && (
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <motion.path
                d="M2 7l3.5 3.5L12 3"
                stroke="currentColor" strokeWidth="2.2"
                strokeLinecap="round" strokeLinejoin="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
              />
            </svg>
          )}
        </button>

        <div className="action-body">
          <p className="action-text">{action.text}</p>
          <div className="action-meta">
            <span className={`m-chip${overdue ? " overdue" : ""}`}>
              <CalendarDays size={10} />
              {formatDue(action.dueDate)}
            </span>
            <span className={`m-chip${isHigh ? " hi-pill" : ""}`}>
              <Flame size={10} />
              {isHigh ? "높음" : "보통"}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="card-btn del-btn"
          onClick={(e) => { e.stopPropagation(); onDelete(action.id); }}
          aria-label="액션 삭제"
        >
          <Trash2 size={13} />
        </button>
      </motion.article>
    </div>
  );
}

function ActionProgress({ actions }) {
  if (actions.length === 0) return null;
  const done = actions.filter((a) => a.done).length;
  const pct  = Math.round((done / actions.length) * 100);

  return (
    <div className="progress-bar-wrap">
      <div className="progress-header">
        <span className="progress-label">{done}/{actions.length} 완료</span>
        <span className="progress-pct">{pct}%</span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function TagFilterStrip({ selected, onChange, tags }) {
  return (
    <div className="tag-filter-strip">
      <button
        type="button"
        data-tag="all"
        className={`tf-chip${selected === "all" ? " on" : ""}`}
        onClick={() => onChange("all")}
      >
        전체
      </button>
      {tags.map((tag) => {
        const s = TAG_STYLES[tag];
        return (
          <button
            key={tag}
            type="button"
            data-tag={tag}
            className={`tf-chip${selected === tag ? " on" : ""}`}
            onClick={() => onChange(tag)}
          >
            {selected !== tag && s && (
              <span className="tf-chip-dot" style={{ background: s.dot }} />
            )}
            {tag}
          </button>
        );
      })}
    </div>
  );
}

// Auto-resizing textarea helper
function useAutoResize(ref, value) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [ref, value]);
}

function Composer({
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
  const memoRef   = useRef(null);
  const actionRef = useRef(null);
  const cameraRef = useRef(null);
  const [aiOpen,   setAiOpen]   = useState(false);
  const [aiMode,   setAiMode]   = useState("typo"); // "typo" | "sentence"
  const [ocrState, setOcrState] = useState("idle"); // "idle" | "scanning" | "error"

  const correcting = aiStatus.state === "loading";

  const handleCameraClick = () => {
    if (!aiSettings.apiKey) { setAiOpen(true); return; }
    cameraRef.current?.click();
  };

  const handleImageSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setOcrState("scanning");
    try {
      const extracted = await extractTextFromImage({
        apiKey: aiSettings.apiKey,
        model: aiSettings.model || "gemini-2.5-flash",
        file,
      });
      if (!extracted.trim()) {
        setOcrState("error");
        setTimeout(() => setOcrState("idle"), 2000);
        return;
      }
      setMemoText((prev) => prev ? `${prev}\n${extracted}` : extracted);
      setOcrState("idle");
    } catch {
      setOcrState("error");
      setTimeout(() => setOcrState("idle"), 2500);
    }
  };
  const draftText  = activeView === "memos" ? memoText : actionText;
  const hasText    = draftText.trim().length > 0;

  useAutoResize(memoRef,   memoText);
  useAutoResize(actionRef, actionText);

  useEffect(() => {
    if (aiStatus.state === "error") setAiOpen(true);
  }, [aiStatus.state]);

  // Focus input on view switch
  useEffect(() => {
    const ref = activeView === "memos" ? memoRef : actionRef;
    ref.current?.focus({ preventScroll: true });
  }, [activeView]);

  const clearDraft = () => {
    if (activeView === "memos") setMemoText("");
    else setActionText("");
  };

  return (
    <motion.form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        activeView === "memos" ? onAddMemo() : onAddAction();
      }}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
    >
      <div className="handle" />

      <AnimatePresence mode="wait" initial={false}>
        {activeView === "memos" ? (
          <motion.div
            key="memo"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.13 }}
          >
            <div className="tag-row">
              {TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  data-tag={tag}
                  className={`tag-btn${selectedTag === tag ? " on" : ""}`}
                  onClick={() => setSelectedTag(tag)}
                >
                  {tag}
                </button>
              ))}
            </div>
            <div className="textarea-wrap">
              <textarea
                ref={memoRef}
                className="composer-textarea"
                value={memoText}
                rows={1}
                onChange={(e) => setMemoText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    onAddMemo();
                  }
                }}
                placeholder="생각을 빠르게 메모하세요…"
              />
              <div className="textarea-footer">
                <span className="char-hint">
                  {ocrState === "scanning" ? "이미지 텍스트 추출 중…"
                    : ocrState === "error"  ? "텍스트를 찾을 수 없음"
                    : memoText.length > 0  ? `${memoText.length}자 · ⌘↵ 저장`
                    : "⌘↵ 저장"}
                </span>
                <div className="btn-row">
                  {hasText && (
                    <button
                      type="button"
                      className="icon-btn btn-clear"
                      onClick={clearDraft}
                      aria-label="지우기"
                    >
                      <X size={15} />
                    </button>
                  )}
                  <button
                    type="button"
                    className={`icon-btn btn-camera${ocrState === "scanning" ? " scanning" : ""}`}
                    disabled={ocrState === "scanning" || correcting}
                    onClick={handleCameraClick}
                    aria-label="카메라 OCR"
                    title="사진에서 텍스트 추출"
                  >
                    <Camera size={16} />
                  </button>
                  <button
                    type="button"
                    className={`icon-btn btn-ai${correcting ? " spinning" : ""}`}
                    disabled={!hasText || correcting}
                    onClick={() => onCorrectDraft(activeView, () => setAiOpen(true), aiMode)}
                    aria-label="AI 교정"
                    title={aiMode === "sentence" ? "문장 교정 제안" : "오타·띄어쓰기 교정"}
                  >
                    <Sparkles size={16} />
                  </button>
                  <button
                    type="submit"
                    className="icon-btn btn-submit"
                    disabled={!hasText}
                    aria-label="메모 추가"
                  >
                    <ArrowUp size={16} strokeWidth={2.5} />
                  </button>
                  <input
                    ref={cameraRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    style={{ display: "none" }}
                    onChange={handleImageSelect}
                  />
                </div>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="action"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.13 }}
          >
            <div className="action-ctrl">
              <label className="ctrl" style={{ cursor: "pointer" }}>
                <CalendarDays size={14} />
                <input
                  type="date"
                  value={actionDueDate}
                  onChange={(e) => setActionDueDate(e.target.value)}
                />
              </label>
              <button
                type="button"
                className={`ctrl${actionPriority === "high" ? " hi-on" : ""}`}
                onClick={() => setActionPriority((v) => (v === "high" ? "normal" : "high"))}
              >
                <Flame size={14} />
                {actionPriority === "high" ? "높음" : "보통"}
              </button>
            </div>
            <div className="textarea-wrap">
              <textarea
                ref={actionRef}
                className="composer-textarea"
                value={actionText}
                rows={1}
                onChange={(e) => setActionText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    onAddAction();
                  }
                }}
                placeholder="다음 할 일을 입력하세요…"
              />
              <div className="textarea-footer">
                <span className="char-hint">
                  {actionText.length > 0 ? `${actionText.length}자 · ⌘↵ 추가` : "⌘↵ 추가"}
                </span>
                <div className="btn-row">
                  {hasText && (
                    <button
                      type="button"
                      className="icon-btn btn-clear"
                      onClick={clearDraft}
                      aria-label="지우기"
                    >
                      <X size={15} />
                    </button>
                  )}
                  <button
                    type="button"
                    className={`icon-btn btn-ai${correcting ? " spinning" : ""}`}
                    disabled={!hasText || correcting}
                    onClick={() => onCorrectDraft(activeView, () => setAiOpen(true))}
                    aria-label="AI 교정"
                    title="AI 한국어 교정"
                  >
                    <Sparkles size={16} />
                  </button>
                  <button
                    type="submit"
                    className="icon-btn btn-submit"
                    disabled={!hasText}
                    aria-label="액션 추가"
                  >
                    <ArrowUp size={16} strokeWidth={2.5} />
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {activeView === "memos" && (
        <div className="ai-mode-row">
          <button
            type="button"
            className={`ai-mode-chip${aiMode === "typo" ? " on" : ""}`}
            onClick={() => setAiMode("typo")}
          >
            오타·띄어쓰기
          </button>
          <button
            type="button"
            className={`ai-mode-chip${aiMode === "sentence" ? " on" : ""}`}
            onClick={() => setAiMode("sentence")}
          >
            문장 교정
          </button>
        </div>
      )}

      <div className="ai-row">
        <button
          type="button"
          className="ai-key-btn"
          onClick={() => setAiOpen((v) => !v)}
        >
          <KeyRound size={12} />
          {aiSettings.apiKey ? "AI 설정됨" : "AI 설정"}
        </button>
        <button
          type="button"
          className={`ai-msg ${aiStatus.state}`}
          onClick={() => setAiOpen(true)}
          title={aiStatus.message}
        >
          {aiStatus.message}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {aiOpen && (
          <motion.div
            className="ai-panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <input
              type="password"
              value={aiSettings.apiKey}
              onChange={(e) => setAiSettings((s) => ({ ...s, apiKey: e.target.value.trim() }))}
              placeholder="Gemini API key"
              aria-label="Gemini API key"
            />
            <select
              value={aiSettings.model}
              onChange={(e) => setAiSettings((s) => ({ ...s, model: e.target.value }))}
              aria-label="AI 모델"
            >
              {AI_MODELS.map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.form>
  );
}

// Undo toast
function UndoToast({ msg, onUndo }) {
  return (
    <motion.div
      className="toast"
      initial={{ opacity: 0, y: 20, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
    >
      <span className="toast-msg">{msg}</span>
      <button type="button" className="toast-undo" onClick={onUndo}>
        <RotateCcw size={12} />
        되돌리기
      </button>
    </motion.div>
  );
}

function ErrorModal({ error, onClose }) {
  return (
    <motion.div
      className="err-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onClick={onClose}
    >
      <motion.div
        className="err-modal"
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="err-modal-icon">
          <Sparkles size={20} />
        </div>
        <h2 className="err-modal-title">AI 교정 실패</h2>
        <p className="err-modal-msg">{error.message}</p>
        <p className="err-modal-model">마지막 모델: {error.model}</p>
        <button type="button" className="err-modal-close" onClick={onClose}>
          확인
        </button>
      </motion.div>
    </motion.div>
  );
}

// 문장 교정 결과 모달
function CorrectionModal({ original, corrected, onApply, onCancel }) {
  return (
    <motion.div
      className="correction-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onClick={onCancel}
    >
      <motion.div
        className="correction-modal"
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="correction-modal-hdr">
          <h2>문장 교정 제안 <span>AI가 제안한 교정입니다</span></h2>
          <button type="button" className="correction-close-btn" onClick={onCancel}>
            <X size={14} />
          </button>
        </div>
        <div className="correction-body">
          <div className="correction-box original">
            <p className="correction-label">원본</p>
            <p className="correction-text">{original}</p>
          </div>
          <div className="correction-arrow">↓</div>
          <div className="correction-box suggested">
            <p className="correction-label">교정 제안</p>
            <p className="correction-text">{corrected}</p>
          </div>
        </div>
        <div className="correction-footer">
          <button type="button" className="correction-cancel-btn" onClick={onCancel}>취소</button>
          <button type="button" className="correction-apply-btn" onClick={onApply}>적용하기</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function IntelliMemoApp() {
  const [activeView,     setActiveView]     = useState("memos");
  const [layoutMode,     setLayoutMode]     = useState("landscape"); // "portrait" | "landscape"
  const [memos,          setMemos]          = useState([]);
  const [actions,        setActions]        = useState([]);
  const [memoText,       setMemoText]       = useState("");
  const [selectedTag,    setSelectedTag]    = useState(DEFAULT_TAG);
  const [actionText,     setActionText]     = useState("");
  const [actionDueDate,  setActionDueDate]  = useState("");
  const [actionPriority, setActionPriority] = useState("normal");
  const [actionFilter,   setActionFilter]   = useState("all");
  const [tagFilter,      setTagFilter]      = useState("all");
  const [aiSettings,       setAiSettings]       = useState({ apiKey: "", model: DEFAULT_AI_MODEL });
  const [aiStatus,         setAiStatus]         = useState({ state: "idle", message: `Gemini · ${DEFAULT_AI_MODEL}` });
  const [aiError,          setAiError]          = useState(null);
  const [pendingCorrection, setPendingCorrection] = useState(null); // { original, corrected }
  const [toast,          setToast]          = useState(null); // { msg, undo }
  const [isLoaded,       setIsLoaded]       = useState(false);
  const [scrollTop,      setScrollTop]      = useState(0);
  const [tick,           setTick]           = useState(Date.now());

  const hasHydrated = useRef(false);
  const toastTimer  = useRef(null);

  // ── Hydrate ──
  useEffect(() => {
    let alive = true;
    const hydrate = async () => {
      const [sm, sa, sai] = await Promise.all([
        loadJson("memos",      []),
        loadJson("actions",    []),
        loadJson(AI_SETTINGS_STORAGE_KEY, { model: DEFAULT_AI_MODEL }),
      ]);
      if (!alive) return;

      setMemos(Array.isArray(sm) ? sm : []);
      setActions(Array.isArray(sa) ? sa : []);

      if (sai && typeof sai === "object") {
        const model = normalizeModel(sai.model);
        setAiSettings({ apiKey: loadSessionValue(AI_API_KEY_SESSION_KEY), model });
        setAiStatus({ state: "idle", message: `Gemini · ${model}` });
      }

      hasHydrated.current = true;
      setTimeout(() => alive && setIsLoaded(true), 220);
    };
    hydrate();
    return () => { alive = false; };
  }, []);

  // ── Tick ──
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // ── Persist ──
  useEffect(() => { if (hasHydrated.current) saveJson("memos",      memos);      }, [memos]);
  useEffect(() => { if (hasHydrated.current) saveJson("actions",    actions);    }, [actions]);
  useEffect(() => {
    if (!hasHydrated.current) return;
    saveJson(AI_SETTINGS_STORAGE_KEY, { model: normalizeModel(aiSettings.model) });
    saveSessionValue(AI_API_KEY_SESSION_KEY, aiSettings.apiKey);
  }, [aiSettings]);

  // ── Toast helper ──
  const showToast = useCallback((msg, undoFn) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, undo: undoFn });
    toastTimer.current = setTimeout(() => setToast(null), UNDO_DELAY_MS);
  }, []);

  // ── Derived ──
  const filteredActions = useMemo(() => {
    let list = actions;
    if (actionFilter === "active") list = list.filter((a) => !a.done);
    if (actionFilter === "done")   list = list.filter((a) => a.done);
    return list;
  }, [actions, actionFilter]);

  const filteredMemos = useMemo(() =>
    tagFilter === "all" ? memos : memos.filter((m) => m.tag === tagFilter),
  [memos, tagFilter]);

  // Group memos by date
  const memoGroups = useMemo(() => {
    const map = new Map();
    for (const memo of filteredMemos) {
      const label = dateGroupLabel(memo.createdAt);
      if (!map.has(label)) map.set(label, []);
      map.get(label).push(memo);
    }
    return [...map.entries()];
  }, [filteredMemos]);

  // ── CRUD ──
  const addMemo = useCallback(() => {
    const text = memoText.trim();
    if (!text) return;
    setMemos((cur) => [{ id: createId(), text, tag: selectedTag, createdAt: nowIso() }, ...cur]);
    setMemoText("");
  }, [memoText, selectedTag]);

  const addAction = useCallback(() => {
    const text = actionText.trim();
    if (!text) return;
    setActions((cur) => [
      { id: createId(), text, dueDate: actionDueDate, priority: actionPriority, done: false, createdAt: nowIso() },
      ...cur,
    ]);
    setActionText("");
  }, [actionText, actionDueDate, actionPriority]);

  const deleteMemo = useCallback((id) => {
    const index = memos.findIndex((m) => m.id === id);
    const target = memos[index];
    if (!target) return;
    setMemos((cur) => cur.filter((m) => m.id !== id));
    showToast(`메모 삭제됨`, () => {
      setMemos((cur) => {
        const exists = cur.some((m) => m.id === id);
        if (exists) return cur;
        const next = [...cur];
        next.splice(Math.min(index, next.length), 0, target);
        return next;
      });
    });
  }, [memos, showToast]);

  const editMemo = useCallback((id, text) => {
    setMemos((cur) => cur.map((m) => m.id === id ? { ...m, text } : m));
  }, []);

  const deleteAction = useCallback((id) => {
    const index = actions.findIndex((a) => a.id === id);
    const target = actions[index];
    if (!target) return;
    setActions((cur) => cur.filter((a) => a.id !== id));
    showToast(`액션 삭제됨`, () => {
      setActions((cur) => {
        const exists = cur.some((a) => a.id === id);
        if (exists) return cur;
        const next = [...cur];
        next.splice(Math.min(index, next.length), 0, target);
        return next;
      });
    });
  }, [actions, showToast]);

  const toggleAction = useCallback((id) => {
    setActions((cur) => cur.map((a) => a.id === id ? { ...a, done: !a.done } : a));
  }, []);

  // ── AI correction ──
  const correctDraft = useCallback(async (type, openSettings, mode = "typo") => {
    const text = type === "memos" ? memoText.trim() : actionText.trim();
    if (!text) return;

    if (!aiSettings.apiKey) {
      setAiStatus({ state: "error", message: "API 키 필요" });
      openSettings();
      return;
    }

    setAiError(null);
    const fallbacks = getModelFallbacks(normalizeModel(aiSettings.model));
    let lastError = null;
    let lastModel = fallbacks.at(-1) ?? DEFAULT_AI_MODEL;

    for (let i = 0; i < fallbacks.length; i++) {
      const model = fallbacks[i];
      lastModel = model;
      setAiSettings((s) => ({ ...s, model }));
      setAiStatus({
        state: "loading",
        message: i === 0
          ? `${mode === "sentence" ? "문장 교정" : "오타 교정"} 중…`
          : `${model} 재시도 중…`,
      });

      try {
        const corrected = await correctKorean({ apiKey: aiSettings.apiKey, model, text, mode });
        if (mode === "sentence" && type === "memos") {
          setPendingCorrection({ original: text, corrected });
          setAiStatus({ state: "success", message: "교정 제안 준비됨 ✓" });
        } else {
          if (type === "memos") setMemoText(corrected);
          else setActionText(corrected);
          setAiStatus({ state: "success", message: "교정 완료 ✓" });
        }
        setTimeout(() => setAiStatus({ state: "idle", message: `Gemini · ${model}` }), 2500);
        return;
      } catch (err) {
        lastError = err;
      }
    }

    openSettings();
    const message = lastError instanceof Error ? lastError.message : "교정 실패";
    setAiStatus({ state: "error", message });
    setAiError({ model: lastModel, message });
  }, [memoText, actionText, aiSettings]);

  const frameClass = `frame force-${layoutMode}`;

  return (
    <main className="app">
      <style>{CSS}</style>

      <div className={frameClass}>
        <Header
          activeView={activeView}
          setActiveView={setActiveView}
          actionFilter={actionFilter}
          setActionFilter={setActionFilter}
          compact={scrollTop > 20}
          layoutMode={layoutMode}
          onToggleLayout={() => setLayoutMode((m) => (m === "landscape" ? "portrait" : "landscape"))}
        />

        <Composer
          activeView={activeView}
          memoText={memoText}           setMemoText={setMemoText}
          selectedTag={selectedTag}     setSelectedTag={setSelectedTag}
          onAddMemo={addMemo}
          actionText={actionText}       setActionText={setActionText}
          actionDueDate={actionDueDate} setActionDueDate={setActionDueDate}
          actionPriority={actionPriority} setActionPriority={setActionPriority}
          onAddAction={addAction}
          aiSettings={aiSettings}       setAiSettings={setAiSettings}
          aiStatus={aiStatus}
          onCorrectDraft={correctDraft}
        />

        <section
          className="stage"
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        >
          <AnimatePresence mode="wait" initial={false}>
            {activeView === "memos" ? (
              <motion.div
                key="memos"
                initial={{ opacity: 0, x: -14 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 14 }}
                transition={{ duration: 0.15 }}
              >
                {!isLoaded ? (
                  <SkeletonList />
                ) : (
                  <>
                    <div className="sec-label">
                      <span className="sec-label-text">메모</span>
                      <span className="count-badge">{memos.length}</span>
                    </div>

                    {memos.length > 0 && (
                      <TagFilterStrip
                        selected={tagFilter}
                        onChange={setTagFilter}
                        tags={TAGS}
                      />
                    )}

                    {filteredMemos.length === 0 ? (
                      <EmptyState type="memos" />
                    ) : (
                      memoGroups.map(([label, group]) => (
                        <div key={label} className="date-group">
                          <p className="date-group-label">{label}</p>
                          <div className="memo-list">
                            <AnimatePresence initial={false}>
                              {group.map((memo, i) => (
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
                          </div>
                        </div>
                      ))
                    )}
                  </>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="actions"
                initial={{ opacity: 0, x: 14 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -14 }}
                transition={{ duration: 0.15 }}
              >
                {!isLoaded ? (
                  <SkeletonList />
                ) : (
                  <>
                    <div className="sec-label">
                      <span className="sec-label-text">액션</span>
                      <span className="count-badge">{filteredActions.length}</span>
                    </div>

                    {actions.length > 0 && (
                      <ActionProgress actions={actions} />
                    )}

                    {filteredActions.length === 0 ? (
                      <EmptyState type="actions" />
                    ) : (
                      <div className="action-list">
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
                      </div>
                    )}
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </div>

      {/* Undo toast */}
      <AnimatePresence>
        {toast && (
          <UndoToast
            key="undo-toast"
            msg={toast.msg}
            onUndo={() => { toast.undo(); setToast(null); }}
          />
        )}
      </AnimatePresence>

      {/* AI error modal */}
      <AnimatePresence>
        {aiError && (
          <ErrorModal
            key="err-modal"
            error={aiError}
            onClose={() => setAiError(null)}
          />
        )}
      </AnimatePresence>

      {/* 문장 교정 모달 */}
      <AnimatePresence>
        {pendingCorrection && (
          <CorrectionModal
            key="correction-modal"
            original={pendingCorrection.original}
            corrected={pendingCorrection.corrected}
            onApply={() => {
              setMemoText(pendingCorrection.corrected);
              setPendingCorrection(null);
            }}
            onCancel={() => setPendingCorrection(null)}
          />
        )}
      </AnimatePresence>
    </main>
  );
}
