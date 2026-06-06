import { useCallback, useEffect, useRef, useState } from "react";
import {
  AI_CORRECTION_MODES,
  DEFAULT_AI_CORRECTION_MODE,
  DEFAULT_OPENAI_MODEL,
  OPENAI_API_KEY_SESSION_KEY,
  OPENAI_SETTINGS_STORAGE_KEY,
} from "../constants.js";
import {
  getOpenAiModelFallbacks,
  normalizeOpenAiModel,
  saveJson,
  saveSessionValue,
} from "../utils.js";
import { correctKorean } from "../api.js";

export function useAiCorrection({ memoText, actionText, hasHydrated }) {
  const [aiSettings,        setAiSettings]       = useState({ apiKey: "", model: DEFAULT_OPENAI_MODEL });
  const [aiStatus,          setAiStatus]         = useState({ state: "idle", message: `ChatGPT · ${DEFAULT_OPENAI_MODEL}` });
  const [aiError,           setAiError]          = useState(null);
  const [pendingCorrection, setPendingCorrection] = useState(null);
  const [rateLimitInfo,     setRateLimitInfo]    = useState(null);
  const [rateLimitSec,      setRateLimitSec]     = useState(0);
  const idleTimerRef = useRef(null);

  useEffect(() => {
    if (rateLimitInfo?.type !== "rpm") { setRateLimitSec(0); return; }
    const update = () => {
      const sec = Math.ceil((rateLimitInfo.until - Date.now()) / 1000);
      if (sec <= 0) { setRateLimitSec(0); setRateLimitInfo(null); }
      else setRateLimitSec(sec);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [rateLimitInfo]);

  useEffect(() => {
    if (!hasHydrated.current) return;
    saveJson(OPENAI_SETTINGS_STORAGE_KEY, { model: normalizeOpenAiModel(aiSettings.model) })
      .catch((err) => console.error(err));
    saveSessionValue(OPENAI_API_KEY_SESSION_KEY, aiSettings.apiKey);
  }, [aiSettings]);

  const correctDraft = useCallback(async (type, openSettings, mode = DEFAULT_AI_CORRECTION_MODE) => {
    const text = type === "memos" ? memoText.trim() : actionText.trim();
    if (!text) return;

    if (!aiSettings.apiKey) {
      setAiStatus({ state: "error", message: "API 키 필요" });
      openSettings();
      return;
    }

    const modeConfig = AI_CORRECTION_MODES.find((m) => m.key === mode) ?? AI_CORRECTION_MODES[0];

    clearTimeout(idleTimerRef.current);
    setAiError(null);
    const fallbacks = getOpenAiModelFallbacks(normalizeOpenAiModel(aiSettings.model));
    const rateLimitMessage = fallbacks.length > 1 ? "요청 한도 초과" : "대체 모델 없음 · 요청 한도 초과";
    let lastError = null;
    let lastModel = fallbacks.at(-1) ?? DEFAULT_OPENAI_MODEL;

    for (let i = 0; i < fallbacks.length; i++) {
      const model = fallbacks[i];
      lastModel = model;
      setAiStatus({
        state: "loading",
        message: i === 0 ? `${modeConfig.label} 중…` : `${model} 재시도 중…`,
      });

      try {
        const corrected = await correctKorean({ apiKey: aiSettings.apiKey, model, text, mode });
        setAiSettings((s) => s.model === model ? s : { ...s, model });
        setPendingCorrection({ type, original: text, corrected, mode: modeConfig.key });
        setAiStatus({ state: "success", message: `${modeConfig.label} 제안 준비됨 ✓` });
        idleTimerRef.current = setTimeout(() => setAiStatus({ state: "idle", message: `ChatGPT · ${model}` }), 2500);
        return;
      } catch (err) {
        if (err.status === 429 && (err.limitType ?? "unknown") === "rpd") {
          setAiSettings((s) => s.model === model ? s : { ...s, model });
          setRateLimitInfo({ type: "rpd" });
          setAiStatus({ state: "rate-limited", message: rateLimitMessage });
          return;
        }
        lastError = err;
      }
    }

    if (lastError?.status === 429) {
      setAiSettings((s) => s.model === lastModel ? s : { ...s, model: lastModel });
      const limitType = lastError.limitType ?? "unknown";
      if (limitType === "rpm") {
        setRateLimitInfo({ type: "rpm", until: Date.now() + (lastError.retryAfter ?? 60) * 1000 });
      } else {
        setRateLimitInfo({ type: limitType });
      }
      setAiStatus({ state: "rate-limited", message: rateLimitMessage });
      return;
    }

    setAiSettings((s) => s.model === lastModel ? s : { ...s, model: lastModel });
    openSettings();
    const message = lastError instanceof Error ? lastError.message : "교정 실패";
    setAiStatus({ state: "error", message });
    setAiError({ model: lastModel, message, type: "correction" });
  }, [memoText, actionText, aiSettings]);

  return {
    aiSettings, setAiSettings,
    aiStatus, setAiStatus,
    aiError, setAiError,
    pendingCorrection, setPendingCorrection,
    rateLimitInfo, setRateLimitInfo,
    rateLimitSec,
    correctDraft,
  };
}
