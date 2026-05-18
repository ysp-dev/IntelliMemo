import { useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ListFilter,
  MessageSquareText,
  CheckCircle2,
  Monitor,
  RotateCcw,
  Search,
  Smartphone,
  Sparkles,
  X,
} from "lucide-react";
import { ACTION_FILTERS } from "../constants.js";

export function Header({
  activeView, setActiveView,
  actionFilter, setActionFilter,
  compact,
  layoutMode, onToggleLayout,
  searchOpen, onToggleSearch,
  searchQuery, setSearchQuery,
}) {
  const isLandscape = layoutMode === "landscape";
  const searchRef = useRef(null);
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
              className={`layout-toggle-btn${searchOpen ? " search-active" : ""}`}
              onClick={onToggleSearch}
              aria-label="검색"
              title="검색"
            >
              <Search size={15} />
            </button>
            <button
              type="button"
              className={`layout-toggle-btn${isLandscape ? " landscape-active" : ""}`}
              onClick={onToggleLayout}
              aria-label={isLandscape ? "세로 모드로 전환" : "가로 모드로 전환"}
              title={isLandscape ? "세로 모드" : "가로 모드"}
            >
              {isLandscape ? <Smartphone size={15} /> : <Monitor size={15} />}
            </button>
            <button
              type="button"
              className="layout-toggle-btn reload-btn"
              onClick={() => window.location.reload()}
              aria-label="새로고침"
              title="새로고침"
            >
              <RotateCcw size={13} />
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
                  data-filter={f.key}
                  onClick={() => setActionFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {searchOpen && (
            <motion.div
              className="search-bar-wrap"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              onAnimationComplete={() => searchRef.current?.focus()}
            >
              <div className="search-bar">
                <Search size={13} />
                <input
                  ref={searchRef}
                  type="text"
                  placeholder="검색..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && !e.nativeEvent.isComposing && onToggleSearch()}
                />
                {searchQuery && (
                  <button type="button" className="search-clear-btn" aria-label="검색어 지우기" onClick={() => setSearchQuery("")}>
                    <X size={13} />
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </header>
  );
}
