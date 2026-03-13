import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { APP_CONFIG, isPlaceholderConfig } from "./config.js?v=20260313f";

export const supabase = isPlaceholderConfig()
  ? null
  : createClient(APP_CONFIG.supabaseUrl, APP_CONFIG.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });

export function isSupabaseConfigured() {
  return Boolean(supabase);
}
