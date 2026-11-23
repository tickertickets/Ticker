/**
 * SPA navigation stack — ใช้แทน window.history.back() ทุกจุด
 *
 * window.history.back() triggers the browser's native loading indicator in
 * Chrome PWA standalone mode. Using wouter's navigate() (pushState) avoids this.
 *
 * Usage:
 *   // In App.tsx — record every location change
 *   navStack.push(location)
 *
 *   // In any back button
 *   const [, navigate] = useLocation()
 *   <button onClick={() => navBack(navigate)} />
 *
 * WHY replace:true
 * ────────────────
 * ถ้าใช้ navigate(prev) ธรรมดา (pushState) จะเพิ่ม entry ใหม่ใน browser history
 * เช่น  [/ → /movie/abc]  กด back → navigate("/")  → history กลายเป็น [/ → /movie/abc → /]
 * แล้วกด device back อีกครั้งจะดีดกลับไป /movie/abc ซ้ำอีกที
 *
 * ใช้ navigate(prev, { replace: true }) (replaceState) จะแทนที่ entry ปัจจุบัน
 * [/ → /movie/abc] → replaceState("/") → [/ → /]
 * กด device back จาก "/" → ไปที่ "/" entry แรก ถูกต้อง ไม่ย้อนไปหน้าที่ออกมาแล้ว
 */

const _stack: string[] = [];

// Set true by navBack so the next navPush knows the stack was already fixed
// and should NOT apply the penultimate-match heuristic (which causes
// forward navigation to the same path to incorrectly pop the stack).
let _backNavPending = false;

// ── Intercept window.history.replaceState ─────────────────────────────────────
// Profile (and other pages) uses replaceState to update URL params (tab, subtab,
// album) without triggering a wouter navigation. This means navPush is never
// called with the updated URL, so navBack() would return the OLD URL without
// those params — landing the user on the wrong tab.
//
// Patching replaceState at module-load time keeps the navStack top entry in sync
// whenever URL params change via replaceState, so navBack() always navigates to
// the correct URL including the current tab/subtab/album state.
if (typeof window !== "undefined") {
  const _origReplaceState = window.history.replaceState.bind(window.history);
  window.history.replaceState = (state: unknown, title: string, url?: string | URL | null) => {
    _origReplaceState(state, title, url);
    if (url && typeof url === "string" && _stack.length > 0) {
      // Only update if the pathname is the same (purely a param change),
      // so we don't corrupt the stack when a real navigation uses replaceState.
      try {
        const newPath = url.startsWith("http") ? new URL(url).pathname + new URL(url).search : url;
        const top = _stack[_stack.length - 1]!;
        const topPath = top.split("?")[0];
        const newPathBase = newPath.split("?")[0];
        if (topPath === newPathBase) {
          _stack[_stack.length - 1] = newPath;
        }
      } catch { /* ignore malformed URLs */ }
    }
  };
}

// Set true by navBack, read (and consumed) by wasBackNavigation(). Lets a
// page distinguish "I was just navigated to via a back button" (POP-like —
// should restore scroll/tab/album state) from "I was freshly navigated into"
// (PUSH-like — should reset to a clean top-of-page state).
let _lastNavWasBack = false;

/**
 * Was the most recent navigation a navBack() (i.e. the user pressed a back
 * button) rather than a fresh forward navigation? Consumes the flag — only
 * true once per navBack() call, read it in a mount effect.
 */
export function wasBackNavigation(): boolean {
  const v = _lastNavWasBack;
  _lastNavWasBack = false;
  return v;
}

/**
 * Non-consuming peek: returns true if the most recent navigation was a
 * navBack() call, WITHOUT resetting the flag. Safe to call during the
 * React render phase (e.g. in App.tsx body) so a parent can adjust its
 * animation class before children read wasBackNavigation() in their
 * useLayoutEffects.
 */
export function peekBackNavigation(): boolean {
  return _lastNavWasBack;
}

/**
 * Module-level map: movieId → version counter.
 * Incremented each time navBack() targets that movie detail page.
 * MovieDetail reads this via useRef (Strict Mode safe) and clears it in useEffect.
 */
const _restoreMovieVersions = new Map<string, number>();

/**
 * Get the current restore version for a movieId.
 * Returns 0 if no restore is pending. Non-zero means a back-navigation
 * targeted this movie and scroll state should be restored.
 */
export function getMovieRestoreVersion(movieId: string): number {
  return _restoreMovieVersions.get(movieId) ?? 0;
}

/**
 * Clear the restore mark for a movieId after it has been consumed.
 * Safe to call multiple times (idempotent).
 */
export function clearMovieRestore(movieId: string): void {
  _restoreMovieVersions.delete(movieId);
}

/**
 * เรียกทุกครั้งที่ location เปลี่ยน (จาก App.tsx useEffect)
 */
export function navPush(path: string) {
  if (_backNavPending) {
    // navBack already popped the stack; just ensure no duplicate at top
    _backNavPending = false;
    if (_stack[_stack.length - 1] === path) return;
    _stack.push(path);
    return;
  }
  // ไม่บันทึกซ้ำ
  if (_stack[_stack.length - 1] === path) return;
  _stack.push(path);
  // จำกัดขนาดไม่ให้ leak
  if (_stack.length > 50) _stack.shift();
}

/**
 * กลับไปหน้าก่อนหน้า ไม่ต้อง window.history.back()
 * ใช้ replace:true เพื่อไม่เพิ่ม history entry ใหม่ (ป้องกัน double-back bug)
 * @param navigate  wouter navigate function (supports { replace?: boolean })
 * @param fallback  ถ้าไม่มีประวัติให้ไปที่ fallback (default "/")
 */
export function navBack(
  navigate: (path: string, opts?: { replace?: boolean }) => void,
  fallback = "/",
) {
  // Pop current page
  _stack.pop();
  _backNavPending = true;
  _lastNavWasBack = true;
  const prev = _stack[_stack.length - 1] ?? fallback;

  // If navigating back to a movie detail, mark it for scroll restoration.
  // Extract the movieId from paths like /movie/tt1234567 or /movie/tmdb%3A12345
  const movieMatch = prev.match(/^\/movie\/([^?#/]+)/);
  if (movieMatch) {
    let movieId = movieMatch[1]!;
    try { movieId = decodeURIComponent(movieId); } catch { /* keep raw */ }
    _restoreMovieVersions.set(movieId, (_restoreMovieVersions.get(movieId) ?? 0) + 1);
  }

  navigate(prev, { replace: true });
}

/**
 * ควรเรียกจาก App.tsx ผ่าน window.addEventListener("popstate", ...).
 * เมื่อผู้ใช้กดปุ่มย้อนกลับของเครื่อง (hardware back) browser จะ pop
 * browser history และ wouter จะอัปเดต location ให้อัตโนมัติ
 * แต่ navStack ของเรายังไม่รู้ว่านี่คือ back navigation — ฟังก์ชันนี้
 * ซิงค์ stack + ตั้ง restore version สำหรับ movie pages ไว้ล่วงหน้า
 * ก่อนที่ navPush จะถูกเรียกจาก useEffect ใน App.tsx
 */
export function navHandlePopState() {
  // pop the entry that was just exited
  const exited = _stack.pop();
  _backNavPending = true;
  _lastNavWasBack = true;

  // If we're navigating back TO a movie page, mark it for scroll restoration
  // (same logic as navBack — the browser already did the actual navigation).
  const dest = _stack[_stack.length - 1];
  if (dest) {
    const movieMatch = dest.match(/^\/movie\/([^?#/]+)/);
    if (movieMatch) {
      let movieId = movieMatch[1]!;
      try { movieId = decodeURIComponent(movieId); } catch { /* keep raw */ }
      _restoreMovieVersions.set(movieId, (_restoreMovieVersions.get(movieId) ?? 0) + 1);
    }
  }

  void exited; // suppress unused-variable warning
}
