import { motion } from "framer-motion";
import { CalendarDays, Flame, Trash2 } from "lucide-react";
import { formatDue, isPastDue } from "../utils.js";

export function ActionCard({ action, index, onToggle, onDelete }) {
  const overdue = isPastDue(action.dueDate, action.done);
  const isHigh  = action.priority === "high";

  return (
    <div className="swipe-wrap">
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
        <button
          type="button"
          className={`chk${action.done ? " checked" : ""}`}
          onClick={() => onToggle(action.id)}
          aria-label={action.done ? "완료 취소" : "완료 처리"}
        >
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ display: "block" }}>
            <motion.path
              d="M2 7l3.5 3.5L12 3"
              stroke="currentColor" strokeWidth="2.2"
              strokeLinecap="round" strokeLinejoin="round"
              animate={{ pathLength: action.done ? 1 : 0, opacity: action.done ? 1 : 0 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
            />
          </svg>
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

export function ActionProgress({ actions }) {
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
