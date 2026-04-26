import { Router, type IRouter, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { getSupabase } from "../lib/supabase";

const router: IRouter = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "Too many attempts, please try again later" },
  skipSuccessfulRequests: true,
});

const signupSchema = z.object({
  email: z.string().email().max(320).toLowerCase(),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  email: z.string().email().max(320).toLowerCase(),
  password: z.string().min(1).max(128),
});

router.post("/supabase/signup", authLimiter, async (req: Request, res: Response) => {
  const supabase = getSupabase();
  if (!supabase) {
    res.status(503).json({ error: "not_configured", message: "Supabase auth not configured" });
    return;
  }

  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const { email, password } = parsed.data;

  try {
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (authError) {
      res.status(400).json({ error: "signup_failed", message: authError.message });
      return;
    }

    if (!authData.user) {
      res.status(500).json({ error: "internal_error", message: "Failed to create user" });
      return;
    }

    const userId = `sup_${authData.user.id}`;
    const existing = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(usersTable).values({
        id: userId,
        email,
        isOnboarded: false,
        isPrivate: false,
      });
    }

    req.session.userId = userId;
    res.status(201).json({ success: true });
  } catch (err) {
    req.log?.error({ err }, "Supabase signup failed");
    res.status(500).json({ error: "internal_error", message: "Internal server error" });
  }
});

router.post("/supabase/login", authLimiter, async (req: Request, res: Response) => {
  const supabase = getSupabase();
  if (!supabase) {
    res.status(503).json({ error: "not_configured", message: "Supabase auth not configured" });
    return;
  }

  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const { email, password } = parsed.data;

  try {
    const { data: authData, error: authError } = await supabase.auth.admin.getUserByEmail(email);

    if (authError || !authData.user) {
      res.status(401).json({ error: "invalid_credentials", message: "Email or password is incorrect" });
      return;
    }

    const { data: sessionData, error: sessionError } = await supabase.auth.admin.createSession(authData.user.id);

    if (sessionError || !sessionData.session) {
      res.status(500).json({ error: "internal_error", message: "Failed to create session" });
      return;
    }

    const userId = `sup_${authData.user.id}`;
    req.session.userId = userId;
    res.json({
      success: true,
      session: {
        access_token: sessionData.session.access_token,
        refresh_token: sessionData.session.refresh_token,
      },
    });
  } catch (err) {
    req.log?.error({ err }, "Supabase login failed");
    res.status(500).json({ error: "internal_error", message: "Internal server error" });
  }
});

export default router;
