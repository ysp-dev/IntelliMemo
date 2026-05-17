import { motion } from "framer-motion";
import { RotateCcw } from "lucide-react";

export function UndoToast({ msg, onUndo }) {
  return (
    <motion.div
      className="toast"
      initial={{ opacity: 0, y: 20, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
    >
      <span className="toast-msg">{msg}</span>
      <button type="button" className="toast-undo" onClick={onUndo}>
        <RotateCcw size={12} />
        되돌리기
      </button>
    </motion.div>
  );
}
