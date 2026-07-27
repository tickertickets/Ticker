// ── Movie reminder helpers ─────────────────────────────────────────────────────
export interface MovieReminder {
  movieId: string;
  title: string;
  datetime: string; // ISO string
  createdAt: string;
  note?: string;    // optional user-written note shown in the push notification
}

const KEY = "ticker_movie_reminders";

function load(): Record<string, MovieReminder> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { return {}; }
}

function save(reminders: Record<string, MovieReminder>) {
  try { localStorage.setItem(KEY, JSON.stringify(reminders)); } catch {}
}

export function setReminder(r: MovieReminder) {
  const all = load();
  all[r.movieId] = r;
  save(all);
}

export function clearReminder(movieId: string) {
  const all = load();
  delete all[movieId];
  save(all);
}

export function getReminder(movieId: string): MovieReminder | null {
  return load()[movieId] ?? null;
}

export function hasReminder(movieId: string): boolean {
  return !!load()[movieId];
}

/** Request browser notification permission. Returns true if granted. */
export async function requestNotifPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

/** Schedule a browser notification at the given ISO datetime string. */
export function scheduleNotification(movieId: string, title: string, datetimeStr: string, note?: string) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const delay = new Date(datetimeStr).getTime() - Date.now();
  if (delay <= 0 || delay > 7 * 24 * 60 * 60 * 1000) return; // only schedule within 7 days
  const tid = window.setTimeout(() => {
    // Only fire if reminder still exists
    if (!hasReminder(movieId)) return;
    new Notification(`🎬 ${title}`, {
      body: note?.trim() ? note.trim() : "คุณตั้งเตือนเรื่องนี้ไว้",
      icon: "/icon-192.png",
    });
  }, delay);
  // Store timer id so we can cancel if reminder is removed (best effort)
  try {
    const key = `ticker_notif_tid_${movieId}`;
    const prev = parseInt(sessionStorage.getItem(key) ?? "0", 10);
    if (prev) window.clearTimeout(prev);
    sessionStorage.setItem(key, String(tid));
  } catch {}
}

/** Cancel any pending browser notification timeout for a movie. */
export function cancelScheduledNotification(movieId: string) {
  try {
    const key = `ticker_notif_tid_${movieId}`;
    const tid = parseInt(sessionStorage.getItem(key) ?? "0", 10);
    if (tid) window.clearTimeout(tid);
    sessionStorage.removeItem(key);
  } catch {}
}
