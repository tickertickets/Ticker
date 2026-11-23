import { createClient } from "@supabase/supabase-js";
import { config } from "../config";

let supabase: ReturnType<typeof createClient> | null = null;

export function initSupabase() {
  if (!config.supabase.url || !config.supabase.serviceRoleKey) {
    return null;
  }

  if (!supabase) {
    supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey);
  }

  return supabase;
}

export function getSupabase() {
  return supabase || initSupabase();
}
