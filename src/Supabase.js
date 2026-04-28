import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

function missingSupabaseError() {
  return new Error(
    "Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY only if you are running the legacy Supabase app mode.",
  );
}

const unavailableSupabase = {
  from() {
    throw missingSupabaseError();
  },
  storage: {
    from() {
      return {
        async upload() {
          return { data: null, error: missingSupabaseError() };
        },
        getPublicUrl() {
          return { data: { publicUrl: "" } };
        },
      };
    },
  },
};

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : unavailableSupabase;
