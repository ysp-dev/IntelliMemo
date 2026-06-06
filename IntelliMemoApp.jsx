import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import './src/app.css';
import { AnimatePresence, motion } from "framer-motion";
import { RotateCw } from "lucide-react";

import {
  DEFAULT_TAG,
  DEFAULT_OCR_MODE,
  DEFAULT_OCR_MODEL,
  DEFAULT_OPENAI_MODEL,
  OCR_API_KEY_SESSION_KEY,
  OCR_SETTINGS_STORAGE_KEY,
  OPENAI_API_KEY_SESSION_KEY,
  OPENAI_SETTINGS_STORAGE_KEY,
  TAGS,
  UNDO_DELAY_MS,
} from "./src/constants.js";
import {
  createId,
  dateGroupLabel,
  loadJson,
  loadSessionValue,
  normalizeOcrMode,
  normalizeOcrModel,
  normalizeOpenAiModel,
  nowIso,
  saveJson,
  saveSessionValue,
} from "./src/utils.js";
import { useAiCorrection } from "./src/hooks/useAiCorrection.js";
import { Header } from "./src/components/Header.jsx";
import { Composer } from "./src/components/Composer.jsx";
import { SkeletonList } from "./src/components/SkeletonList.jsx";
import { EmptyState } from "./src/components/EmptyState.jsx";
import { MemoCard } from "./src/components/MemoCard.jsx";
import { ActionCard, ActionProgress } from "./src/components/ActionCard.jsx";
import { TagFilterStrip } from "./src/components/TagFilterStrip.jsx";
import { UndoToast } from "./src/components/UndoToast.jsx";
import { ErrorModal } from "./src/components/modals/ErrorModal.jsx";
import { CorrectionModal } from "./src/components/modals/CorrectionModal.jsx";

const PULL_REFRESH_THRESHOLD = 72;
const PULL_REFRESH_MAX = 98;
const THEME_STORAGE_KEY = "intellimemoTheme";

const normalizeThemeMode = (mode) => mode === "dark" || mode === "light" ? mode : "light";

const getDragPoint = (event) => {
  const touch = event.touches?.[0] ?? event.changedTouches?.[0];
  if (touch) return { x: touch.clientX, y: touch.clientY };
  if (typeof event.clientX === "number") return { x: event.clientX, y: event.clientY };
  return null;
};

const shouldIgnorePullTarget = (target) => {
  if (typeof Element === "undefined" || !(target instanceof Element)) return false;
  return Boolean(target.closest("button,input,textarea,select,a,[role='button'],[contenteditable='true']"));
};

const applyThemeMode = (mode) => {
  if (typeof document === "undefined") return;
  const theme = normalizeThemeMode(mode);
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#101015" : "#f0eeea");
};

const getInitialThemeMode = () => {
  if (typeof window === "undefined") return "light";
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    // Ignore storage access issues and fall back to the system preference.
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

export default function IntelliMemoApp() {
  const [activeView,     setActiveView]     = useState("memos");
  const [layoutMode,     setLayoutMode]     = useState(() =>
    typeof window !== "undefined" && window.innerWidth < 640 ? "portrait" : "landscape"
  );
  const [memos,          setMemos]          = useState([]);
  const [actions,        setActions]        = useState([]);
  const [memoText,       setMemoText]       = useState("");
  const [selectedTag,    setSelectedTag]    = useState(DEFAULT_TAG);
  const [actionText,     setActionText]     = useState("");
  const [actionDueDate,  setActionDueDate]  = useState("");
  const [actionPriority, setActionPriority] = useState("normal");
  const [ocrSettings,    setOcrSettings]    = useState({ apiKey: "", model: DEFAULT_OCR_MODEL, mode: DEFAULT_OCR_MODE });
  const [actionFilter,   setActionFilter]   = useState("all");
  const [tagFilter,      setTagFilter]      = useState("all");
  const [searchQuery,    setSearchQuery]    = useState("");
  const [searchOpen,     setSearchOpen]     = useState(false);
  const [toast,          setToast]          = useState(null);
  const [isLoaded,       setIsLoaded]       = useState(false);
  const [scrollTop,      setScrollTop]      = useState(0);
  const [pullDistance,   setPullDistance]   = useState(0);
  const [isRefreshing,   setIsRefreshing]   = useState(false);
  const [themeMode,      setThemeMode]      = useState(() => {
    const initialTheme = getInitialThemeMode();
    applyThemeMode(initialTheme);
    return initialTheme;
  });
  const [tick,           setTick]           = useState(Date.now());

  const hasHydrated  = useRef(false);
  const toastTimer   = useRef(null);
  const scrollRafRef = useRef(null);
  const stageRef = useRef(null);
  const pullStartRef = useRef(null);
  const pullDistanceRef = useRef(0);
  const refreshTimer = useRef(null);

  const {
    aiSettings, setAiSettings,
    aiStatus, setAiStatus,
    aiError, setAiError,
    pendingCorrection, setPendingCorrection,
    rateLimitInfo, setRateLimitInfo,
    rateLimitSec,
    correctDraft,
  } = useAiCorrection({ memoText, actionText, setMemoText, setActionText, hasHydrated });

  // ── Hydrate ──
  useEffect(() => {
    let alive = true;
    const hydrate = async () => {
      const [sm, sa, sai, socr] = await Promise.all([
        loadJson("memos",      []),
        loadJson("actions",    []),
        loadJson(OPENAI_SETTINGS_STORAGE_KEY, { model: DEFAULT_OPENAI_MODEL }),
        loadJson(OCR_SETTINGS_STORAGE_KEY, { model: DEFAULT_OCR_MODEL, mode: DEFAULT_OCR_MODE }),
      ]);
      if (!alive) return;

      setMemos(Array.isArray(sm) ? sm : []);
      setActions(Array.isArray(sa) ? sa : []);

      if (sai && typeof sai === "object") {
        const model = normalizeOpenAiModel(sai.model);
        setAiSettings({ apiKey: loadSessionValue(OPENAI_API_KEY_SESSION_KEY), model });
        setAiStatus({ state: "idle", message: `ChatGPT · ${model}` });
      }

      if (socr && typeof socr === "object") {
        const model = normalizeOcrModel(socr.model);
        const mode = normalizeOcrMode(socr.mode);
        setOcrSettings({ apiKey: loadSessionValue(OCR_API_KEY_SESSION_KEY), model, mode });
      }

      hasHydrated.current = true;
      setTimeout(() => alive && setIsLoaded(true), 220);
    };
    hydrate();
    return () => { alive = false; };
  }, []);

  // ── 반응형 레이아웃 ──
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const handler = (e) => setLayoutMode(e.matches ? "portrait" : "landscape");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // ── Tick ──
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
  }, []);

  useEffect(() => {
    applyThemeMode(themeMode);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    } catch {
      // Theme still works for the current session even if storage is blocked.
    }
  }, [themeMode]);

  // ── Persist ──
  useEffect(() => { if (hasHydrated.current) saveJson("memos",   memos);   }, [memos]);
  useEffect(() => { if (hasHydrated.current) saveJson("actions", actions); }, [actions]);
  useEffect(() => {
    if (!hasHydrated.current) return;
    saveJson(OCR_SETTINGS_STORAGE_KEY, {
      model: normalizeOcrModel(ocrSettings.model),
      mode: normalizeOcrMode(ocrSettings.mode),
    });
    saveSessionValue(OCR_API_KEY_SESSION_KEY, ocrSettings.apiKey);
  }, [ocrSettings]);

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
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter((a) => a.text.toLowerCase().includes(q));
    }
    return list;
  }, [actions, actionFilter, searchQuery]);

  const filteredMemos = useMemo(() => {
    let list = tagFilter === "all" ? memos : memos.filter((m) => m.tag === tagFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter((m) => m.text.toLowerCase().includes(q));
    }
    return list;
  }, [memos, tagFilter, searchQuery]);

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
    setMemos((cur) => {
      const index = cur.findIndex((m) => m.id === id);
      if (index === -1) return cur;
      const target = cur[index];
      setTimeout(() => showToast("메모 삭제됨", () => {
        setMemos((prev) => {
          if (prev.some((m) => m.id === id)) return prev;
          const next = [...prev];
          next.splice(Math.min(index, next.length), 0, target);
          return next;
        });
      }), 0);
      return cur.filter((m) => m.id !== id);
    });
  }, [showToast]);

  const editMemo = useCallback((id, text, tag) => {
    setMemos((cur) => cur.map((m) => m.id === id ? { ...m, text, tag } : m));
  }, []);

  const deleteAction = useCallback((id) => {
    setActions((cur) => {
      const index = cur.findIndex((a) => a.id === id);
      if (index === -1) return cur;
      const target = cur[index];
      setTimeout(() => showToast("액션 삭제됨", () => {
        setActions((prev) => {
          if (prev.some((a) => a.id === id)) return prev;
          const next = [...prev];
          next.splice(Math.min(index, next.length), 0, target);
          return next;
        });
      }), 0);
      return cur.filter((a) => a.id !== id);
    });
  }, [showToast]);

  const toggleAction = useCallback((id) => {
    setActions((cur) => cur.map((a) => a.id === id ? { ...a, done: !a.done } : a));
  }, []);

  const handleScroll = useCallback((e) => {
    const top = e.currentTarget.scrollTop;
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      setScrollTop(top);
      scrollRafRef.current = null;
    });
  }, []);

  const startPullRefresh = useCallback(() => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    pullDistanceRef.current = PULL_REFRESH_THRESHOLD;
    setPullDistance(PULL_REFRESH_THRESHOLD);
    refreshTimer.current = setTimeout(() => {
      window.location.reload();
    }, 620);
  }, [isRefreshing]);

  const handlePullStart = useCallback((e) => {
    if (e.type === "mousedown" && e.button !== 0) return;
    if (isRefreshing || (stageRef.current?.scrollTop ?? 0) > 0 || shouldIgnorePullTarget(e.target)) return;
    const point = getDragPoint(e);
    if (!point) return;
    pullStartRef.current = point;
  }, [isRefreshing]);

  const handlePullMove = useCallback((e) => {
    const start = pullStartRef.current;
    const point = getDragPoint(e);
    if (!start || !point || isRefreshing) return;

    if ((stageRef.current?.scrollTop ?? 0) > 0) {
      pullStartRef.current = null;
      pullDistanceRef.current = 0;
      setPullDistance(0);
      return;
    }

    const deltaY = point.y - start.y;
    const deltaX = Math.abs(point.x - start.x);
    if (deltaY <= 0) {
      pullDistanceRef.current = 0;
      setPullDistance(0);
      return;
    }
    if (deltaX > deltaY) return;

    const nextDistance = Math.min(PULL_REFRESH_MAX, deltaY * 0.46);
    if (nextDistance > 4) {
      if (e.cancelable) e.preventDefault();
      pullDistanceRef.current = nextDistance;
      setPullDistance(nextDistance);
    }
  }, [isRefreshing]);

  const handlePullEnd = useCallback(() => {
    if (isRefreshing) return;
    const shouldRefresh = pullDistanceRef.current >= PULL_REFRESH_THRESHOLD;
    pullStartRef.current = null;
    if (shouldRefresh) {
      startPullRefresh();
      return;
    }
    pullDistanceRef.current = 0;
    setPullDistance(0);
  }, [isRefreshing, startPullRefresh]);

  const toggleThemeMode = useCallback(() => {
    setThemeMode((mode) => mode === "dark" ? "light" : "dark");
  }, []);

  const frameClass = `frame force-${layoutMode}`;
  const pullProgress = Math.min(1, pullDistance / PULL_REFRESH_THRESHOLD);
  const pullIndicatorVisible = pullDistance > 0 || isRefreshing;
  const pullIndicatorStyle = {
    "--pull-rotation": `${pullProgress * 340}deg`,
    opacity: pullIndicatorVisible ? Math.min(1, 0.24 + pullProgress) : 0,
    transform: `translate3d(-50%, ${isRefreshing ? 58 : pullDistance - 44}px, 0) scale(${0.86 + pullProgress * 0.14})`,
  };

  return (
    <main className="app">
      <div
        className={frameClass}
        onMouseDown={handlePullStart}
        onMouseMove={handlePullMove}
        onMouseUp={handlePullEnd}
        onMouseLeave={handlePullEnd}
        onTouchStart={handlePullStart}
        onTouchMove={handlePullMove}
        onTouchEnd={handlePullEnd}
        onTouchCancel={handlePullEnd}
      >
        <div
          className={`pull-refresh-indicator${isRefreshing ? " refreshing" : ""}${pullDistance >= PULL_REFRESH_THRESHOLD ? " armed" : ""}`}
          style={pullIndicatorStyle}
          aria-hidden="true"
        >
          <RotateCw size={30} strokeWidth={2.35} />
        </div>

        <Header
          activeView={activeView}
          setActiveView={setActiveView}
          actionFilter={actionFilter}
          setActionFilter={setActionFilter}
          compact={scrollTop > 20}
          layoutMode={layoutMode}
          onToggleLayout={() => setLayoutMode((m) => (m === "landscape" ? "portrait" : "landscape"))}
          themeMode={themeMode}
          onToggleTheme={toggleThemeMode}
          searchOpen={searchOpen}
          onToggleSearch={() => { if (searchOpen) { setSearchQuery(""); } setSearchOpen((o) => !o); }}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
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
          ocrSettings={ocrSettings}     setOcrSettings={setOcrSettings}
          aiStatus={aiStatus}
          onCorrectDraft={correctDraft}
          onOcrError={(err) => setAiError(err)}
          rateLimitInfo={rateLimitInfo}
          rateLimitSec={rateLimitSec}
          onRateLimit={(limitType, sec) => {
            if (limitType === "rpm") setRateLimitInfo({ type: "rpm", until: Date.now() + sec * 1000 });
            else setRateLimitInfo({ type: limitType });
          }}
          onDismissRateLimit={() => setRateLimitInfo(null)}
        />

        <section
          ref={stageRef}
          className="stage"
          onScroll={handleScroll}
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
                      memos.length > 0
                        ? <p style={{ textAlign: "center", color: "var(--t3)", fontSize: 13, padding: "32px 0" }}>
                            {searchQuery.trim() ? "검색 결과가 없습니다" : "필터 조건에 맞는 메모가 없습니다"}
                          </p>
                        : <EmptyState type="memos" />
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
                      actions.length > 0
                        ? <p style={{ textAlign: "center", color: "var(--t3)", fontSize: 13, padding: "32px 0" }}>
                            {searchQuery.trim() ? "검색 결과가 없습니다" : "필터 조건에 맞는 액션이 없습니다"}
                          </p>
                        : <EmptyState type="actions" />
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
          <footer className="app-footer">Made by Brian Park</footer>
        </section>
      </div>

      <AnimatePresence>
        {toast && (
          <UndoToast
            key="undo-toast"
            msg={toast.msg}
            onUndo={() => { toast.undo(); setToast(null); }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {aiError && (
          <ErrorModal
            key="err-modal"
            error={aiError}
            onClose={() => setAiError(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {pendingCorrection && (
          <CorrectionModal
            key="correction-modal"
            original={pendingCorrection.original}
            corrected={pendingCorrection.corrected}
            title={pendingCorrection.mode === "translate" ? "번역 제안" : "문장 교정 제안"}
            correctedLabel={pendingCorrection.mode === "translate" ? "번역" : "교정 제안"}
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
