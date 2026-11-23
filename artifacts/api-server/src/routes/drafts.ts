import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { draftsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { asyncHandler } from "../middlewares/error-handler";
import { UnauthorizedError, ValidationError } from "../lib/errors";

const router: IRouter = Router();

// GET /api/drafts?type=ticket|chain
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const userId = req.session?.userId;
    if (!userId) throw new UnauthorizedError();
    const type = req.query.type as string | undefined;
    if (!type) throw new ValidationError("type is required");
    const rows = await db
      .select()
      .from(draftsTable)
      .where(and(eq(draftsTable.userId, userId), eq(draftsTable.type, type)));
    res.json({ drafts: rows.map((r: typeof rows[number]) => r.data) });
  }),
);

// PUT /api/drafts  — upsert a draft
router.put(
  "/",
  asyncHandler(async (req, res) => {
    const userId = req.session?.userId;
    if (!userId) throw new UnauthorizedError();
    const { type, key, data } = req.body;
    if (!type || !key || !data) throw new ValidationError("type, key and data are required");
    await db
      .insert(draftsTable)
      .values({ userId, type, key, data, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [draftsTable.userId, draftsTable.type, draftsTable.key],
        set: { data, updatedAt: new Date() },
      });
    res.json({ ok: true });
  }),
);

// DELETE /api/drafts?type=ticket|chain&key=xxx
router.delete(
  "/",
  asyncHandler(async (req, res) => {
    const userId = req.session?.userId;
    if (!userId) throw new UnauthorizedError();
    const type = req.query.type as string | undefined;
    const key = req.query.key as string | undefined;
    if (!type || !key) throw new ValidationError("type and key are required");
    await db
      .delete(draftsTable)
      .where(
        and(
          eq(draftsTable.userId, userId),
          eq(draftsTable.type, type),
          eq(draftsTable.key, key),
        ),
      );
    res.json({ ok: true });
  }),
);

export default router;
