import { TAG_STYLES } from "../constants.js";

export function TagFilterStrip({ selected, onChange, tags }) {
  return (
    <div className="tag-filter-strip">
      <button
        type="button"
        data-tag="all"
        className={`tf-chip${selected === "all" ? " on" : ""}`}
        onClick={() => onChange("all")}
      >
        전체
      </button>
      {tags.map((tag) => {
        const s = TAG_STYLES[tag];
        return (
          <button
            key={tag}
            type="button"
            data-tag={tag}
            className={`tf-chip${selected === tag ? " on" : ""}`}
            onClick={() => onChange(tag)}
          >
            {selected !== tag && s && (
              <span className="tf-chip-dot" style={{ background: s.dot }} />
            )}
            {tag}
          </button>
        );
      })}
    </div>
  );
}
