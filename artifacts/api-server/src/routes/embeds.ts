import express from "express";

const router = express.Router();

const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

// TikTok official oEmbed — legitimate free embed, no registration needed
router.get("/tiktok", async (req, res) => {
  const { url } = req.query as { url?: string };

  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "bad_request", message: "url parameter required" });
    return;
  }

  try {
    let canonicalUrl = url;

    // Step 1: resolve short links using manual redirect (stops at first Location header)
    // Must NOT use redirect:"follow" — TikTok's second redirect is a bot-detection trap
    if (/(?:vm|vt)\.tiktok\.com/.test(url)) {
      try {
        const res301 = await fetch(url, {
          method: "GET",
          redirect: "manual",          // <-- key: grab the Location header, don't follow further
          headers: {
            "User-Agent": MOBILE_UA,
            "Accept": "text/html,application/xhtml+xml",
          },
        });
        const location = res301.headers.get("location");
        if (location && location.includes("tiktok.com")) {
          canonicalUrl = location;
        }
      } catch {
        // keep original url
      }
    }

    // Step 2: extract numeric video ID from canonical URL
    const videoIdMatch = canonicalUrl.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/);
    const videoId = videoIdMatch ? videoIdMatch[1] : null;

    if (!videoId) {
      res.json({ videoId: null, canonical: canonicalUrl, thumbnail: null, author: null });
      return;
    }

    // Step 3: fetch oEmbed for thumbnail + author name
    let thumbnail: string | null = null;
    let author: string | null = null;
    try {
      const cleanUrl = canonicalUrl.split("?")[0]!;
      const oembedRes = await fetch(
        `https://www.tiktok.com/oembed?url=${encodeURIComponent(cleanUrl)}`,
        { headers: { "User-Agent": MOBILE_UA } }
      );
      if (oembedRes.ok) {
        const oembed = await oembedRes.json() as {
          thumbnail_url?: string;
          author_name?: string;
        };
        thumbnail = oembed.thumbnail_url || null;
        author = oembed.author_name || null;
      }
    } catch {
      // Silently ignore — embed still works without thumbnail/author
    }

    res.json({ videoId, canonical: canonicalUrl, thumbnail, author });
  } catch (err) {
    req.log.warn({ err }, "TikTok embed resolve warning");
    res.json({ videoId: null, thumbnail: null, author: null });
  }
});

export default router;
