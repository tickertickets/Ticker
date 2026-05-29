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
