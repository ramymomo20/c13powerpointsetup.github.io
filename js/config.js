export const APP_CONFIG = Object.freeze({
  supabaseUrl: "https://hbvjlwschtjmctrirveg.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhidmpsd3NjaHRqbWN0cmlydmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNDQ4NzksImV4cCI6MjA4ODkyMDg3OX0.G6MyBZRST5MkiMqgE4sOEhg720R0NDRwWGNZGjMljoU",
  allowedEditorDomain: "afscme13.org"
});

export function isPlaceholderConfig() {
  const url = (APP_CONFIG.supabaseUrl || "").trim();
  const anonKey = (APP_CONFIG.supabaseAnonKey || "").trim();

  return (
    !url ||
    !anonKey ||
    url.includes("YOUR_PROJECT_ID") ||
    anonKey.includes("YOUR_SUPABASE_ANON_KEY")
  );
}
