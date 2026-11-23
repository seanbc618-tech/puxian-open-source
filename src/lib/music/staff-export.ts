export type StaffGeneration = {
  /** Latest render the UI asked for. */
  requested: number;
  /** Latest generation whose SVG was drawn successfully. 0 means none yet. */
  ready: number;
  /** Generation that threw. When this equals `requested`, leftover SVG is not the new score. */
  failed: number;
};

export function initialStaffGeneration(): StaffGeneration {
  return { requested: 0, ready: 0, failed: 0 };
}

export function beginStaffRender(gen: StaffGeneration): StaffGeneration {
  return { ...gen, requested: gen.requested + 1 };
}

export function noteStaffRendered(gen: StaffGeneration, generation: number): StaffGeneration {
  if (generation !== gen.requested) return gen;
  return { ...gen, ready: generation, failed: gen.failed === generation ? 0 : gen.failed };
}

/** A thrown render. Does not mark the generation ready, even if an older SVG is still in the DOM. */
export function noteStaffFailed(gen: StaffGeneration, generation: number): StaffGeneration {
  if (generation !== gen.requested) return gen;
  return {
    ...gen,
    failed: generation,
    ready: gen.ready === generation ? 0 : gen.ready,
  };
}

export type StaffWaitResult = "ready" | "failed" | "pending";

/**
 * `hasSvg` is true when any `<svg>` is mounted, including one left behind by an older success.
 * A failed current generation is never ready.
 */
export function staffWaitResult(gen: StaffGeneration, hasSvg: boolean): StaffWaitResult {
  if (gen.requested !== 0 && gen.failed === gen.requested) return "failed";
  if (gen.requested !== 0 && gen.ready === gen.requested && hasSvg) return "ready";
  return "pending";
}

export function exportFileBase(title: string): string {
  const clean = title.replace(/[\\/:*?"<>|]/g, "").trim();
  return clean || "谱线";
}

export type ExportSnapshot = {
  title: string;
  caption: string;
  /** Basename without an extension. */
  filename: string;
  markup: string;
};

/** One frozen export. Later score edits must not be read back into this object. */
export function freezeExportSnapshot(input: {
  title: string;
  caption: string;
  markup: string;
}): ExportSnapshot {
  return {
    title: input.title,
    caption: input.caption,
    filename: exportFileBase(input.title),
    markup: input.markup,
  };
}

export function exportDownloadName(snapshot: ExportSnapshot, ext: "png" | "svg"): string {
  return `${snapshot.filename}.${ext}`;
}
