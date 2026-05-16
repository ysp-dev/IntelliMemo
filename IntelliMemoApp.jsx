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
} from "lucide-react";

const TAGS = ["#업무", "#아이디어", "#개인"];
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
  } catch {
    // Storage failures should not interrupt capture flow.
  }
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
  const due = new Date(`${date}T00:00:00`);
  return due < today;
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
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
};

const getModelFallbacks = (selectedModel) => {
  const modelKeys = AI_MODELS.map((model) => model.key);
  const startIndex = Math.max(0, modelKeys.indexOf(selectedModel));
  return modelKeys.slice(startIndex);
};

const normalizeAiModel = (model) =>
  AI_MODELS.some((option) => option.key === model) ? model : DEFAULT_AI_MODEL;

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
  (response.candidates ?? []).some((candidate) => candidate.finishReason === "MAX_TOKENS");

const summarizeApiError = (status, errorText) => {
  let message = errorText;

  try {
    const parsed = JSON.parse(errorText);
    message = parsed?.error?.message || parsed?.message || errorText;
  } catch {
    // Some network layers return plain text or an empty body.
  }

  const normalizedMessage = message.toLowerCase();

  if (
    normalizedMessage.includes("api key not valid") ||
    normalizedMessage.includes("api_key_invalid") ||
    normalizedMessage.includes("invalid api key")
  ) {
    return "Gemini API 키를 확인해주세요.";
  }
  if (
    normalizedMessage.includes("quota") ||
    normalizedMessage.includes("rate limit") ||
    normalizedMessage.includes("resource_exhausted")
  ) {
    return "Gemini API 사용량 한도 또는 요청 빈도를 확인해주세요.";
  }
  if (normalizedMessage.includes("billing")) {
    return "Google Cloud 결제 설정 또는 Gemini API 사용 권한을 확인해주세요.";
  }
  if (
    normalizedMessage.includes("permission") ||
    normalizedMessage.includes("forbidden") ||
    normalizedMessage.includes("access")
  ) {
    return "Gemini API 키 권한을 확인해주세요.";
  }
  if (status === 400) {
    return "Gemini API 키 또는 요청 형식을 확인해주세요.";
  }
  if (status === 401) return "Gemini API 키를 확인해주세요.";
  if (status === 403) return "Gemini API 키 권한 또는 결제 설정을 확인해주세요.";
  if (status === 404 && normalizedMessage.includes("model")) {
    return "선택한 모델을 사용할 수 없습니다.";
  }
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
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            maxOutputTokens: 1024,
            temperature: 0.2,
          },
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
  if (isResponseTruncated(data)) {
    throw new Error("교정 결과가 너무 길어 중간에 끊겼습니다. 문장을 조금 나눠서 다시 교정해주세요.");
  }
  const corrected = extractResponseText(data);
  if (!corrected) throw new Error("교정 결과가 비어 있습니다.");
  return corrected;
};

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
        aria-labelledby="correction-error-title"
        initial={{ y: 26, opacity: 0, scale: 0.96 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 18, opacity: 0, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 320, damping: 28 }}
      >
        <Sparkles size={22} />
        <h2 id="correction-error-title">AI 교정 실패</h2>
        <p>{error.message}</p>
        <div className="error-meta">
          <span>마지막 모델</span>
          <strong>{error.model}</strong>
        </div>
        <button type="button" onClick={onClose}>
          확인
        </button>
      </motion.div>
    </motion.div>
  );
}

function TopChrome({ activeView, setActiveView, actionFilter, setActionFilter, compact }) {
  return (
    <header className={`top-chrome ${compact ? "is-compact" : ""}`}>
      <div className="mx-auto flex w-full max-w-[430px] flex-col gap-3 px-4 pt-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="kicker">IntelliMemo</p>
            <h1>인텔리메모</h1>
          </div>
          <motion.div
            className="sync-orb"
            animate={{ rotate: compact ? 8 : 0, scale: compact ? 0.92 : 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 24 }}
          >
            <Sparkles size={18} />
          </motion.div>
        </div>

        <div className="mode-tabs" role="tablist" aria-label="보기 전환">
          <motion.div
            className="mode-indicator"
            animate={{ x: activeView === "memos" ? 0 : "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
          />
          <button
            type="button"
            className={activeView === "memos" ? "is-active" : ""}
            onClick={() => setActiveView("memos")}
          >
            <MessageSquareText size={17} />
            메모
          </button>
          <button
            type="button"
            className={activeView === "actions" ? "is-active" : ""}
            onClick={() => setActiveView("actions")}
          >
            <Check size={17} />
            액션
          </button>
        </div>

        <AnimatePresence initial={false}>
          {activeView === "actions" && (
            <motion.div
              className="filter-tabs"
              initial={{ y: -8, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -8, opacity: 0 }}
              transition={{ duration: 0.18 }}
            >
              <ListFilter size={16} />
              {ACTION_FILTERS.map((filter) => (
                <button
                  key={filter.key}
                  type="button"
                  className={actionFilter === filter.key ? "is-active" : ""}
                  onClick={() => setActionFilter(filter.key)}
                >
                  {filter.label}
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
      {Array.from({ length: 7 }).map((_, index) => (
        <div className={`skeleton-card skeleton-${index % 3}`} key={index} />
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
      <Sparkles size={22} />
      <p>{type === "memos" ? "머릿속 생각, 여기 내려놓으세요 ☁️" : "할 일들이 아직 줄 서기 전이에요"}</p>
    </motion.div>
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

  const handleCopy = async (event) => {
    event.stopPropagation();
    try {
      await copyToClipboard(memo.text);
      setIsCopied(true);
      window.setTimeout(() => setIsCopied(false), 1300);
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
        dragElastic={0.08}
        onDragEnd={(_, info) => {
          if (info.offset.x < -82 || info.velocity.x < -560) onDelete(memo.id);
        }}
        onTap={() => !isEditing && setIsEditing(true)}
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ x: -100, opacity: 0 }}
        whileTap={{ scale: 0.98 }}
        transition={{ type: "spring", stiffness: 290, damping: 25, delay: index * 0.025 }}
        className="memo-card"
      >
        <div className="memo-header">
          <div className="memo-meta">
            <span className="tag-chip">{memo.tag}</span>
            <time>{relativeTime(memo.createdAt, tick)}</time>
          </div>
          <button
            type="button"
            className={`memo-copy ${isCopied ? "is-copied" : ""}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={handleCopy}
            aria-label="메모 복사"
            title={isCopied ? "복사됨" : "복사"}
          >
            {isCopied ? <Check size={15} /> : <Copy size={15} />}
          </button>
        </div>
        {isEditing ? (
          <textarea
            ref={inputRef}
            className="memo-edit"
            value={draft}
            rows={Math.min(6, Math.max(3, draft.split("\n").length + 1))}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={finishEdit}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) finishEdit();
              if (event.key === "Escape") setIsEditing(false);
            }}
          />
        ) : (
          <p>{memo.text}</p>
        )}
      </motion.article>
    </motion.div>
  );
}

function CheckMark({ done }) {
  return (
    <motion.span
      className={`check-wrap ${done ? "is-done" : ""}`}
      animate={done ? { scale: [1, 1.2, 1] } : { scale: 1 }}
      transition={{ duration: 0.34 }}
    >
      {done ? (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
        <Circle size={22} strokeWidth={1.8} />
      )}
    </motion.span>
  );
}

function ActionCard({ action, index, onToggle, onDelete }) {
  const pastDue = isPastDue(action.dueDate, action.done);

  return (
    <motion.div className="swipe-shell">
      <div className="delete-reveal">
        <Trash2 size={18} />
      </div>
      <motion.article
        layout
        drag="x"
        dragConstraints={{ left: -112, right: 0 }}
        dragElastic={0.08}
        onDragEnd={(_, info) => {
          if (info.offset.x < -82 || info.velocity.x < -560) onDelete(action.id);
        }}
        onTap={() => onToggle(action.id)}
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ x: -100, opacity: 0 }}
        whileTap={{ scale: 0.98 }}
        transition={{ type: "spring", stiffness: 290, damping: 25, delay: index * 0.025 }}
        className={`action-card ${action.done ? "is-done" : ""} ${
          action.priority === "high" ? "is-high" : ""
        }`}
      >
        <CheckMark done={action.done} />
        <div className="min-w-0 flex-1">
          <p>{action.text}</p>
          <div className="action-meta">
            <span className={pastDue ? "is-past" : ""}>
              <CalendarDays size={14} />
              {formatDueDate(action.dueDate)}
            </span>
            <span className={`priority-pill ${action.priority === "high" ? "is-high" : ""}`}>
              {action.priority === "high" && <Flame size={13} />}
              {action.priority === "high" ? "높음" : "보통"}
            </span>
          </div>
        </div>
      </motion.article>
    </motion.div>
  );
}

function BottomComposer({
  activeView,
  memoText,
  setMemoText,
  selectedTag,
  setSelectedTag,
  onAddMemo,
  actionText,
  setActionText,
  actionDueDate,
  setActionDueDate,
  actionPriority,
  setActionPriority,
  onAddAction,
  aiSettings,
  setAiSettings,
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
      onSubmit={(event) => {
        event.preventDefault();
        activeView === "memos" ? onAddMemo() : onAddAction();
      }}
      initial={{ y: 120, opacity: 0.96 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
    >
      <AnimatePresence mode="wait" initial={false}>
        {activeView === "memos" ? (
          <motion.div
            key="memo-composer"
            initial={{ y: 18, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -18, opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <div className="chip-row">
              {TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className={`tag-choice ${selectedTag === tag ? "is-active" : ""}`}
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
                onChange={(event) => setMemoText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    onAddMemo();
                  }
                }}
                placeholder="빠르게 메모"
              />
              <button
                type="button"
                className="correct-button"
                disabled={!draftText.trim() || isCorrecting}
                onClick={() => onCorrectDraft(activeView, () => setIsAiOpen(true))}
                aria-label="AI 한국어 교정"
              >
                <Sparkles size={17} />
              </button>
              <button type="submit" className="send-button" aria-label="메모 추가">
                <Send size={18} />
              </button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="action-composer"
            initial={{ y: 18, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -18, opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <div className="action-controls">
              <label>
                <CalendarDays size={15} />
                <input
                  type="date"
                  value={actionDueDate}
                  onChange={(event) => setActionDueDate(event.target.value)}
                />
              </label>
              <button
                type="button"
                className={actionPriority === "high" ? "is-high" : ""}
                onClick={() => setActionPriority((value) => (value === "high" ? "normal" : "high"))}
              >
                <Flame size={15} />
                {actionPriority === "high" ? "높음" : "보통"}
              </button>
            </div>
            <div className="composer-line">
              <input
                ref={inputRef}
                value={actionText}
                onChange={(event) => setActionText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    onAddAction();
                  }
                }}
                placeholder="다음 액션"
              />
              <button
                type="button"
                className="correct-button"
                disabled={!draftText.trim() || isCorrecting}
                onClick={() => onCorrectDraft(activeView, () => setIsAiOpen(true))}
                aria-label="AI 한국어 교정"
              >
                <Sparkles size={17} />
              </button>
              <button type="submit" className="send-button" aria-label="액션 추가">
                <Plus size={19} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="ai-row">
        <button type="button" className="ai-toggle" onClick={() => setIsAiOpen((value) => !value)}>
          <KeyRound size={15} />
          {aiSettings.apiKey ? "AI 설정됨" : "AI 설정"}
        </button>
        <button
          type="button"
          className={`ai-status ${aiStatus.state}`}
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
              onChange={(event) =>
                setAiSettings((settings) => ({ ...settings, apiKey: event.target.value.trim() }))
              }
              placeholder="Gemini API key"
              aria-label="Gemini API key"
            />
            <select
              value={aiSettings.model}
              onChange={(event) =>
                setAiSettings((settings) => ({ ...settings, model: event.target.value }))
              }
              aria-label="AI 모델"
            >
              {AI_MODELS.map((model) => (
                <option key={model.key} value={model.key}>
                  {model.label}
                </option>
              ))}
            </select>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.form>
  );
}

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
    let isMounted = true;

    const hydrate = async () => {
      const [storedMemos, storedActions] = await Promise.all([
        loadStoredJson("memos", []),
        loadStoredJson("actions", []),
      ]);
      const storedAiSettings = await loadStoredJson("aiSettings", {
        apiKey: "",
        model: DEFAULT_AI_MODEL,
      });

      if (!isMounted) return;
      setMemos(Array.isArray(storedMemos) ? storedMemos : []);
      setActions(Array.isArray(storedActions) ? storedActions : []);
      if (storedAiSettings && typeof storedAiSettings === "object") {
        setAiSettings({
          apiKey: typeof storedAiSettings.apiKey === "string" ? storedAiSettings.apiKey : "",
          model: normalizeAiModel(storedAiSettings.model),
        });
        setAiStatus({
          state: "idle",
          message: `Gemini 교정: ${normalizeAiModel(storedAiSettings.model)}`,
        });
      }
      hasHydrated.current = true;
      window.setTimeout(() => isMounted && setIsLoaded(true), 260);
    };

    hydrate();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setTick(Date.now()), 30000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (hasHydrated.current) saveStoredJson("memos", memos);
  }, [memos]);

  useEffect(() => {
    if (hasHydrated.current) saveStoredJson("actions", actions);
  }, [actions]);

  useEffect(() => {
    if (hasHydrated.current) saveStoredJson("aiSettings", aiSettings);
  }, [aiSettings]);

  const filteredActions = useMemo(() => {
    if (actionFilter === "active") return actions.filter((action) => !action.done);
    if (actionFilter === "done") return actions.filter((action) => action.done);
    return actions;
  }, [actions, actionFilter]);

  const addMemo = () => {
    const text = memoText.trim();
    if (!text) return;

    setMemos((current) => [
      {
        id: createId(),
        text,
        tag: selectedTag,
        createdAt: nowIso(),
      },
      ...current,
    ]);
    setMemoText("");
  };

  const addAction = () => {
    const text = actionText.trim();
    if (!text) return;

    setActions((current) => [
      {
        id: createId(),
        text,
        dueDate: actionDueDate,
        priority: actionPriority,
        done: false,
        createdAt: nowIso(),
      },
      ...current,
    ]);
    setActionText("");
  };

  const deleteMemo = (id) => setMemos((current) => current.filter((memo) => memo.id !== id));
  const editMemo = (id, text) =>
    setMemos((current) => current.map((memo) => (memo.id === id ? { ...memo, text } : memo)));
  const deleteAction = (id) =>
    setActions((current) => current.filter((action) => action.id !== id));
  const toggleAction = (id) =>
    setActions((current) =>
      current.map((action) => (action.id === id ? { ...action, done: !action.done } : action)),
    );

  const correctDraft = async (type, openSettings) => {
    const text = type === "memos" ? memoText.trim() : actionText.trim();
    if (!text) return;

    if (!aiSettings.apiKey) {
      setAiStatus({ state: "error", message: "API 키 필요" });
      openSettings();
      return;
    }

    setCorrectionError(null);

    const fallbackModels = getModelFallbacks(normalizeAiModel(aiSettings.model));
    let lastError = null;
    let lastModel = fallbackModels[fallbackModels.length - 1] || DEFAULT_AI_MODEL;

    for (let index = 0; index < fallbackModels.length; index += 1) {
      const model = fallbackModels[index];
      lastModel = model;
      setAiSettings((settings) => ({ ...settings, model }));
      setAiStatus({
        state: "loading",
        message: index === 0 ? `${model} 교정 중...` : `${model}로 재시도 중...`,
      });

      try {
        const corrected = await correctKoreanText({
          apiKey: aiSettings.apiKey,
          model,
          text,
          type,
        });

        if (type === "memos") setMemoText(corrected);
        else setActionText(corrected);
        setAiStatus({
          state: "success",
          message: index === 0 ? "교정 완료" : `${model}로 교정 완료`,
        });
        return;
      } catch (error) {
        lastError = error;
      }
    }

    openSettings();
    const message = lastError instanceof Error ? lastError.message : "교정 실패";
    setAiStatus({ state: "error", message });
    setCorrectionError({ model: lastModel, message });
  };

  return (
    <main className="app-shell">
      <style>{`
        html,
        body,
        #root {
          margin: 0;
          min-height: 100%;
        }

        body {
          background: #0a0a0f;
        }

        .mx-auto {
          margin-left: auto;
          margin-right: auto;
        }

        .flex {
          display: flex;
        }

        .grid {
          display: grid;
        }

        .w-full {
          width: 100%;
        }

        .max-w-\\[430px\\] {
          max-width: 430px;
        }

        .flex-col {
          flex-direction: column;
        }

        .items-center {
          align-items: center;
        }

        .justify-between {
          justify-content: space-between;
        }

        .min-w-0 {
          min-width: 0;
        }

        .flex-1 {
          flex: 1 1 0%;
        }

        .gap-2 {
          gap: 0.5rem;
        }

        .gap-3 {
          gap: 0.75rem;
        }

        .px-4 {
          padding-left: 1rem;
          padding-right: 1rem;
        }

        .pt-3 {
          padding-top: 0.75rem;
        }

        :root {
          color-scheme: dark;
          --amber: #f59e0b;
          --bg: #0a0a0f;
          --text: rgba(255,255,255,0.92);
          --muted: rgba(255,255,255,0.55);
          --faint: rgba(255,255,255,0.32);
          --line: rgba(255,255,255,0.08);
          --glass: rgba(255,255,255,0.065);
          --glass-strong: rgba(255,255,255,0.105);
          font-family: -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Segoe UI', system-ui, sans-serif;
          letter-spacing: 0;
        }

        * {
          box-sizing: border-box;
          -webkit-tap-highlight-color: transparent;
        }

        button, input, textarea {
          font: inherit;
        }

        button {
          min-width: 44px;
          min-height: 44px;
          border: 0;
          cursor: pointer;
        }

        .app-shell {
          position: relative;
          min-height: 100vh;
          min-height: 100dvh;
          overflow: hidden;
          background:
            radial-gradient(circle at 18% 12%, rgba(127, 63, 255, 0.26), transparent 34%),
            radial-gradient(circle at 86% 18%, rgba(20, 184, 166, 0.18), transparent 29%),
            radial-gradient(circle at 72% 82%, rgba(245, 158, 11, 0.15), transparent 32%),
            linear-gradient(180deg, #0a0a0f 0%, #101016 100%);
          color: var(--text);
          display: flex;
          justify-content: center;
        }

        .app-shell::before {
          content: "";
          position: fixed;
          inset: 0;
          pointer-events: none;
          background:
            linear-gradient(rgba(255,255,255,0.024) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.018) 1px, transparent 1px);
          background-size: 34px 34px;
          mask-image: linear-gradient(to bottom, rgba(0,0,0,0.7), transparent 74%);
        }

        .phone-frame {
          width: min(100vw, 430px);
          min-height: 100vh;
          min-height: 100dvh;
          position: relative;
          overflow: hidden;
          border-left: 1px solid rgba(255,255,255,0.06);
          border-right: 1px solid rgba(255,255,255,0.06);
          box-shadow: 0 28px 90px rgba(0,0,0,0.36);
        }

        .top-chrome {
          position: fixed;
          z-index: 20;
          top: 0;
          left: 50%;
          transform: translateX(-50%);
          width: min(100vw, 430px);
          padding-top: env(safe-area-inset-top);
          padding-bottom: 12px;
          background: linear-gradient(180deg, rgba(10,10,15,0.86), rgba(10,10,15,0.56));
          backdrop-filter: blur(20px);
          border-bottom: 1px solid rgba(255,255,255,0.06);
          transition: padding 180ms ease, background 180ms ease, border-color 180ms ease;
        }

        .top-chrome.is-compact {
          padding-bottom: 9px;
          background: rgba(10,10,15,0.78);
          border-color: rgba(255,255,255,0.1);
        }

        .kicker {
          margin: 0 0 2px;
          color: var(--amber);
          font-family: 'SF Mono', ui-monospace, Menlo, Consolas, monospace;
          font-size: 11px;
          font-weight: 600;
        }

        h1 {
          margin: 0;
          font-size: 23px;
          line-height: 1.12;
          font-weight: 700;
        }

        .top-chrome.is-compact h1 {
          font-size: 19px;
        }

        .sync-orb {
          width: 44px;
          height: 44px;
          display: grid;
          place-items: center;
          color: var(--amber);
          border-radius: 999px;
          background: rgba(245,158,11,0.11);
          border: 1px solid rgba(245,158,11,0.24);
          box-shadow: 0 12px 34px rgba(245,158,11,0.12);
        }

        .mode-tabs {
          position: relative;
          display: grid;
          grid-template-columns: 1fr 1fr;
          min-height: 52px;
          padding: 5px;
          border-radius: 999px;
          background: rgba(255,255,255,0.075);
          border: 1px solid var(--line);
          box-shadow: 0 20px 46px rgba(0,0,0,0.18);
          overflow: hidden;
        }

        .mode-indicator {
          position: absolute;
          top: 5px;
          left: 5px;
          width: calc(50% - 5px);
          height: calc(100% - 10px);
          border-radius: 999px;
          background: rgba(245,158,11,0.98);
          box-shadow: 0 10px 25px rgba(245,158,11,0.24);
        }

        .mode-tabs button {
          position: relative;
          z-index: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          color: var(--muted);
          background: transparent;
          border-radius: 999px;
          font-size: 14px;
          font-weight: 600;
        }

        .mode-tabs button.is-active {
          color: #111113;
        }

        .filter-tabs {
          min-height: 44px;
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 5px;
          color: var(--muted);
          border-radius: 999px;
          background: rgba(255,255,255,0.055);
          border: 1px solid var(--line);
        }

        .filter-tabs svg {
          margin-left: 9px;
          color: var(--faint);
        }

        .filter-tabs button {
          flex: 1;
          border-radius: 999px;
          background: transparent;
          color: var(--muted);
          font-size: 13px;
          font-weight: 500;
        }

        .filter-tabs button.is-active {
          color: var(--text);
          background: rgba(255,255,255,0.11);
        }

        .scroll-stage {
          width: min(100vw, 430px);
          height: 100vh;
          height: 100dvh;
          overflow-y: auto;
          scrollbar-width: none;
          padding: 178px 14px 232px;
        }

        .scroll-stage::-webkit-scrollbar {
          display: none;
        }

        .memo-list {
          display: flex;
          flex-direction: column;
          overflow: hidden;
          border-radius: 8px;
          background: rgba(255,255,255,0.052);
          border: 1px solid var(--line);
          backdrop-filter: blur(20px);
        }

        .swipe-shell {
          position: relative;
          border-radius: 8px;
          overflow: hidden;
        }

        .memo-list .swipe-shell {
          border-radius: 0;
          border-bottom: 1px solid rgba(255,255,255,0.065);
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
          padding-right: 18px;
          color: #fff;
          background: linear-gradient(90deg, transparent, rgba(239,68,68,0.62));
        }

        .memo-card, .action-card {
          position: relative;
          width: 100%;
          border-radius: 8px;
          background: var(--glass);
          border: 1px solid var(--line);
          backdrop-filter: blur(20px);
          box-shadow: 0 18px 42px rgba(0,0,0,0.22);
          transform-origin: center;
          touch-action: pan-y;
        }

        .memo-card {
          min-height: 84px;
          padding: 12px 12px 13px;
          border: 0;
          border-radius: 0;
          background: rgba(14,14,20,0.42);
          box-shadow: none;
          backdrop-filter: none;
        }

        .memo-card:active {
          background: rgba(255,255,255,0.075);
        }

        .memo-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }

        .memo-meta {
          display: flex;
          align-items: center;
          min-width: 0;
          gap: 8px;
        }

        .memo-card p {
          margin: 9px 0 0;
          overflow-wrap: anywhere;
          color: rgba(255,255,255,0.88);
          font-size: 14px;
          line-height: 1.5;
          font-weight: 400;
        }

        .memo-card time {
          color: var(--faint);
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          white-space: nowrap;
        }

        .tag-chip, .tag-choice {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 30px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.08);
          color: rgba(255,255,255,0.68);
          background: rgba(255,255,255,0.08);
          backdrop-filter: blur(14px);
          font-size: 11px;
          font-weight: 600;
          white-space: nowrap;
        }

        .tag-chip {
          max-width: 82px;
          padding: 0 8px;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .memo-copy {
          flex: 0 0 34px;
          width: 34px;
          min-width: 34px;
          height: 34px;
          min-height: 34px;
          display: grid;
          place-items: center;
          border-radius: 999px;
          color: rgba(255,255,255,0.62);
          background: rgba(255,255,255,0.055);
          border: 1px solid rgba(255,255,255,0.07);
        }

        .memo-copy.is-copied {
          color: #111113;
          background: var(--amber);
          border-color: rgba(245,158,11,0.8);
        }

        .memo-edit {
          width: 100%;
          min-height: 82px;
          margin-top: 10px;
          resize: none;
          border: 0;
          outline: 0;
          color: var(--text);
          background: rgba(0,0,0,0.18);
          border-radius: 8px;
          padding: 9px;
          line-height: 1.5;
          font-size: 13px;
        }

        .action-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .action-card {
          display: flex;
          align-items: center;
          gap: 13px;
          min-height: 76px;
          padding: 14px;
        }

        .action-card.is-high {
          box-shadow: inset 3px 0 0 var(--amber), 0 18px 42px rgba(0,0,0,0.22), -8px 0 26px rgba(245,158,11,0.12);
        }

        .action-card.is-done {
          opacity: 0.4;
          filter: saturate(0.62);
        }

        .action-card p {
          margin: 0;
          overflow-wrap: anywhere;
          color: var(--text);
          font-size: 15px;
          line-height: 1.45;
          font-weight: 520;
        }

        .action-card.is-done p {
          text-decoration: line-through;
          color: rgba(255,255,255,0.62);
        }

        .check-wrap {
          width: 44px;
          height: 44px;
          flex: 0 0 44px;
          display: grid;
          place-items: center;
          border-radius: 999px;
          color: rgba(255,255,255,0.58);
          background: rgba(255,255,255,0.055);
          border: 1px solid var(--line);
        }

        .check-wrap.is-done {
          color: #111113;
          background: var(--amber);
          border-color: rgba(245,158,11,0.68);
        }

        .action-meta {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 7px;
          margin-top: 8px;
          color: var(--faint);
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
        }

        .action-meta span {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          min-height: 26px;
        }

        .action-meta .is-past {
          color: rgba(245,158,11,0.94);
        }

        .priority-pill {
          padding: 0 9px;
          border-radius: 999px;
          color: rgba(255,255,255,0.58);
          background: rgba(255,255,255,0.07);
          border: 1px solid var(--line);
          font-family: 'Noto Sans KR', system-ui, sans-serif;
          font-size: 11px;
          font-weight: 700;
        }

        .priority-pill.is-high {
          color: #1d1304;
          background: var(--amber);
          border-color: rgba(245,158,11,0.72);
        }

        .empty-state {
          min-height: 260px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          text-align: center;
          color: rgba(255,255,255,0.58);
          font-weight: 500;
        }

        .empty-state svg {
          color: var(--amber);
        }

        .skeleton-wrap {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .skeleton-card {
          height: 78px;
          border-radius: 8px;
          background: linear-gradient(100deg, rgba(255,255,255,0.045), rgba(255,255,255,0.12), rgba(255,255,255,0.045));
          background-size: 240% 100%;
          animation: shimmer 1.1s linear infinite;
          border: 1px solid var(--line);
        }

        .skeleton-1 {
          height: 92px;
        }

        .skeleton-2 {
          height: 70px;
        }

        @keyframes shimmer {
          0% { background-position: 120% 0; }
          100% { background-position: -120% 0; }
        }

        .bottom-sheet {
          position: fixed;
          z-index: 30;
          left: 50%;
          bottom: 0;
          transform: translateX(-50%);
          width: min(calc(100vw - 18px), 412px);
          padding: 12px 12px calc(12px + env(safe-area-inset-bottom));
          border-radius: 24px 24px 0 0;
          background: rgba(14,14,20,0.83);
          border: 1px solid rgba(255,255,255,0.1);
          border-bottom: 0;
          backdrop-filter: blur(24px);
          box-shadow: 0 -24px 70px rgba(0,0,0,0.42);
        }

        .chip-row {
          display: flex;
          gap: 7px;
          margin-bottom: 9px;
          overflow-x: auto;
          scrollbar-width: none;
        }

        .chip-row::-webkit-scrollbar {
          display: none;
        }

        .tag-choice {
          flex: 1;
          min-height: 44px;
          color: var(--muted);
          background: rgba(255,255,255,0.055);
        }

        .tag-choice.is-active {
          color: #111113;
          background: var(--amber);
          border-color: rgba(245,158,11,0.82);
        }

        .composer-line {
          position: relative;
          display: flex;
          align-items: center;
          gap: 9px;
          min-height: 56px;
          padding: 5px;
          border-radius: 999px;
          background: linear-gradient(rgba(18,18,24,0.95), rgba(18,18,24,0.95)) padding-box,
            linear-gradient(110deg, rgba(255,255,255,0.12), rgba(245,158,11,0.28), rgba(255,255,255,0.12)) border-box;
          border: 1px solid transparent;
          transition: box-shadow 180ms ease;
        }

        .composer-line:focus-within {
          animation: borderSweep 1.6s linear infinite;
          box-shadow: 0 0 0 4px rgba(245,158,11,0.08), 0 18px 42px rgba(245,158,11,0.08);
        }

        @keyframes borderSweep {
          0% { filter: hue-rotate(0deg) brightness(1); }
          50% { filter: hue-rotate(12deg) brightness(1.12); }
          100% { filter: hue-rotate(0deg) brightness(1); }
        }

        .composer-line input {
          width: 100%;
          min-width: 0;
          min-height: 44px;
          border: 0;
          outline: 0;
          padding: 0 7px 0 13px;
          color: var(--text);
          background: transparent;
          font-size: 15px;
          font-weight: 500;
        }

        .composer-line input::placeholder {
          color: rgba(255,255,255,0.36);
        }

        .send-button {
          flex: 0 0 46px;
          width: 46px;
          height: 46px;
          display: grid;
          place-items: center;
          border-radius: 999px;
          color: #111113;
          background: var(--amber);
          box-shadow: 0 12px 30px rgba(245,158,11,0.22);
        }

        .correct-button {
          flex: 0 0 44px;
          width: 44px;
          height: 44px;
          display: grid;
          place-items: center;
          border-radius: 999px;
          color: var(--amber);
          background: rgba(245,158,11,0.12);
          border: 1px solid rgba(245,158,11,0.24);
        }

        .correct-button:disabled {
          cursor: default;
          opacity: 0.38;
          filter: saturate(0.6);
        }

        .ai-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          min-height: 36px;
          padding: 8px 4px 0;
        }

        .ai-toggle {
          min-height: 34px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 0 10px;
          border-radius: 999px;
          color: rgba(255,255,255,0.68);
          background: rgba(255,255,255,0.055);
          border: 1px solid var(--line);
          font-size: 12px;
          font-weight: 700;
        }

        .ai-status {
          min-height: 34px;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          text-align: right;
          color: var(--faint);
          background: transparent;
          font-size: 12px;
          font-weight: 600;
        }

        .ai-status.loading,
        .ai-status.success {
          color: var(--amber);
        }

        .ai-status.error {
          color: rgba(248,113,113,0.92);
        }

        .ai-panel {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 154px;
          gap: 8px;
          overflow: hidden;
          padding: 8px 4px 0;
        }

        .ai-panel input,
        .ai-panel select {
          min-width: 0;
          min-height: 42px;
          border-radius: 999px;
          border: 1px solid var(--line);
          outline: 0;
          color: var(--text);
          background: rgba(255,255,255,0.055);
          padding: 0 12px;
          font-size: 12px;
          font-weight: 600;
        }

        .ai-panel select {
          color-scheme: dark;
        }

        .modal-backdrop {
          position: fixed;
          z-index: 80;
          inset: 0;
          display: grid;
          place-items: center;
          padding: 22px;
          background: rgba(0,0,0,0.58);
          backdrop-filter: blur(12px);
        }

        .error-modal {
          width: min(100%, 360px);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          padding: 22px;
          text-align: center;
          border-radius: 8px;
          color: var(--text);
          background: rgba(18,18,24,0.96);
          border: 1px solid rgba(248,113,113,0.24);
          box-shadow: 0 28px 90px rgba(0,0,0,0.48);
        }

        .error-modal svg {
          color: rgba(248,113,113,0.92);
        }

        .error-modal h2 {
          margin: 0;
          font-size: 18px;
          line-height: 1.3;
        }

        .error-modal p {
          margin: 0;
          color: rgba(255,255,255,0.7);
          font-size: 14px;
          line-height: 1.55;
          overflow-wrap: anywhere;
        }

        .error-meta {
          width: 100%;
          min-height: 42px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 0 12px;
          border-radius: 8px;
          background: rgba(255,255,255,0.055);
          border: 1px solid var(--line);
          font-size: 12px;
        }

        .error-meta span {
          color: var(--muted);
        }

        .error-modal button {
          width: 100%;
          min-height: 46px;
          border-radius: 999px;
          color: #111113;
          background: var(--amber);
          font-size: 14px;
          font-weight: 800;
        }

        .action-controls {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 92px;
          gap: 8px;
          margin-bottom: 9px;
        }

        .action-controls label,
        .action-controls button {
          min-height: 44px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          border-radius: 999px;
          color: var(--muted);
          background: rgba(255,255,255,0.055);
          border: 1px solid var(--line);
        }

        .action-controls input[type="date"] {
          width: 128px;
          min-height: 38px;
          color: var(--text);
          color-scheme: dark;
          background: transparent;
          border: 0;
          outline: 0;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
        }

        .action-controls button {
          font-size: 13px;
          font-weight: 700;
        }

        .action-controls button.is-high {
          color: #111113;
          background: var(--amber);
          border-color: rgba(245,158,11,0.82);
        }

        @media (max-width: 360px) {
          .scroll-stage {
            padding-left: 10px;
            padding-right: 10px;
          }

          .tag-chip {
            max-width: 62px;
          }
        }

        @media (min-width: 700px) and (orientation: portrait) {
          .phone-frame,
          .top-chrome,
          .scroll-stage {
            width: min(calc(100vw - 40px), 720px);
          }

          .phone-frame {
            border-left: 1px solid rgba(255,255,255,0.08);
            border-right: 1px solid rgba(255,255,255,0.08);
          }

          .top-chrome .max-w-\\[430px\\] {
            max-width: 720px;
          }

          .scroll-stage {
            padding: 182px 24px 246px;
          }

          .bottom-sheet {
            width: min(calc(100vw - 64px), 680px);
          }

          .memo-card {
            min-height: 88px;
            padding: 14px 16px 15px;
          }

          .action-card {
            min-height: 84px;
            padding: 16px;
          }
        }

        @media (min-width: 640px) and (max-height: 540px) and (orientation: landscape) {
          .app-shell {
            align-items: stretch;
          }

          .phone-frame {
            width: 100vw;
            min-height: 100dvh;
            display: grid;
            grid-template-columns: 260px minmax(0, 1fr);
            grid-template-rows: auto minmax(0, 1fr);
            grid-template-areas:
              "nav content"
              "composer content";
            border-left: 0;
            border-right: 0;
            box-shadow: none;
          }

          .top-chrome {
            grid-area: nav;
            position: relative;
            top: auto;
            left: auto;
            transform: none;
            width: auto;
            padding-top: max(12px, env(safe-area-inset-top));
            padding-bottom: 12px;
            border-right: 1px solid rgba(255,255,255,0.08);
            border-bottom: 1px solid rgba(255,255,255,0.08);
            background: rgba(10,10,15,0.76);
          }

          .top-chrome.is-compact {
            padding-bottom: 12px;
          }

          .top-chrome.is-compact h1 {
            font-size: 23px;
          }

          .top-chrome .max-w-\\[430px\\] {
            max-width: none;
            padding-left: 12px;
            padding-right: 12px;
          }

          .scroll-stage {
            grid-area: content;
            width: 100%;
            height: 100dvh;
            padding: 14px 14px 18px;
          }

          .bottom-sheet {
            grid-area: composer;
            position: relative;
            left: auto;
            bottom: auto;
            transform: none;
            align-self: stretch;
            width: auto;
            max-height: 100%;
            overflow-y: auto;
            padding: 12px 12px max(12px, env(safe-area-inset-bottom));
            border-radius: 0;
            border-left: 0;
            border-right: 1px solid rgba(255,255,255,0.08);
            border-top: 0;
            background: rgba(14,14,20,0.78);
            box-shadow: none;
          }

          .chip-row {
            flex-wrap: wrap;
            overflow: visible;
          }

          .tag-choice {
            flex: 1 1 calc(50% - 7px);
          }

          .composer-line {
            border-radius: 8px;
          }

          .ai-row {
            align-items: stretch;
            flex-direction: column;
            gap: 4px;
          }

          .ai-status {
            width: 100%;
            text-align: left;
          }

          .ai-panel {
            grid-template-columns: 1fr;
          }
        }

        @media (min-width: 900px) and (orientation: landscape) {
          .app-shell {
            align-items: center;
            padding: 20px;
          }

          .phone-frame {
            width: min(calc(100vw - 40px), 1180px);
            min-height: min(860px, calc(100dvh - 40px));
            height: min(860px, calc(100dvh - 40px));
            display: grid;
            grid-template-columns: minmax(250px, 0.75fr) minmax(360px, 1.35fr) minmax(318px, 0.9fr);
            grid-template-areas: "nav content composer";
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 8px;
            background: rgba(10,10,15,0.34);
            box-shadow: 0 28px 90px rgba(0,0,0,0.36);
          }

          .top-chrome {
            grid-area: nav;
            height: 100%;
            border-right: 1px solid rgba(255,255,255,0.08);
            border-bottom: 0;
            overflow-y: auto;
          }

          .top-chrome .max-w-\\[430px\\] {
            height: 100%;
            justify-content: flex-start;
            gap: 18px;
            padding: 18px 16px;
          }

          .mode-tabs {
            min-height: 56px;
          }

          .filter-tabs {
            border-radius: 8px;
          }

          .scroll-stage {
            width: 100%;
            height: 100%;
            padding: 18px;
          }

          .memo-list,
          .action-list,
          .skeleton-wrap {
            max-width: 620px;
            margin: 0 auto;
          }

          .bottom-sheet {
            height: 100%;
            border-right: 0;
            border-left: 1px solid rgba(255,255,255,0.08);
            padding: 18px 16px;
          }

          .action-controls {
            grid-template-columns: 1fr;
          }
        }

        @media (min-width: 1180px) and (orientation: landscape) {
          .phone-frame {
            grid-template-columns: 280px minmax(420px, 1fr) 360px;
          }

          .scroll-stage {
            padding: 22px;
          }

          .memo-card p {
            font-size: 15px;
          }
        }

        @media (hover: hover) {
          .memo-list .memo-card:hover,
          .action-card:hover {
            box-shadow: 0 22px 52px rgba(0,0,0,0.28);
          }

          .memo-list .memo-card:hover {
            background: rgba(255,255,255,0.075);
            box-shadow: none;
          }
        }
      `}</style>

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
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
          <AnimatePresence mode="wait" initial={false}>
            {activeView === "memos" ? (
              <motion.div
                key="memos"
                initial={{ x: -18, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 18, opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                {!isLoaded ? (
                  <SkeletonList />
                ) : memos.length === 0 ? (
                  <EmptyState type="memos" />
                ) : (
                  <motion.div className="memo-list" layout>
                    <AnimatePresence initial={false}>
                      {memos.map((memo, index) => (
                        <MemoCard
                          key={memo.id}
                          memo={memo}
                          index={index}
                          tick={tick}
                          onDelete={deleteMemo}
                          onEdit={editMemo}
                        />
                      ))}
                    </AnimatePresence>
                  </motion.div>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="actions"
                initial={{ x: 18, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -18, opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                {!isLoaded ? (
                  <SkeletonList />
                ) : filteredActions.length === 0 ? (
                  <EmptyState type="actions" />
                ) : (
                  <motion.div className="action-list" layout>
                    <AnimatePresence initial={false}>
                      {filteredActions.map((action, index) => (
                        <ActionCard
                          key={action.id}
                          action={action}
                          index={index}
                          onToggle={toggleAction}
                          onDelete={deleteAction}
                        />
                      ))}
                    </AnimatePresence>
                  </motion.div>
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
