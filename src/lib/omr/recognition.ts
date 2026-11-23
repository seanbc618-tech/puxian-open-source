import { kernSystemsToScore } from "./kern.ts";
import type { musicXmlToScore } from "../music/musicxml.ts";

export type OmrFragment = {
  page: number;
  system: number;
  text: string;
  complete: boolean;
  error?: string;
};
export type OmrPage = {
  page: number;
  total?: number;
  done: boolean;
  error?: string;
  warnings: string[];
};
export const fragmentLabel = (fragment: Pick<OmrFragment, "page" | "system">) =>
  `第 ${fragment.page} 页 / 第 ${fragment.system} 个系统`;

/** Keep location and raw symbols even when only a prefix can be converted. */
export function compileRecognition(
  fragments: OmrFragment[],
  pages: OmrPage[],
  title: string,
  decode: typeof musicXmlToScore,
) {
  const ordered = [...fragments].sort((a, b) => a.page - b.page || a.system - b.system);
  const issues = [
    ...pages.flatMap((p) => [
      ...p.warnings.map((w) => `第 ${p.page} 页：${w}`),
      ...(p.error ? [`第 ${p.page} 页：${p.error}`] : []),
    ]),
    ...ordered.filter((f) => f.error).map((f) => `${fragmentLabel(f)}：${f.error}`),
  ];
  const candidates = ordered.filter((f) => f.text.trim());
  if (!candidates.length) return { issues, draft: undefined };
  try {
    const result = kernSystemsToScore(
      candidates.map((f) => f.text),
      title,
      decode,
      {
        recover: true,
        labels: candidates.map(fragmentLabel),
      },
    );
    const included = result.included.map((i) => candidates[i]);
    const partial =
      pages.some((p) => !p.done) ||
      issues.length > 0 ||
      ordered.some((f) => !f.complete) ||
      included.length < ordered.length ||
      result.losses.some((l) => /未导入|仅保留/.test(l));
    return {
      issues,
      draft: {
        ...result,
        losses: [...issues, ...result.losses],
        partial,
        pages: [...new Set(included.map((f) => f.page))],
        systems: included.length,
      },
    };
  } catch (error) {
    return {
      issues: [
        ...issues,
        error instanceof Error ? error.message : "谱符暂时无法转换；可展开查看已生成谱符。",
      ],
      draft: undefined,
    };
  }
}
