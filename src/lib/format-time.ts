/** Format playback positions without creating a live announcement for each update. */
export function formatTime(time: number | null): string {
  if (time === null || !Number.isFinite(time)) return "--:--";
  const seconds = Math.floor(time);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
