import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role client for server-only contexts that have no user session
// (cron jobs, admin endpoints). Bypasses RLS — never expose to the browser
// or use in code paths that handle untrusted input.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured.",
    );
  }
  return createSupabaseClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
