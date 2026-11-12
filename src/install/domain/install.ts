/**
 * Where installing stands in this browser: it can be offered with the browser's own dialog
 * ("prompt"), only explained because iOS has no such dialog ("ios"), already done, or not possible.
 */
export type InstallState = "prompt" | "ios" | "installed" | "unavailable";

/** How long "Not now" keeps the notice away. */
export const DISMISS_FOR_MS = 30 * 24 * 60 * 60 * 1_000;

export function shouldOfferInstall(
  state: InstallState,
  dismissedAt: number | null,
  now: number,
): boolean {
  if (state !== "prompt" && state !== "ios") return false;
  if (dismissedAt === null) return true;
  // A time in the future means the clock moved; offering again is the harmless way to recover.
  return dismissedAt > now || now - dismissedAt >= DISMISS_FOR_MS;
}

/** iPadOS reports itself as a Mac, so only touch tells them apart. */
export function isIos({
  userAgent,
  maxTouchPoints,
}: {
  userAgent: string;
  maxTouchPoints: number;
}) {
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}
