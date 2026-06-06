import {
  DEFAULT_OCR_MODE,
  DEFAULT_OCR_MODEL,
  DEFAULT_OPENAI_MODEL,
  OCR_MODELS,
  OPENAI_MODELS,
} from "./constants.js";

export const nowIso = () => new Date().toISOString();

export const createId = () =>
  window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const unwrapStorage = (v) =>
  typeof v === "string" ? v : (v?.value ?? null);

export const loadJson = async (key, fallback) => {
  try {
    if (!window.storage?.get) return fallback;
    const raw = unwrapStorage(await window.storage.get(key));
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
};

export const saveJson = async (key, value) => {
  try {
    if (!window.storage?.set) throw new Error("저장소를 사용할 수 없습니다.");
    await window.storage.set(key, JSON.stringify(value));
    return true;
  } catch (err) {
    throw err instanceof Error ? err : new Error("저장에 실패했습니다.");
  }
};

export const loadSessionValue = (key) => {
  try { return window.localStorage?.getItem(key) ?? ""; }
  catch { return ""; }
};

export const saveSessionValue = (key, value) => {
  try {
    if (!window.localStorage) return;
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {}
};

export const relativeTime = (iso, tick) => {
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

export const dateGroupLabel = (iso) => {
  const date       = new Date(iso);
  const now        = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dateStart  = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffMs     = todayStart - dateStart;
  if (diffMs <= 0)          return "오늘";
  if (diffMs < 172_800_000) return "어제";
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
};

export const isPastDue = (date, done) => {
  if (!date || done) return false;
  const today = new Date(); today.setHours(0,0,0,0);
  return new Date(`${date}T00:00:00`) < today;
};

export const formatDue = (date) => {
  if (!date) return "마감 없음";
  const d = new Date(`${date}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

export const copyToClipboard = async (text) => {
  if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return; }
  const el = Object.assign(document.createElement("textarea"), {
    value: text, style: "position:fixed;top:-9999px",
  });
  document.body.appendChild(el);
  el.select();
  document.execCommand("copy");
  el.remove();
};

const getFallbacks = (models, model) => {
  const keys = models.map((m) => m.key);
  // Fallback starts at the selected model; selecting the last model intentionally disables downgrade.
  return keys.slice(Math.max(0, keys.indexOf(model)));
};

export const getOpenAiModelFallbacks = (model) =>
  getFallbacks(OPENAI_MODELS, model);

export const normalizeOpenAiModel = (model) =>
  OPENAI_MODELS.some((m) => m.key === model) ? model : DEFAULT_OPENAI_MODEL;

export const getOcrModelFallbacks = (model) =>
  getFallbacks(OCR_MODELS, model);

export const normalizeOcrModel = (model) =>
  OCR_MODELS.some((m) => m.key === model) ? model : DEFAULT_OCR_MODEL;

export const normalizeOcrMode = (mode) => {
  if (mode === "cloud-only") return "ai-model";
  return mode === "ai-model" ? mode : DEFAULT_OCR_MODE;
};

export const extractText = (res) => {
  for (const c of res.candidates ?? []) {
    const t = (c.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
    if (t) return t;
  }
  return "";
};

export const extractOpenAiText = (res) => {
  if (typeof res.output_text === "string" && res.output_text.trim()) {
    return res.output_text.trim();
  }

  for (const item of res.output ?? []) {
    for (const part of item.content ?? []) {
      if ((part.type === "output_text" || part.type === "text") && typeof part.text === "string") {
        const text = part.text.trim();
        if (text) return text;
      }
    }
  }

  return "";
};

export const parseRetryAfter = (header) => {
  if (!header) return null;
  if (/^\d+$/.test(header.trim())) {
    const sec = parseInt(header, 10);
    if (sec > 0) return sec;
  }
  const date = Date.parse(header);
  if (Number.isFinite(date)) {
    const diff = Math.ceil((date - Date.now()) / 1000);
    return diff > 0 ? diff : null;
  }
  return null;
};

export const detectRateLimitType = (rawMsg, retryAfter) => {
  const n = rawMsg.toLowerCase();
  if (n.includes("per day") || n.includes("per_day") || n.includes("daily")) return "rpd";
  if (n.includes("per minute") || n.includes("per_minute") || n.includes("tokens per minute")) return "rpm";
  return retryAfter ? "rpm" : "unknown";
};

const parseApiMessage = (errorText) => {
  let msg = errorText;
  try { const p = JSON.parse(errorText); msg = p?.error?.message || p?.message || errorText; } catch {}
  return msg;
};

export const geminiApiError = (status, errorText) => {
  const msg = parseApiMessage(errorText);
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

export const openAiApiError = (status, errorText) => {
  const msg = parseApiMessage(errorText);
  const n = msg.toLowerCase();
  if (n.includes("invalid api key") || n.includes("incorrect api key")) return "OpenAI API 키가 유효하지 않습니다.";
  if (n.includes("quota") || n.includes("rate limit") || n.includes("too many requests")) return "OpenAI API 사용량 한도 초과";
  if (n.includes("billing") || n.includes("credit")) return "OpenAI 결제 또는 크레딧 설정을 확인하세요.";
  if (n.includes("permission") || n.includes("forbidden")) return "OpenAI API 키 권한을 확인하세요.";
  if (status === 400) return "OpenAI 요청 형식 오류";
  if (status === 401) return "OpenAI API 키 인증 실패";
  if (status === 403) return "OpenAI API 키 권한 없음";
  if (status === 404 && n.includes("model")) return "선택한 OpenAI 모델 없음";
  if (status === 429) return "요청 한도 초과, 잠시 후 재시도";
  if (status >= 500) return "OpenAI 서버 오류";
  return msg || `오류 ${status}`;
};
