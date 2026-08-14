import { createClient, SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// null = projeto Supabase não configurado → o app usa o modo demo (dev-login).
export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null;
