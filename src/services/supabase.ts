// ============================================================
// Supabase Client — React Native
// ============================================================

import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Database } from "../types/database.types";
import { captureException } from "./runtimeDiagnostics";

const missingPublicEnv: string[] = [];
const FALLBACK_SUPABASE_URL = "https://placeholder.supabase.co";
const FALLBACK_SUPABASE_ANON = "placeholder-anon-key";

const rawSupabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const rawSupabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

function readPublicEnv(name: "EXPO_PUBLIC_SUPABASE_URL" | "EXPO_PUBLIC_SUPABASE_ANON_KEY"): string {
  const value = name === "EXPO_PUBLIC_SUPABASE_URL"
    ? rawSupabaseUrl
    : rawSupabaseAnonKey;
  if (value) return value;

  missingPublicEnv.push(name);
  return name === "EXPO_PUBLIC_SUPABASE_URL"
    ? FALLBACK_SUPABASE_URL
    : FALLBACK_SUPABASE_ANON;
}

const SUPABASE_URL  = readPublicEnv("EXPO_PUBLIC_SUPABASE_URL");
const SUPABASE_ANON = readPublicEnv("EXPO_PUBLIC_SUPABASE_ANON_KEY");
export const publicSupabaseUrl = SUPABASE_URL;

export const supabaseInitError =
  missingPublicEnv.length > 0
    ? new Error(`Faltan variables publicas de Supabase: ${missingPublicEnv.join(", ")}`)
    : null;

if (supabaseInitError) {
  void captureException("supabase.init", supabaseInitError, {
    markBootFailed: true,
    extra: { missingPublicEnv },
  });
}

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,  // React Native no usa URL auth
  },
  realtime: {
    params: { eventsPerSecond: 10 }
  }
});

export default supabase;
