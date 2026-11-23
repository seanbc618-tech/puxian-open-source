const STORAGE_KEY = "puxian-haptic-v1";

function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Default on for touch devices, off for mouse-only, always overridable. */
export function hapticEnabled(store: Pick<Storage, "getItem"> | null = typeof localStorage === "undefined" ? null : localStorage): boolean {
  try {
    const value = store?.getItem(STORAGE_KEY);
    if (value === "0") return false;
    if (value === "1") return true;
  } catch {
    /* private mode */
  }
  if (reducedMotion()) return false;
  return typeof navigator !== "undefined" && (navigator.maxTouchPoints ?? 0) > 0;
}

export function setHapticEnabled(
  on: boolean,
  store: Pick<Storage, "setItem"> | null = typeof localStorage === "undefined" ? null : localStorage,
): void {
  try {
    store?.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch {
    /* private mode */
  }
}

/** A short, optional tick after a successful pick or keypad tap. */
export function tapHaptic(): void {
  if (!hapticEnabled()) return;
  try {
    navigator.vibrate?.(10);
  } catch {
    /* unsupported or blocked */
  }
}
