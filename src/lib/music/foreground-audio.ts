/** Origin of the packaged Capacitor shell. The website is http(s), not this. */
export const PACKAGED_SHELL_PROTOCOL = "capacitor:";

export const FOREGROUND_RELEASE_NOTICE =
  "已离开前台，试听和哼唱已停下。回到谱线后请再点一次，不会自动接着录。";

/**
 * Interrupt stub for the iOS shell. Hidden packaged pages should stop playback
 * and release the mic. This is not an AVAudioSession category, and it does not
 * run for the website or for a live-reload server.
 */
export function shouldReleaseForegroundAudio(visibilityState: string, protocol: string): boolean {
  return protocol === PACKAGED_SHELL_PROTOCOL && visibilityState === "hidden";
}
