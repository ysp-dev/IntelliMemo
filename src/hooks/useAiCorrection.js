import { useCallback, useEffect, useState } from "react";
import {
  AI_CORRECTION_MODES,
  AI_SETTINGS_STORAGE_KEY,
  AI_API_KEY_SESSION_KEY,
  DEFAULT_AI_CORRECTION_MODE,
  DEFAULT_AI_MODEL,
} from "../constants.js";
import { getModelFallbacks, normalizeModel, saveJson, saveSessionValue } from "../utils.js";
import { correctKorean } from "../api.js";

export function useAiCorrection({ memoText, actionText, setMemoText, setActionText, hasHydrated }) {
  const [aiSettings,        setAiSettings]       = useState({ apiKey: "", model: DEFAULT_AI_MODEL });
  const [aiStatus,          setAiStatus]         = useState({ state: "idle", message: `Gemini · ${DEFAULT_AI_MODEL}` });
  const [aiError,           setAiError]          = useState(null);
  const [pendingCorrection, setPendingCorrection] = useState(null);
  const [rateLimitInfo,     setRateLimitInfo]    = useState(null);
  const [rateLimitSec,      setRateLimitSec]     = useState(0);

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
    saveJson(AI_SETTINGS_STORAGE_KEY, { model: normalizeModel(aiSettings.model) });
    saveSessionValue(AI_API_KEY_SESSION_KEY, aiSettings.apiKey);
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
        message: i === 0 ? `${modeConfig.label} 중…` : `${model} 재시도 중…`,
      });

      try {
        const corrected = await correctKorean({ apiKey: aiSettings.apiKey, model, text, mode });
        if (modeConfig.modal && type === "memos") {
          setPendingCorrection({ original: text, corrected, mode: modeConfig.key });
          setAiStatus({ state: "success", message: `${modeConfig.label} 제안 준비됨 ✓` });
        } else {
          if (type === "memos") setMemoText(corrected);
          else setActionText(corrected);
          setAiStatus({ state: "success", message: "교정 완료 ✓" });
        }
        setTimeout(() => setAiStatus({ state: "idle", message: `Gemini · ${model}` }), 2500);
        return;
      } catch (err) {
        if (err.status === 429 && (err.limitType ?? "unknown") === "rpd") {
          setRateLimitInfo({ type: "rpd" });
          setAiStatus({ state: "rate-limited", message: "요청 한도 초과" });
          return;
        }
        lastError = err;
      }
    }

    if (lastError?.status === 429) {
      const limitType = lastError.limitType ?? "unknown";
      if (limitType === "rpm") {
        setRateLimitInfo({ type: "rpm", until: Date.now() + (lastError.retryAfter ?? 60) * 1000 });
      } else {
        setRateLimitInfo({ type: limitType });
      }
      setAiStatus({ state: "rate-limited", message: "요청 한도 초과" });
      return;
    }

    openSettings();
    const message = lastError instanceof Error ? lastError.message : "교정 실패";
    setAiStatus({ state: "error", message });
    setAiError({ model: lastModel, message, type: "correction" });
  }, [memoText, actionText, aiSettings, setMemoText, setActionText]);

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
