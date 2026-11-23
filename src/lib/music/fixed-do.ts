/**
 * Screen numbered-notation naming (EarMaster-style fixed Do vs movable Do).
 * Movable: 1 is the tonic. Fixed: 1 is always C. Sounding pitches stay the same.
 */
export type JianpuNaming = "movable" | "fixed";

export function isJianpuNaming(value: string | null | undefined): value is JianpuNaming {
  return value === "movable" || value === "fixed";
}

/** Pitch class used for the 1= header: C (0) when fixed-do, otherwise the written key. */
export function displayKeyPc(writtenKeyPc: number, naming: JianpuNaming): number {
  if (naming === "fixed") return 0;
  return ((writtenKeyPc % 12) + 12) % 12;
}

/** Spelling after 1=. Fixed-do always shows C; movable keeps the written name (including ♭E). */
export function displayKeyName(writtenName: string, naming: JianpuNaming): string {
  return naming === "fixed" ? "C" : writtenName;
}

/** Rebase key-signature events for display. Does not touch note pitches. */
export function rebaseKeySignatures(
  signatures: readonly { start: number; key: number }[],
  naming: JianpuNaming,
): { start: number; key: number }[] {
  return signatures.map((item) => ({ start: item.start, key: displayKeyPc(item.key, naming) }));
}

export function rebaseKeyNames(
  names: readonly { start: number; name: string }[] | undefined,
  naming: JianpuNaming,
): { start: number; name: string }[] | undefined {
  if (!names) return names;
  return names.map((item) => ({ start: item.start, name: displayKeyName(item.name, naming) }));
}
