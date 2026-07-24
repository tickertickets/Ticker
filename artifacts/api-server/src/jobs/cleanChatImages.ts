import { createClient } from "@supabase/supabase-js";
import { db } from "@workspace/db";
import { chatMessagesTable } from "@workspace/db/schema";
import { and, lt, isNotNull } from "drizzle-orm";

const BUCKET_NAME = "ticker-uploads";
const MAX_AGE_MS  = 2 * 24 * 60 * 60 * 1000; // 2 days

function getSupabase() {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function cleanOldChatImages(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  const cutoff = new Date(Date.now() - MAX_AGE_MS);

  // Fetch messages with images older than the cutoff
  const oldMessages = await db
    .select({ id: chatMessagesTable.id, imageUrl: chatMessagesTable.imageUrl })
    .from(chatMessagesTable)
    .where(
      and(
        isNotNull(chatMessagesTable.imageUrl),
        lt(chatMessagesTable.createdAt, cutoff)
      )
    );

  if (oldMessages.length === 0) return;

  // Build list of storage paths to delete
  // imageUrl format: /objects/uploads/{uuid}  →  storage path: uploads/{uuid}
  const paths: string[] = oldMessages
    .map((m) => m.imageUrl?.replace(/^\/objects\//, ""))
    .filter(Boolean) as string[];

  if (paths.length > 0) {
    const { error } = await supabase.storage.from(BUCKET_NAME).remove(paths);
    if (error) {
      console.error("[cleanChatImages] Storage delete error:", error.message);
    } else {
      console.log(`[cleanChatImages] Deleted ${paths.length} old chat image(s) from storage`);
    }
  }

  // Nullify imageUrl in DB so the frontend shows a placeholder instead of a broken link
  await db
    .update(chatMessagesTable)
    .set({ imageUrl: null })
    .where(
      and(
        isNotNull(chatMessagesTable.imageUrl),
        lt(chatMessagesTable.createdAt, cutoff)
      )
    );

  console.log(`[cleanChatImages] Cleared imageUrl for ${oldMessages.length} message(s)`);
}

export function scheduleCleanup(intervalMs = 6 * 60 * 60 * 1000): void {
  // Run once on startup to clear any backlog
  cleanOldChatImages().catch((e) =>
    console.error("[cleanChatImages] Startup run failed:", e)
  );
  // Then repeat every 6 hours while the server is alive
  setInterval(() => {
    cleanOldChatImages().catch((e) =>
      console.error("[cleanChatImages] Scheduled run failed:", e)
    );
  }, intervalMs).unref(); // unref() so it doesn't block process exit
}
