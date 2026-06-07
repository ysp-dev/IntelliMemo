import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUp,
  CalendarDays,
  Camera,
  Check,
  Copy,
  Flame,
  ImagePlus,
  KeyRound,
  Sparkles,
  X,
} from "lucide-react";
import {
  AI_CORRECTION_GROUPS,
  AI_CORRECTION_MODES,
  DEFAULT_AI_CORRECTION_MODE,
  DEFAULT_OCR_MODEL,
  OCR_MODELS,
  OPENAI_MODELS,
  TAGS,
} from "../constants.js";
import { copyToClipboard, getOcrModelFallbacks, normalizeOcrModel } from "../utils.js";
import { extractTextFromImage } from "../api.js";
import { useAutoResize } from "../hooks/useAutoResize.js";
import { CropModal } from "./modals/CropModal.jsx";

const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_CROP_SOURCE_EDGE = 1800;
const IMAGE_TYPE_BY_EXTENSION = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
};
const SUPPORTED_IMAGE_TYPES = new Set(Object.values(IMAGE_TYPE_BY_EXTENSION));

const getImageMimeType = (file) => {
  const declaredType = file.type === "image/jpg" ? "image/jpeg" : file.type;
  if (declaredType) return declaredType;
  const extension = file.name.split(".").pop()?.toLowerCase();
  return IMAGE_TYPE_BY_EXTENSION[extension] ?? "";
};

const loadImageFromUrl = (url) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error("이미지를 불러오지 못했습니다."));
  img.src = url;
});

const canvasToBlob = (canvas, mimeType, quality) => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => {
    if (blob) resolve(blob);
    else reject(new Error("이미지를 처리하지 못했습니다."));
  }, mimeType, quality);
});

export function Composer({
  activeView,
  memoText, setMemoText,
  selectedTag, setSelectedTag,
  onAddMemo,
  actionText, setActionText,
  actionDueDate, setActionDueDate,
  actionPriority, setActionPriority,
  onAddAction,
  aiSettings, setAiSettings,
  ocrSettings, setOcrSettings,
  aiStatus,
  onCorrectDraft,
  onOcrError,
  rateLimitInfo,
  rateLimitSec,
  onRateLimit,
  onDismissRateLimit,
}) {
  const memoRef   = useRef(null);
  const actionRef = useRef(null);
  const cameraRef  = useRef(null);
  const galleryRef = useRef(null);
  const cropObjectUrlRef = useRef(null);
  const [aiOpen,    setAiOpen]    = useState(false);
  const [aiMode,    setAiMode]    = useState(DEFAULT_AI_CORRECTION_MODE);
  const [ocrState,  setOcrState]  = useState("idle");
  const [cropData,  setCropData]  = useState(null);
  const [copyState, setCopyState] = useState("idle");
  // API 키 연결 상태: idle(미설정) · testing(확인 중) · ok(연결됨) · fail(연결 실패)
  const [keyStatus, setKeyStatus] = useState({ openai: "idle", gemini: "idle" });

  const correcting = aiStatus.state === "loading";
  const isOcrBusy = ocrState === "cloud-scanning";
  const settleCopyState = (state) => {
    setCopyState(state);
    setTimeout(() => setCopyState("idle"), 1500);
  };

  // 키가 등록되면 바로 초록불을 켜고, 디바운스 후 연결을 검증해 명백한 인증 실패일 때만 빨강.
  // (CORS·네트워크로 검증을 못 읽는 경우엔 초록 유지)
  useEffect(() => {
    const key = aiSettings.apiKey?.trim();
    if (!key) { setKeyStatus((s) => ({ ...s, openai: "idle" })); return undefined; }
    setKeyStatus((s) => ({ ...s, openai: "ok" }));
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${key}` },
        });
        if (cancelled) return;
        if (res.status === 401 || res.status === 403) setKeyStatus((s) => ({ ...s, openai: "fail" }));
      } catch {
        // 검증 불가 → 등록 상태(초록) 유지
      }
    }, 600);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [aiSettings.apiKey]);

  useEffect(() => {
    const key = ocrSettings.apiKey?.trim();
    if (!key) { setKeyStatus((s) => ({ ...s, gemini: "idle" })); return undefined; }
    setKeyStatus((s) => ({ ...s, gemini: "ok" }));
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
        );
        if (cancelled) return;
        // Gemini 는 잘못된 키에 400 을 반환한다.
        if (res.status === 400 || res.status === 401 || res.status === 403) {
          setKeyStatus((s) => ({ ...s, gemini: "fail" }));
        }
      } catch {
        // 검증 불가 → 등록 상태(초록) 유지
      }
    }, 600);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [ocrSettings.apiKey]);

  const keyDotClass = (st) =>
    st === "ok" ? "dot-green" : st === "fail" ? "dot-red" : st === "testing" ? "dot-gray" : "dot-off";
  const keyStatusLabel = (st) =>
    ({ ok: "연결됨", fail: "연결 실패", testing: "확인 중", idle: "미설정" })[st] ?? "";

  const handleCameraClick = () => {
    cameraRef.current?.click();
  };

  const handleGalleryClick = () => {
    galleryRef.current?.click();
  };

  const closeCrop = () => {
    if (cropObjectUrlRef.current) {
      URL.revokeObjectURL(cropObjectUrlRef.current);
      cropObjectUrlRef.current = null;
    }
    setCropData(null);
  };

  const prepareImageForCrop = async (file) => {
    const sourceUrl = URL.createObjectURL(file);
    try {
      const img = await loadImageFromUrl(sourceUrl);
      const scale = Math.min(1, MAX_CROP_SOURCE_EDGE / img.naturalWidth, MAX_CROP_SOURCE_EDGE / img.naturalHeight);
      const width = Math.max(1, Math.round(img.naturalWidth * scale));
      const height = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      const blob = await canvasToBlob(canvas, "image/jpeg", 0.9);
      const objectUrl = URL.createObjectURL(blob);
      if (cropObjectUrlRef.current) URL.revokeObjectURL(cropObjectUrlRef.current);
      cropObjectUrlRef.current = objectUrl;
      setCropData({ dataUrl: objectUrl, mimeType: "image/jpeg" });
    } finally {
      URL.revokeObjectURL(sourceUrl);
    }
  };

  const handleImageFile = async (file) => {
    if (!file) return;
    const mimeType = getImageMimeType(file);
    if (!SUPPORTED_IMAGE_TYPES.has(mimeType)) {
      settleOcrError("이미지", "JPG, PNG, WEBP, GIF, HEIC 이미지만 가져올 수 있습니다.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      settleOcrError("이미지", "이미지가 너무 큽니다. 16MB 이하 이미지를 선택하세요.");
      return;
    }
    try {
      await prepareImageForCrop(file);
    } catch (err) {
      settleOcrError("이미지", err instanceof Error ? err.message : "이미지를 불러오지 못했습니다.");
    }
  };

  const handleImageSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    handleImageFile(file);
  };

  const handleMemoPaste = (e) => {
    const imageItem = [...(e.clipboardData?.items ?? [])]
      .find((item) => item.kind === "file" && item.type.startsWith("image/"));
    if (!imageItem) return;
    e.preventDefault();
    handleImageFile(imageItem.getAsFile());
  };

  const appendExtractedText = (text) => {
    setMemoText((prev) => prev ? `${prev}\n${text}` : text);
    setOcrState("idle");
  };

  const settleOcrError = (model, message) => {
    setOcrState("error");
    setTimeout(() => setOcrState("idle"), 2000);
    onOcrError({ model, message, type: "ocr" });
  };

  const runGeminiOcr = async (base64, mimeType) => {
    setOcrState("cloud-scanning");
    const fallbacks = getOcrModelFallbacks(normalizeOcrModel(ocrSettings.model));
    let lastError = null;
    let lastModel = fallbacks.at(-1) ?? DEFAULT_OCR_MODEL;

    for (let i = 0; i < fallbacks.length; i++) {
      const model = fallbacks[i];
      lastModel = model;
      try {
        const extracted = await extractTextFromImage({ apiKey: ocrSettings.apiKey, model, base64, mimeType });
        if (!extracted.trim()) {
          setOcrSettings((s) => s.model === model ? s : { ...s, model });
          settleOcrError(model, "텍스트를 찾을 수 없습니다");
          return;
        }
        setOcrSettings((s) => s.model === model ? s : { ...s, model });
        appendExtractedText(extracted);
        return;
      } catch (err) {
        if (err.status === 429 && (err.limitType ?? "unknown") === "rpd") {
          setOcrSettings((s) => s.model === model ? s : { ...s, model });
          setOcrState("idle");
          onRateLimit("rpd", 0);
          return;
        }
        lastError = err;
      }
    }

    if (lastError?.status === 429) {
      setOcrSettings((s) => s.model === lastModel ? s : { ...s, model: lastModel });
      setOcrState("idle");
      onRateLimit(lastError.limitType ?? "unknown", lastError.retryAfter ?? 60);
      return;
    }

    setOcrSettings((s) => s.model === lastModel ? s : { ...s, model: lastModel });
    const message = lastError instanceof Error ? lastError.message : "OCR 실패";
    settleOcrError(lastModel, message);
  };

  const handleCropConfirm = async (base64, mimeType) => {
    closeCrop();

    if (!ocrSettings.apiKey) {
      setAiOpen(true);
      settleOcrError("Gemini OCR", "Gemini OCR 키가 필요합니다.");
      return;
    }

    await runGeminiOcr(base64, mimeType);
  };

  const draftText = activeView === "memos" ? memoText : actionText;
  const hasText   = draftText.trim().length > 0;
  const ocrHint = ocrState === "cloud-scanning" ? "Gemini 모델로 텍스트 추출 중…"
    : ocrState === "error" ? "텍스트를 찾을 수 없음"
    : memoText.length > 0 ? `${memoText.length}자 · ⌘↵ 저장`
    : "⌘↵ 저장";

  useAutoResize(memoRef,   memoText);
  useAutoResize(actionRef, actionText);

  useEffect(() => {
    if (aiStatus.state === "error") setAiOpen(true);
  }, [aiStatus.state]);

  useEffect(() => () => {
    if (cropObjectUrlRef.current) URL.revokeObjectURL(cropObjectUrlRef.current);
  }, []);

  useEffect(() => {
    const ref = activeView === "memos" ? memoRef : actionRef;
    ref.current?.focus({ preventScroll: true });
  }, [activeView]);

  const clearDraft = () => {
    if (activeView === "memos") setMemoText("");
    else setActionText("");
  };

  const copyDraft = async () => {
    const text = activeView === "memos" ? memoText : actionText;
    if (!text.trim()) return;
    try {
      await copyToClipboard(text);
      settleCopyState("done");
    } catch {
      settleCopyState("error");
    }
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
                onPaste={handleMemoPaste}
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
                  {ocrHint}
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
                  {hasText && (
                    <button
                      type="button"
                      className={`icon-btn btn-copy${copyState === "done" ? " copied" : ""}${copyState === "error" ? " error" : ""}`}
                      onClick={copyDraft}
                      aria-label={copyState === "error" ? "복사 실패" : copyState === "done" ? "복사됨" : "복사"}
                      title={copyState === "error" ? "복사 실패" : "텍스트 복사"}
                    >
                      {copyState === "done" ? <Check size={15} /> : copyState === "error" ? <X size={15} /> : <Copy size={15} />}
                    </button>
                  )}
                  <button
                    type="button"
                    className={`icon-btn btn-camera${isOcrBusy ? " scanning" : ""}`}
                    disabled={isOcrBusy || correcting}
                    onClick={handleCameraClick}
                    aria-label="카메라 OCR"
                    title="카메라로 텍스트 추출"
                  >
                    <Camera size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn btn-gallery"
                    disabled={isOcrBusy || correcting}
                    onClick={handleGalleryClick}
                    aria-label="갤러리에서 텍스트 추출"
                    title="갤러리에서 텍스트 추출"
                  >
                    <ImagePlus size={16} />
                  </button>
                  <button
                    type="button"
                    className={`icon-btn btn-ai${correcting ? " spinning" : ""}`}
                    disabled={!hasText || correcting}
                    onClick={() => onCorrectDraft(activeView, () => setAiOpen(true), aiMode)}
                    aria-label="AI 교정"
                    title={(AI_CORRECTION_MODES.find((m) => m.key === aiMode) ?? AI_CORRECTION_MODES[0]).label}
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
                  <input
                    ref={galleryRef}
                    type="file"
                    accept="image/*"
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
                  {hasText && (
                    <button
                      type="button"
                      className={`icon-btn btn-copy${copyState === "done" ? " copied" : ""}${copyState === "error" ? " error" : ""}`}
                      onClick={copyDraft}
                      aria-label={copyState === "error" ? "복사 실패" : copyState === "done" ? "복사됨" : "복사"}
                      title={copyState === "error" ? "복사 실패" : "텍스트 복사"}
                    >
                      {copyState === "done" ? <Check size={15} /> : copyState === "error" ? <X size={15} /> : <Copy size={15} />}
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
        <>
          <div className="ai-mode-row">
            {AI_CORRECTION_GROUPS.map((g) => {
              const active = g.key === "typo" ? aiMode === "typo"
                           : g.key === "translate" ? aiMode === "translate"
                           : !["typo", "translate"].includes(aiMode);
              return (
                <button
                  key={g.key}
                  type="button"
                  className={`ai-mode-chip ${g.key}-chip${active ? " on" : ""}`}
                  onClick={() => {
                    if (g.key === "typo") setAiMode("typo");
                    else if (g.key === "translate") setAiMode("translate");
                    else if (["typo", "translate"].includes(aiMode)) setAiMode("grammar");
                  }}
                >
                  {g.label}
                </button>
              );
            })}
          </div>
          {!["typo", "translate"].includes(aiMode) && (
            <div className="ai-mode-row ai-submode-row">
              {AI_CORRECTION_MODES.filter((m) => m.group === "sentence").map((m) => (
                <button
                  key={m.key}
                  type="button"
                  className={`ai-mode-chip ${m.key}-chip${aiMode === m.key ? " on" : ""}`}
                  onClick={() => setAiMode(m.key)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {rateLimitInfo && (
        <div className="rate-limit-bar">
          <span>
            {rateLimitInfo.type === "rpm"
              ? `⏱ ${rateLimitSec}초 후 재시도 가능`
              : rateLimitInfo.type === "rpd"
                ? "일일 요청 한도 또는 크레딧 한도 초과"
                : "요청 한도 초과 · 한도 유형을 알 수 없습니다"}
          </span>
          <div style={{ display: "flex", gap: 10 }}>
            {rateLimitInfo.type === "rpm" && (
              <button type="button" className="rate-limit-dismiss" onClick={onDismissRateLimit}>
                무시하고 재시도
              </button>
            )}
            <button type="button" className="rate-limit-dismiss" onClick={onDismissRateLimit}>
              중단
            </button>
          </div>
        </div>
      )}

      <div className="ai-row">
        <div className="ai-key-group">
          <button
            type="button"
            className="ai-key-btn"
            onClick={() => setAiOpen((v) => !v)}
          >
            <KeyRound size={12} />
            {aiSettings.apiKey ? "ChatGPT 설정됨" : "ChatGPT 설정"}
          </button>
          <span className="ai-key-status" aria-label="API 연결 상태">
            <span
              className={`status-dot ${keyDotClass(keyStatus.openai)}`}
              title={`ChatGPT ${keyStatusLabel(keyStatus.openai)}`}
            />
            <span
              className={`status-dot ${keyDotClass(keyStatus.gemini)}`}
              title={`Gemini ${keyStatusLabel(keyStatus.gemini)}`}
            />
          </span>
        </div>
        <button
          type="button"
          className={`ai-msg ${aiStatus.state}`}
          onClick={() => setAiOpen(true)}
          title={aiStatus.message}
        >
          {aiStatus.message}
        </button>
      </div>

      {createPortal(
        <AnimatePresence>
          {cropData && (
            <CropModal
              key="crop-modal"
              dataUrl={cropData.dataUrl}
              mimeType={cropData.mimeType}
              onCrop={handleCropConfirm}
              onError={(message) => settleOcrError("이미지", message)}
              onCancel={closeCrop}
            />
          )}
        </AnimatePresence>,
        document.body,
      )}

      <AnimatePresence initial={false}>
        {aiOpen && (
          <motion.div
            className="ai-panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <label className="ai-panel-field">
              <span>ChatGPT</span>
              <input
                type="password"
                value={aiSettings.apiKey}
                onChange={(e) => setAiSettings((s) => ({ ...s, apiKey: e.target.value.trim() }))}
                placeholder="ChatGPT API key"
                aria-label="ChatGPT API key"
              />
            </label>
            <label className="ai-panel-field">
              <span>모델</span>
              <select
                value={aiSettings.model}
                onChange={(e) => setAiSettings((s) => ({ ...s, model: e.target.value }))}
                aria-label="ChatGPT 모델"
              >
                {OPENAI_MODELS.map((m) => (
                  <option key={m.key} value={m.key}>{m.label}</option>
                ))}
              </select>
            </label>
            <label className="ai-panel-field">
              <span>Gemini OCR 키</span>
              <input
                type="password"
                value={ocrSettings.apiKey}
                onChange={(e) => setOcrSettings((s) => ({ ...s, apiKey: e.target.value.trim() }))}
                placeholder="Gemini API key"
                aria-label="Gemini OCR API key"
              />
            </label>
            <label className="ai-panel-field">
              <span>Gemini OCR 모델</span>
              <select
                value={ocrSettings.model}
                onChange={(e) => setOcrSettings((s) => ({ ...s, model: e.target.value }))}
                aria-label="Gemini OCR 모델"
              >
                {OCR_MODELS.map((m) => (
                  <option key={m.key} value={m.key}>{m.label}</option>
                ))}
              </select>
            </label>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.form>
  );
}
