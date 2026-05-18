import { useRef } from "react";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { useFocusTrap } from "../../hooks/useFocusTrap.js";

export function CorrectionModal({
  original,
  corrected,
  onApply,
  onCancel,
  title = "문장 교정 제안",
  correctedLabel = "교정 제안",
}) {
  const modalRef = useRef(null);
  useFocusTrap(modalRef);
  return (
    <motion.div
      className="correction-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onClick={onCancel}
    >
      <motion.div
        ref={modalRef}
        className="correction-modal"
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="correction-modal-hdr">
          <h2>{title} <span>AI가 제안한 내용입니다</span></h2>
          <button type="button" className="correction-close-btn" aria-label="닫기" onClick={onCancel}>
            <X size={14} />
          </button>
        </div>
        <div className="correction-body">
          <div className="correction-box original">
            <p className="correction-label">원본</p>
            <p className="correction-text">{original}</p>
          </div>
          <div className="correction-arrow">↓</div>
          <div className="correction-box suggested">
            <p className="correction-label">{correctedLabel}</p>
            <p className="correction-text">{corrected}</p>
          </div>
        </div>
        <div className="correction-footer">
          <button type="button" className="correction-cancel-btn" onClick={onCancel}>취소</button>
          <button type="button" className="correction-apply-btn" onClick={onApply}>적용하기</button>
        </div>
      </motion.div>
    </motion.div>
  );
}
