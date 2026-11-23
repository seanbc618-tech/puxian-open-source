/** Phone score-head: the title shares a row with ~250px of view tools. */
export const INLINE_TITLE_PX = 84;
export const TITLE_FONT_PX = 20;

const WIDE = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/u;

/** Rough rendered width: CJK / full-width glyphs are 1em, everything else ~0.56em. */
export function estimateTitleWidth(title: string, fontPx = TITLE_FONT_PX): number {
  let em = 0;
  for (const char of title) em += WIDE.test(char) ? 1 : char === " " ? 0.3 : 0.56;
  return em * fontPx;
}

/** True when the title would be cut off beside the tools and should get its own row. */
export function titleNeedsOwnRow(title: string, inlinePx = INLINE_TITLE_PX): boolean {
  return estimateTitleWidth(title) > inlinePx;
}

/** A score title is one logical line; pasted line breaks and tabs become spaces. */
export function singleLineTitle(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ");
}

/**
 * Small phones (≤359px wide, or a short phone screen such as 320×667 / 375×667):
 * two title lines would squeeze the score, so an unfocused long title folds to one
 * line with an ellipsis and unfolds (up to two lines) while it is being edited.
 */
export const COMPACT_TITLE_QUERY = "(max-width: 359px), (max-width: 639px) and (max-height: 700px)";

export function titleFolds(state: { long: boolean; compact: boolean; focused: boolean }): boolean {
  return state.long && state.compact && !state.focused;
}
