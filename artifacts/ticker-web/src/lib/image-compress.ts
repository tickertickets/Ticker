/**
 * Client-side image compression (Canvas API).
 * Strategy mirrors Instagram/Facebook:
 *   - Avatar:      resize to max 400 px (square crop), JPEG 85%
 *   - Chat image:  resize to max 1200 px longest side,  JPEG 75%
 */

export interface CompressOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  square?: boolean;
}

export async function compressImage(
  file: File,
  opts: CompressOptions = {}
): Promise<File> {
  const {
    maxWidth = 1200,
    maxHeight = 1200,
    quality = 0.75,
    square = false,
  } = opts;

  if (file.type === "image/gif") return file;

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      let sw = img.naturalWidth;
      let sh = img.naturalHeight;
      let sx = 0;
      let sy = 0;

      if (square) {
        const size = Math.min(sw, sh);
        sx = (sw - size) / 2;
        sy = (sh - size) / 2;
        sw = size;
        sh = size;
      }

      let dw = sw;
      let dh = sh;

      const scale = Math.min(1, maxWidth / dw, maxHeight / dh);
      dw = Math.round(dw * scale);
      dh = Math.round(dh * scale);

      const canvas = document.createElement("canvas");
      canvas.width = dw;
      canvas.height = dh;

      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(file); return; }

      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);

      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(file); return; }
          const compressed = new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), {
            type: "image/jpeg",
            lastModified: Date.now(),
          });
          resolve(compressed);
        },
        "image/jpeg",
        quality
      );
    };

    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Image load failed")); };
    img.src = url;
  });
}

export const AVATAR_COMPRESS: CompressOptions = { maxWidth: 400, maxHeight: 400, quality: 0.72, square: true };
export const CHAT_COMPRESS: CompressOptions   = { maxWidth: 1080, maxHeight: 1080, quality: 0.70 };
