import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Check, Copy, Pencil, Trash2, X } from "lucide-react";
import { TAGS } from "../constants.js";
import { copyToClipboard, relativeTime } from "../utils.js";
import { useAutoResize } from "../hooks/useAutoResize.js";
import { TagBadge } from "./TagBadge.jsx";

export function MemoCard({ memo, index, tick, onDelete, onEdit }) {
  const [editing,  setEditing]  = useState(false);
  const [draft,    setDraft]    = useState(memo.text);
  const [draftTag, setDraftTag] = useState(memo.tag);
  const [copied,   setCopied]   = useState(false);
  const [expanded, setExpanded] = useState(false);
  const editorRef = useRef(null);

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
    if (!editing) { setDraft(memo.text); setDraftTag(memo.tag); }
  }, [editing, memo.text, memo.tag]);

  useAutoResize(editorRef, draft, editing);

  const commit = () => {
    const t = draft.trim();
    if (t) onEdit(memo.id, t, draftTag);
    setEditing(false);
  };

  const cancelEdit = () => {
    setDraft(memo.text);
    setDraftTag(memo.tag);
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
    <div className="swipe-wrap">
      {!editing && (
        <div className="swipe-bg">
          <div className="delete-icon-circle">
            <Trash2 size={17} />
          </div>
        </div>
      )}

      <motion.article
        drag={editing ? false : "x"}
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
        <div className="memo-top">
          <div className="memo-meta">
            <TagBadge tag={editing ? draftTag : memo.tag} />
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

        {editing ? (
          <>
            <textarea
              ref={editorRef}
              className="memo-editor"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
                if (e.key === "Escape") cancelEdit();
              }}
            />
            <div className="tag-row" style={{ marginTop: 8, marginBottom: 0 }}>
              {TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  data-tag={tag}
                  className={`tag-btn sm${draftTag === tag ? " on" : ""}`}
                  onClick={(e) => { e.stopPropagation(); setDraftTag(tag); }}
                >
                  {tag}
                </button>
              ))}
            </div>
          </>
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
