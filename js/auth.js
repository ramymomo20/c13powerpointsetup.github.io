import { APP_CONFIG } from "./config.js?v=20260313f";
import { supabase } from "./supabaseClient.js?v=20260313f";

export function isAllowedEditorEmail(email) {
  if (!email || typeof email !== "string") {
    return false;
  }
  const normalized = email.trim().toLowerCase();
  return normalized.endsWith(`@${APP_CONFIG.allowedEditorDomain}`);
}

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw error;
  }
  return data.session;
}

export async function signIn(email, password) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  return supabase.auth.signOut();
}

export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange((_event, session) => callback(session));
}
