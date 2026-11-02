const pad = (value: number) => String(value).padStart(2, "0");

/** Countdowns round up so `00:00` only appears when the time is truly over. */
export function formatClock(ms: number, rounding: "floor" | "ceil" = "floor"): string {
  const totalSeconds = rounding === "ceil" ? Math.ceil(ms / 1_000) : Math.floor(ms / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}
