import { Router, type IRouter } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@workspace/db";
import { usersTable, passwordResetsTable } from "@workspace/db/schema";
import { eq, and, gt, isNull } from "drizzle-orm";
import { getSupabase } from "../lib/supabase";
import { isDisposableEmail } from "../lib/disposable-emails";
import { sendPasswordResetEmail } from "../lib/email";

const router: IRouter = Router();

// ── Rate limiters ─────────────────────────────────────────────────────────────

// Login: 10 ครั้ง / 15 นาที / IP — นับเฉพาะที่ล้มเหลว (ป้องกัน brute-force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "เกิดข้อผิดพลาด กรุณาลองใหม่ในภายหลัง" },
  skipSuccessfulRequests: true,
});

// Signup per IP: 20 / ชั่วโมง — friendly กับ shared Wi-Fi (มหาลัย/บ้าน)
const signupIpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "เกิดข้อผิดพลาด กรุณาลองใหม่ในภายหลัง" },
});

// Signup per email: 3 ครั้ง / 10 นาที ต่ออีเมล — กันการยิง endpoint ซ้ำด้วยอีเมลเดิม
const signupEmailLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 3,
  keyGenerator: (req) => `email:signup:${(req.body?.email ?? "").toLowerCase().trim()}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "เกิดข้อผิดพลาด กรุณาลองใหม่ในภายหลัง" },
});

// Signup per device: 5 ครั้ง / ชั่วโมง / เครื่อง — แยกรายเครื่องในกรณี shared Wi-Fi
// ถ้าไม่มี X-Device-ID header (เช่น bot, API โดยตรง) ให้ fall back ไปใช้ IP
const signupDeviceLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => {
    const deviceId = req.headers["x-device-id"];
    if (typeof deviceId === "string" && deviceId.length > 0 && deviceId.length <= 64) {
      return `device:signup:${deviceId}`;
    }
    return `device:signup:ip:${ipKeyGenerator(req)}`;
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "เกิดข้อผิดพลาด กรุณาลองใหม่ในภายหลัง" },
});

const forgotLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "เกิดข้อผิดพลาด กรุณาลองใหม่ในภายหลัง" },
});

// ── Allowed email domains ─────────────────────────────────────────────────────

const ALLOWED_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "outlook.com",
  "outlook.co.th",
  "hotmail.com",
  "yahoo.com",
  "icloud.com",
  "proton.me",
  "protonmail.com",
  "zoho.com",
]);

// ── Validation schemas ────────────────────────────────────────────────────────

const signupSchema = z.object({
  email: z
    .string()
    .email("invalid_email")
    .max(320)
    .toLowerCase()
    .refine(
      (email) => {
        const domain = email.split("@")[1] ?? "";
        return ALLOWED_EMAIL_DOMAINS.has(domain);
      },
      { message: "email_domain_not_allowed" },
    ),
  password: z
    .string()
    .min(8, "password_too_short")
    .max(128)
    .regex(/^[\x20-\x7E]+$/, "password_invalid_chars")
    .regex(/[A-Za-z]/, "password_no_letter")
    .regex(/[0-9!@#$%^&*()\-_=+[\]{};':",.<>/?\\|`~]/, "password_no_digit_or_symbol"),
  _hp: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email().max(320).toLowerCase(),
  password: z.string().min(1).max(128),
});

const APP_URL = process.env["APP_URL"] ?? "https://ticker-tickets.vercel.app";

// ── /me ───────────────────────────────────────────────────────────────────────

router.get("/me", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ error: "unauthorized", message: "Not logged in" });
    return;
  }
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!user) {
      req.session.destroy(() => {});
      res.status(401).json({ error: "unauthorized", message: "User not found" });
      return;
    }
    res.json({
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      isOnboarded: user.isOnboarded,
      isPrivate: user.isPrivate,
      createdAt: user.createdAt,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get current user");
    res.status(500).json({ error: "internal_error", message: "Internal server error" });
  }
});

// ── Signup ────────────────────────────────────────────────────────────────────

router.post("/signup", signupIpLimiter, signupDeviceLimiter, signupEmailLimiter, async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    const code = parsed.error.issues[0]?.message ?? "validation_error";
    res.status(400).json({ error: code, message: code });
    return;
  }

  const { email, password, _hp } = parsed.data;

  // Honeypot check — บอทมักกรอก field ซ่อน, คนจริงไม่เห็น
  if (_hp && _hp.length > 0) {
    req.log.warn({ ip: req.ip }, "Honeypot triggered on signup");
    res.status(201).json({ success: true });
    return;
  }

  // Disposable email check — กัน mailinator/tempmail/yopmail ฯลฯ
  if (isDisposableEmail(email)) {
    res.status(400).json({ error: "disposable_email", message: "ไม่รับอีเมลชั่วคราว กรุณาใช้อีเมลจริง" });
    return;
  }

  try {
    const existing = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);

    if (existing.length > 0) {
      res.status(409).json({ error: "email_taken", message: "อีเมลนี้ถูกใช้งานแล้ว" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const userId = `usr_${crypto.randomUUID().replace(/-/g, "")}`;

    await db.insert(usersTable).values({
      id: userId,
      email,
      passwordHash,
      emailVerified: true,
      isOnboarded: false,
      isPrivate: false,
    });

    req.session.userId = userId;
    res.status(201).json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Signup failed");
    res.status(500).json({ error: "internal_error", message: "Internal server error" });
  }
});

// ── Login ─────────────────────────────────────────────────────────────────────

router.post("/login", authLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const { email, password } = parsed.data;

  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);

    // Constant-time check — always run bcrypt even if user not found to prevent timing attacks
    const dummyHash = "$2b$12$invalidhashfortimingprotection000000000000000000000000";
    const hashToCheck = user?.passwordHash ?? dummyHash;
    const valid = await bcrypt.compare(password, hashToCheck);

    if (!user || !valid || !user.passwordHash) {
      res.status(401).json({ error: "invalid_credentials", message: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });
      return;
    }

    // Auto-verify legacy users who signed up before email verification was removed
    if (!user.emailVerified) {
      await db.update(usersTable).set({ emailVerified: true }).where(eq(usersTable.id, user.id));
    }

    req.session.userId = user.id;
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Login failed");
    res.status(500).json({ error: "internal_error", message: "Internal server error" });
  }
});

// ── Forgot password ───────────────────────────────────────────────────────────

router.post("/forgot-password", forgotLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== "string") {
    res.status(400).json({ error: "bad_request", message: "Email required" });
    return;
  }

  try {
    const [user] = await db
      .select({ id: usersTable.id, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.email, email.toLowerCase().trim()))
      .limit(1);

    // Always return success to prevent user enumeration
    if (!user) {
      res.json({ success: true });
      return;
    }

    const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await db.insert(passwordResetsTable).values({ token, userId: user.id, expiresAt });

    // Deliver the reset link via email — never return the token in the API response
    const origin = process.env["APP_ORIGIN"] || `${req.protocol}://${req.get("host")}`;
    const resetUrl = `${origin}/reset-password?token=${token}`;
    try {
      await sendPasswordResetEmail({ to: user.email, resetUrl });
    } catch (emailErr) {
      req.log.error({ err: emailErr }, "Failed to send password reset email");
      // Don't expose token even on email failure — user must retry
    }

    // Always return the same response to prevent user enumeration
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Forgot password failed");
    res.status(500).json({ error: "internal_error", message: "Internal server error" });
  }
});

// ── Reset password ────────────────────────────────────────────────────────────

router.post("/reset-password", authLimiter, async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password || typeof token !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "bad_request", message: "Token and password required" });
    return;
  }

  const passwordSchema = z.string()
    .min(8, "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร")
    .max(128)
    .regex(/^[\x20-\x7E]+$/, "รหัสผ่านต้องใช้ตัวอักษรภาษาอังกฤษและสัญลักษณ์เท่านั้น")
    .regex(/[A-Za-z]/, "รหัสผ่านต้องมีตัวอักษรอย่างน้อย 1 ตัว")
    .regex(/[0-9!@#$%^&*()\-_=+[\]{};':",.<>/?\\|`~]/, "รหัสผ่านต้องมีตัวเลขหรือสัญลักษณ์อย่างน้อย 1 ตัว");

  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) {
    res.status(400).json({ error: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid password" });
    return;
  }

  try {
    const now = new Date();
    const [record] = await db
      .select()
      .from(passwordResetsTable)
      .where(and(
        eq(passwordResetsTable.token, token),
        gt(passwordResetsTable.expiresAt, now),
        isNull(passwordResetsTable.usedAt),
      ))
      .limit(1);

    if (!record) {
      res.status(400).json({ error: "invalid_token", message: "ลิงก์รีเซ็ตรหัสผ่านหมดอายุหรือไม่ถูกต้อง" });
      return;
    }

    // Update the password first — only mark token as used after success
    // so the user can retry if there's a transient error
    if (record.userId.startsWith("sup_")) {
      // Supabase user — update password via Supabase Admin API
      const supabase = getSupabase();
      if (!supabase) {
        res.status(503).json({ error: "not_configured", message: "Supabase not configured" });
        return;
      }
      const supabaseUserId = record.userId.replace(/^sup_/, "");
      const { error } = await supabase.auth.admin.updateUserById(supabaseUserId, { password });
      if (error) {
        req.log.error({ err: error }, "Supabase password update failed");
        res.status(500).json({ error: "internal_error", message: "Failed to reset password" });
        return;
      }
    } else {
      // Custom auth user — update passwordHash in our DB
      const passwordHash = await bcrypt.hash(password, 12);
      await db.update(usersTable).set({ passwordHash }).where(eq(usersTable.id, record.userId));
    }

    // Mark token as used only after password is updated successfully
    await db.update(passwordResetsTable).set({ usedAt: now }).where(eq(passwordResetsTable.token, token));

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Reset password failed");
    res.status(500).json({ error: "internal_error", message: "Internal server error" });
  }
});

// ── Logout ────────────────────────────────────────────────────────────────────

router.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      res.status(500).json({ error: "internal_error", message: "Logout failed" });
      return;
    }
    res.clearCookie("ticker_session");
    res.json({ success: true, message: "Logged out" });
  });
});

// ── Google OAuth ──────────────────────────────────────────────────────────────

router.get("/google", (req, res) => {
  const clientId = process.env["GOOGLE_CLIENT_ID"];
  if (!clientId) {
    res.status(503).json({ error: "not_configured", message: "Google login not configured" });
    return;
  }
  const redirectUri = process.env["GOOGLE_REDIRECT_URI"] || `${req.protocol}://${req.get("host")}/api/auth/google/callback`;
  const scope = encodeURIComponent("openid email profile");
  const state = crypto.randomUUID();

  req.session.oauthState = state;
  // `prompt=select_account` forces Google to ALWAYS show the account chooser,
  // even when the browser is already signed into a single Google account.
  // Without it, every browser signed into the same Google would silently
  // reuse that mapping → on a shared machine, opening the site in a new
  // browser would auto-pick the same Ticker user, defeating multi-account.
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&state=${state}&prompt=select_account&access_type=online`;
  res.redirect(url);
});

router.get("/google/callback", async (req, res) => {
  const { code, state } = req.query;
  const sessionState = req.session?.oauthState;

  if (!code || !state || state !== sessionState) {
    res.status(400).json({ error: "invalid_oauth", message: "Invalid OAuth state" });
    return;
  }

  try {
    const clientId = process.env["GOOGLE_CLIENT_ID"]!;
    const clientSecret = process.env["GOOGLE_CLIENT_SECRET"]!;
    const redirectUri = process.env["GOOGLE_REDIRECT_URI"] || `${req.protocol}://${req.get("host")}/api/auth/google/callback`;

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: code as string,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenRes.json() as { access_token: string; id_token: string };
    const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const googleUser = await userInfoRes.json() as { sub: string; email: string; name: string; picture: string };

    const userId = `google_${googleUser.sub}`;
    const existingUsers = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);

    if (existingUsers.length === 0) {
      await db.insert(usersTable).values({
        id: userId,
        email: googleUser.email,
        emailVerified: true,
        displayName: googleUser.name,
        avatarUrl: googleUser.picture,
        isOnboarded: false,
        isPrivate: false,
      });
    }

    req.session.userId = userId;
    res.redirect("/");
  } catch (err) {
    req.log.error({ err }, "Google OAuth callback failed");
    res.status(500).json({ error: "oauth_failed", message: "OAuth failed" });
  }
});

// ── Dev-only bypass ───────────────────────────────────────────────────────────

router.post("/dev-login", async (req, res) => {
  if (process.env["NODE_ENV"] !== "development") {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const devUserId = "dev_local";
  const devEmail = "dev@localhost";

  try {
    const existing = await db.select().from(usersTable).where(eq(usersTable.id, devUserId)).limit(1);
    if (existing.length === 0) {
      await db.insert(usersTable).values({
        id: devUserId,
        email: devEmail,
        emailVerified: true,
        displayName: "Dev User",
        isOnboarded: false,
        isPrivate: false,
      });
    }

    req.session.userId = devUserId;
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Dev login failed");
    res.status(500).json({ error: "internal_error", message: "Internal server error" });
  }
});

// ── GET /api/auth/whoami — returns current session userId (for admin setup) ───
router.get("/whoami", (req, res) => {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ error: "not_logged_in" });
    return;
  }
  res.json({ userId });
});

// ── GET /api/auth/admin-check — debug: check session + ADMIN_USER_ID match ──
router.get("/admin-check", (req, res) => {
  const userId = req.session?.userId;
  const adminId = process.env["ADMIN_USER_ID"];
  res.json({
    sessionFound: !!userId,
    sessionUserId: userId ?? null,
    adminEnvConfigured: !!adminId,
    isAdmin: !!userId && !!adminId && adminId === userId,
  });
});

export default router;
