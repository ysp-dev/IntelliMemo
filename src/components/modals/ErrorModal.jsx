import { useRef } from "react";
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { useFocusTrap } from "../../hooks/useFocusTrap.js";

export function ErrorModal({ error, onClose }) {
  const modalRef = useRef(null);
  useFocusTrap(modalRef);
  return (
    <motion.div
      className="err-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onClick={onClose}
    >
      <motion.div
        ref={modalRef}
        className="err-modal"
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="err-modal-icon">
          <Sparkles size={20} />
        </div>
        <h2 className="err-modal-title">
          {error.type === "ocr" ? "이미지 텍스트 추출 실패" : "AI 교정 실패"}
        </h2>
        <p className="err-modal-msg">{error.message}</p>
        <p className="err-modal-model">모델: {error.model}</p>
        <button type="button" className="err-modal-close" onClick={onClose}>
          확인
        </button>
      </motion.div>
    </motion.div>
  );
}
