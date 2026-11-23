/** One screen with 15% overlap; all positions are CSS pixels. */
export function pageTurn(top: number, height: number, max: number, direction: -1 | 1, cover = 0) {
  const limit = Number.isFinite(max) ? Math.max(0, max) : 0;
  const current = Number.isFinite(top) ? Math.max(0, Math.min(limit, top)) : 0;
  // `cover`: the band a sticky chord guide hides at the top; only the rest counts as one screen.
  const seen = Math.max(0, (height || 0) - (Number.isFinite(cover) ? Math.max(0, cover) : 0));
  return {
    top: Math.max(0, Math.min(limit, current + direction * seen * 0.85)),
    atEnd: direction === 1 && current >= limit - 1,
  };
}

/** Integrate quarter-note tempo changes, so a meter's beat unit cannot change duration. */
export function performanceSeconds(
  totalQuarters: number,
  bpm: number,
  changes: readonly { at: number; bpm?: number }[] = [],
) {
  if (
    !(totalQuarters > 0) ||
    !Number.isFinite(totalQuarters) ||
    !(bpm > 0) ||
    !Number.isFinite(bpm)
  )
    return 0;
  let seconds = 0,
    at = 0,
    tempo = bpm;
  for (const change of [...changes].sort((a, b) => a.at - b.at)) {
    if (
      !Number.isFinite(change.at) ||
      change.at < at ||
      change.at >= totalQuarters ||
      !Number.isFinite(change.bpm) ||
      !(change.bpm! > 0)
    )
      continue;
    seconds += ((change.at - at) * 60) / tempo;
    at = change.at;
    tempo = change.bpm!;
  }
  return seconds + ((totalQuarters - at) * 60) / tempo;
}

/** Pixels per second. A zero-height/empty score stays still. */
export function autoScrollSpeed(max: number, seconds: number, percent = 100) {
  if (!Number.isFinite(max) || !Number.isFinite(seconds) || !(max > 0 && seconds > 0)) return 0;
  return (
    ((max / seconds) * Math.max(50, Math.min(150, Number.isFinite(percent) ? percent : 100))) / 100
  );
}
