import { useMemo } from "react";

/**
 * slot-text port (textmotion.dev): every char sits in a clipped cell.
 * On change the old face slides up and out while the new face slides in,
 * staggered left to right. Unchanged chars never re-render (skipUnchanged).
 */
export function RollText({ value, className }) {
  const chars = useMemo(() => String(value).split(""), [value]);
  return (
    <span className={className} aria-label={value}>
      {chars.map((ch, i) => (
        <CharCell key={i} ch={ch} i={i} />
      ))}
    </span>
  );
}

function CharCell({ ch, i }) {
  // per-cell state lives in the key: changing key remounts the cell,
  // which replays the roll. Static text below never remounts.
  return (
    <span className="slot-cell" style={{ minWidth: ch === " " ? "0.35em" : undefined }}>
      <span className="slot-face in" style={{ animationDelay: `${i * 45}ms` }} key={ch}>
        {ch === " " ? "\u00A0" : ch}
      </span>
    </span>
  );
}
