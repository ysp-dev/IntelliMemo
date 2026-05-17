import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";

export function EmptyState({ type }) {
  return (
    <motion.div
      className="empty"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 26 }}
    >
      <div className="empty-icon">
        <Sparkles size={22} />
      </div>
      <p>{type === "memos" ? "생각이 떠오르면 바로 기록하세요" : "할 일을 추가해 보세요"}</p>
    </motion.div>
  );
}
