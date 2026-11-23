import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { COMPACT_TITLE_QUERY, singleLineTitle, titleFolds, titleNeedsOwnRow } from "./ui/title-fit";

function useCompactTitle() {
  const [compact, setCompact] = useState(
    () => typeof window !== "undefined" && window.matchMedia(COMPACT_TITLE_QUERY).matches,
  );
  useEffect(() => {
    const query = window.matchMedia(COMPACT_TITLE_QUERY);
    const sync = () => setCompact(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return compact;
}

/**
 * Editable score title. A textarea so long names wrap to a second line instead
 * of being cut off on a phone; Enter and pasted line breaks never add a line.
 * On small phones an unfocused long title folds to one line with an ellipsis.
 */
export function ScoreTitle({ value, onChange, readOnly = false }: { value: string; onChange: (title: string) => void; readOnly?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);
  const compact = useCompactTitle();
  const long = titleNeedsOwnRow(value);
  const folded = titleFolds({ long, compact, focused });
  useLayoutEffect(() => {
    const area = ref.current;
    if (!area) return;
    const fit = () => {
      area.style.height = "auto";
      const style = getComputedStyle(area);
      const line = parseFloat(style.lineHeight) || 26;
      const pad = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
      const lines = Math.ceil(line * (folded ? 1 : 2) + pad);
      area.style.height = `${Math.max(44, Math.min(area.scrollHeight, lines))}px`;
      if (area.scrollHeight > lines + 1) area.dataset.overflow = "";
      else delete area.dataset.overflow;
    };
    fit();
    // Watch the row, not the textarea itself, so fitting never re-triggers the observer.
    let lastWidth = area.parentElement?.clientWidth ?? 0;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      const width = area.parentElement?.clientWidth ?? 0;
      if (width === lastWidth) return;
      lastWidth = width;
      requestAnimationFrame(fit);
    });
    if (area.parentElement) observer?.observe(area.parentElement);
    return () => observer?.disconnect();
  }, [value, folded]);
  return (
    <div className={clsx("score-title-box min-w-0 flex-1", long && "is-long", folded && "is-folded")}>
      <textarea
        ref={ref}
        aria-label="曲名"
        rows={1}
        spellCheck={false}
        readOnly={readOnly}
        value={value}
        title={value || undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => onChange(singleLineTitle(event.target.value))}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        className={clsx(
          "score-title bg-transparent font-display font-medium tracking-tight text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent",
          long && "is-long",
        )}
      />
      {folded ? (
        <span className="score-title-fold font-display font-medium tracking-tight text-ink" aria-hidden="true">
          {value}
        </span>
      ) : null}
    </div>
  );
}
