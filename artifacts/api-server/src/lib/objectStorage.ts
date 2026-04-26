import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

const BUCKET_NAME = "ticker-uploads";

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for file storage");
  }
  return createClient(url, key);
}

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

let bucketEnsured = false;
async function ensureBucket(supabase: ReturnType<typeof createClient>) {
  if (bucketEnsured) return;
  const { data: buckets } = await supabase.storage.listBuckets();
  const exists = buckets?.some((b) => b.name === BUCKET_NAME);
  if (!exists) {
    await supabase.storage.createBucket(BUCKET_NAME, { public: true });
  }
  bucketEnsured = true;
}

export class ObjectStorageService {
  async uploadBuffer(buffer: Buffer, contentType: string): Promise<string> {
    const supabase = getSupabaseAdmin();
    await ensureBucket(supabase);

    const objectId = randomUUID();
    const path = `uploads/${objectId}`;

    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(path, buffer, { contentType, upsert: false });

    if (error) throw new Error(`Upload failed: ${error.message}`);

    return `/objects/${path}`;
  }

  async downloadObject(objectPath: string): Promise<Response> {
    const supabase = getSupabaseAdmin();
    const storagePath = objectPath.replace(/^\/objects\//, "");

    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .download(storagePath);

    if (error || !data) throw new ObjectNotFoundError();

    const arrayBuffer = await data.arrayBuffer();
    return new Response(arrayBuffer, {
      headers: {
        "Content-Type": data.type || "application/octet-stream",
        "Cache-Control": "public, max-age=3600",
      },
    });
  }

  async deleteObject(objectPath: string): Promise<void> {
    const supabase = getSupabaseAdmin();
    const storagePath = objectPath.replace(/^\/objects\//, "");
    await supabase.storage.from(BUCKET_NAME).remove([storagePath]);
  }

  getPublicUrl(objectPath: string): string {
    const url = process.env.SUPABASE_URL || "";
    const storagePath = objectPath.replace(/^\/objects\//, "");
    return `${url}/storage/v1/object/public/${BUCKET_NAME}/${storagePath}`;
  }
}
