import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import https from "https";
import http from "http";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

// ── POST /uploads/proxy — receive file and store in Supabase Storage ─────────
router.post("/uploads/proxy", async (req: Request, res: Response) => {
  const currentUserId = req.session?.userId;
  if (!currentUserId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  try {
    const contentType = (req.headers["content-type"] || "application/octet-stream")
      .split(";")[0]!
      .trim();

    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);

    const objectPath = await objectStorageService.uploadBuffer(buffer, contentType);
    res.json({ objectPath });
  } catch (error) {
    console.error("Proxy upload error:", error);
    res.status(500).json({ error: "Upload failed" });
  }
});

// ── GET /objects/*path — serve file from Supabase Storage ────────────────────
router.get("/objects/*path", async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;

    const response = await objectStorageService.downloadObject(objectPath);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    console.error("Error serving object:", error);
    res.status(500).json({ error: "Failed to serve object" });
  }
});

// ── SSRF protection helpers ───────────────────────────────────────────────────

/**
 * Allowed hostnames for the image proxy. Only well-known image CDNs used by
 * this app are permitted. All other hosts are rejected to prevent SSRF.
 */
const ALLOWED_IMAGE_HOSTS = new Set([
  // TMDB
  "image.tmdb.org",
  "www.themoviedb.org",
  // OMDB
  "img.omdbapi.com",
  "m.media-amazon.com",
  // Supabase storage (project-specific subdomain — relaxed via suffix check below)
  // Google profile photos
  "lh3.googleusercontent.com",
  "lh4.googleusercontent.com",
  "lh5.googleusercontent.com",
  "lh6.googleusercontent.com",
  "googleusercontent.com",
  // UI Avatars fallback
  "ui-avatars.com",
  // DiceBear avatars
  "api.dicebear.com",
]);

/** Returns true if the hostname is a Supabase storage CDN. */
function isSupabaseStorageHost(hostname: string): boolean {
  return hostname.endsWith(".supabase.co") || hostname.endsWith(".supabase.in");
}

/**
 * Rejects private, loopback, link-local, and reserved IPv4/IPv6 ranges to
 * prevent SSRF attacks that probe internal services.
 */
function isPrivateHost(hostname: string): boolean {
  // Explicit loopback / special names
  if (
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "0.0.0.0"
  ) {
    return true;
  }

  // IPv4 private/reserved CIDR ranges
  const ipv4Match = hostname.match(
    /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/,
  );
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);
    if (
      a === 10 || // 10.0.0.0/8
      (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
      (a === 192 && b === 168) || // 192.168.0.0/16
      a === 127 || // 127.0.0.0/8 loopback
      a === 169 || // 169.254.0.0/16 link-local
      a === 0 || // 0.0.0.0/8 reserved
      a >= 240 // 240.0.0.0/4 reserved
    ) {
      return true;
    }
  }

  // IPv6 private/special ranges (simplified check)
  if (
    hostname.startsWith("::") ||
    hostname.startsWith("fc") ||
    hostname.startsWith("fd") ||
    hostname.startsWith("fe80")
  ) {
    return true;
  }

  return false;
}

// ── GET /proxy-image?url=... — proxy external images to avoid CORS ───────────
router.get("/proxy-image", (req: Request, res: Response) => {
  const { url } = req.query as { url?: string };
  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "url required" });
    return;
  }

  let decodedUrl: string;
  let parsed: URL;
  try {
    decodedUrl = decodeURIComponent(url);
    parsed = new URL(decodedUrl);
  } catch {
    res.status(400).json({ error: "invalid url" });
    return;
  }

  // Only allow https (no http, file://, etc.)
  if (parsed.protocol !== "https:") {
    res.status(400).json({ error: "only https urls are allowed" });
    return;
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block private/reserved IP ranges (SSRF protection)
  if (isPrivateHost(hostname)) {
    res.status(400).json({ error: "url not allowed" });
    return;
  }

  // Allowlist check — only known image CDNs are permitted
  if (!ALLOWED_IMAGE_HOSTS.has(hostname) && !isSupabaseStorageHost(hostname)) {
    res.status(400).json({ error: "url not allowed" });
    return;
  }

  const upstream = https.get(decodedUrl, (upstreamRes) => {
    const ct = upstreamRes.headers["content-type"] ?? "image/jpeg";
    // Only proxy image content types
    if (!ct.startsWith("image/")) {
      upstreamRes.destroy();
      if (!res.headersSent) res.status(400).json({ error: "not an image" });
      return;
    }
    res.setHeader("Content-Type", ct);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=86400");
    upstreamRes.pipe(res);
  });
  upstream.on("error", () => {
    if (!res.headersSent) res.status(502).json({ error: "upstream fetch failed" });
  });
});

export default router;
