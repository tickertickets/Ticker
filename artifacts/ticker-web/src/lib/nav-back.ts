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

/**
 * เรียกทุกครั้งที่ location เปลี่ยน (จาก App.tsx useEffect)
 * ถ้า path ใหม่ตรงกับรายการก่อนหน้า (penultimate) แสดงว่าเป็นการกด back
 * (device back button / popstate) → pop แทน push เพื่อให้ stack ถูกต้อง
 */
export function navPush(path: string) {
  // ตรวจว่าเป็น back navigation (path ใหม่ = entry ก่อน current)
  if (_stack.length >= 2 && _stack[_stack.length - 2] === path) {
    _stack.pop();
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
  const prev = _stack[_stack.length - 1] ?? fallback;
  navigate(prev, { replace: true });
}
