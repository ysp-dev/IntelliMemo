import { TAG_STYLES } from "../constants.js";

export function TagBadge({ tag }) {
  const s = TAG_STYLES[tag] ?? { bg: "#f3f4f6", color: "#6b7280", dot: "#9ca3af" };
  return (
    <span className="tag-badge" style={{ background: s.bg, color: s.color }}>
      <span className="tag-badge-dot" style={{ background: s.dot }} />
      {tag}
    </span>
  );
}
