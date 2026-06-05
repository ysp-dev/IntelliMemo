import { useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ListFilter,
  MessageSquareText,
  CheckCircle2,
  Moon,
  Monitor,
  Search,
  Smartphone,
  Sparkles,
  Sun,
  X,
} from "lucide-react";
import logoDark from "../assets/intelli-logo-dark.png?inline";
import logoLight from "../assets/intelli-logo-light.png?inline";
import { ACTION_FILTERS } from "../constants.js";

export function Header({
  activeView, setActiveView,
  actionFilter, setActionFilter,
  compact,
  layoutMode, onToggleLayout,
  themeMode, onToggleTheme,
  searchOpen, onToggleSearch,
  searchQuery, setSearchQuery,
}) {
  const isLandscape = layoutMode === "landscape";
  const isDarkTheme = themeMode === "dark";
  const searchRef = useRef(null);
  return (
    <header className={`hdr${compact ? " compact" : ""}`}>
      <div className="hdr-body">
        <div className="hdr-top">
          <div className="brand">
            <img
              className="brand-logo"
              src={isDarkTheme ? logoDark : logoLight}
              alt="Intelli Memo"
            />
            <h1 className="sr-only">Intelli Memo</h1>
          </div>
          <div className="hdr-actions">
            <button
              type="button"
              className={`layout-toggle-btn theme-toggle-btn ${isDarkTheme ? "theme-dark" : "theme-light"}`}
              onClick={onToggleTheme}
              aria-label={isDarkTheme ? "라이트 모드로 전환" : "다크 모드로 전환"}
              title={isDarkTheme ? "라이트 모드" : "다크 모드"}
            >
              {isDarkTheme ? <Moon size={15} /> : <Sun size={15} />}
            </button>
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
            <span className="ai-provider-badge">
              <Sparkles size={11} />
              <span className="ai-provider-label">ChatGPT · Gemini</span>
              <span className="ai-provider-short">AI</span>
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
