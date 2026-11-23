/**
 * Lyricist / composer credits (词、曲) for the jianpu header, and helpers to
 * read a 词：… 曲：… line. Idea absorbed from 作曲大师 (zuoqu.com) published
 * jianpu layout; no upstream code. See docs/score-credits.md.
 */
import type { Score } from "./theory.ts";

export const MAX_CREDIT = 40;

export function cleanCredit(raw: string): string | undefined {
  const text = raw.replace(/\s+/g, " ").trim().slice(0, MAX_CREDIT);
  return text || undefined;
}

/**
 * Parse a credit line: `词：张三 曲：李四`, `作词：… 作曲：…`, `曲:Wang`,
 * or a bare name (treated as the composer, like ABC `C:`).
 */
export function parseCreditLine(raw: string): { lyricist?: string; composer?: string } {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return {};
  const take = (re: RegExp) => {
    const match = re.exec(text);
    return match ? cleanCredit(match[1] ?? "") : undefined;
  };
  const lyricist = take(/(?:作)?词(?:作者)?[：:]\s*(.+?)(?=\s*(?:作)?曲(?:作者)?[：:]|$)/);
  const composerLabeled = take(/(?:作)?曲(?:作者)?[：:]\s*(.+?)(?=\s*(?:作)?词(?:作者)?[：:]|$)/);
  if (lyricist || composerLabeled) {
    return { ...(lyricist ? { lyricist } : {}), ...(composerLabeled ? { composer: composerLabeled } : {}) };
  }
  const lyricistEn = take(/lyricist[：:]\s*(.+?)(?=\s*composer[：:]|$)/i);
  const composerEn = take(/composer[：:]\s*(.+?)(?=\s*lyricist[：:]|$)/i);
  if (lyricistEn || composerEn) {
    return { ...(lyricistEn ? { lyricist: lyricistEn } : {}), ...(composerEn ? { composer: composerEn } : {}) };
  }
  const bare = cleanCredit(text);
  return bare ? { composer: bare } : {};
}

export function applyCredits(score: Score, patch: { lyricist?: string | null; composer?: string | null }): Score {
  const next: Score = { ...score };
  if (patch.lyricist !== undefined) {
    const value = patch.lyricist ? cleanCredit(patch.lyricist) : undefined;
    if (value) next.lyricist = value;
    else delete next.lyricist;
  }
  if (patch.composer !== undefined) {
    const value = patch.composer ? cleanCredit(patch.composer) : undefined;
    if (value) next.composer = value;
    else delete next.composer;
  }
  return next;
}

/** `词：张三　曲：李四`, empty when neither is set. */
export function creditsLine(score: Pick<Score, "lyricist" | "composer">): string {
  const parts: string[] = [];
  if (score.lyricist) parts.push(`词：${score.lyricist}`);
  if (score.composer) parts.push(`曲：${score.composer}`);
  return parts.join("　");
}

/** One ABC / 123 `C:` line, or null when there is nothing to write. */
export function creditField(score: Pick<Score, "lyricist" | "composer">): string | null {
  if (score.lyricist && score.composer) return `词：${score.lyricist} 曲：${score.composer}`;
  if (score.lyricist) return `词：${score.lyricist}`;
  if (score.composer) return score.composer;
  return null;
}
