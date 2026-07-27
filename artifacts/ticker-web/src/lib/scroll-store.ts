/**
 * scroll-store — module-level Map สำหรับเก็บ scrollTop แยกต่อ key
 * ใช้สำหรับ page-level scroll restoration (กลับมาหน้าเดิมหลัง navigate)
 * ไม่ใช้สำหรับ tabs ภายในหน้า (ใช้ CSS display toggle แทน)
 */
export const scrollStore = new Map<string, number>();

/**
 * scrollNoSave — set ของ keys ที่ไม่ต้องการให้ usePageScroll cleanup บันทึก position
 * ใช้เมื่อ user เจตนา navigate ออกจากหน้า (กดปุ่มย้อนกลับ) เพื่อให้เข้าใหม่เริ่มบนสุด
 * usePageScroll จะ delete key ออกจาก scrollStore และ clear ออกจาก set นี้เมื่อ unmount
 */
export const scrollNoSave = new Set<string>();

/**
 * scrollOnceStore — one-shot scroll restoration store
 * ใช้สำหรับ pages ที่ต้องการ restore scroll เฉพาะเมื่อ navigate กลับมาจาก sub-page
 * (เช่น chain-detail → movie-detail → back)
 *
 * วิธีใช้:
 * 1. บันทึก position ก่อน navigate ไป sub-page: scrollOnceStore.set(key, scrollTop)
 * 2. ตอน mount: อ่านค่า + ลบออกทันที (one-shot)
 * 3. ไม่ save ตอน unmount → เข้าใหม่จาก feed เสมอขึ้นบนสุด
 */
export const scrollOnceStore = new Map<string, number>();
