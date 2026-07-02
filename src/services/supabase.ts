import { createClient } from '@supabase/supabase-js';

// These come from Vite env (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)
// If they're not set, the app falls back to localStorage (local-only mode)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export const isSupabaseEnabled = !!supabase;

// Helper: get the current user's JWT token for API calls
export async function getAuthToken() {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session) return null;
  return data.session.access_token;
}
