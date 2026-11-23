import { createClient } from '@supabase/supabase-js';

const envSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
export const isSupabaseEnabled = 
  process.env.NEXT_PUBLIC_ENABLE_SUPABASE === 'true' && 
  Boolean(envSupabaseUrl) &&
  !envSupabaseUrl.includes('viiilmbgqldwlzyarmdz');

const supabaseUrl = envSupabaseUrl || 'https://localhost.placeholder';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';

const fastFetch: typeof fetch = (url, options = {}) => {
  return fetch(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(1200),
  });
};

// Safe dummy client if disabled to prevent runtime undefined errors
export const supabase = isSupabaseEnabled
  ? createClient(supabaseUrl, supabaseAnonKey, { global: { fetch: fastFetch } })
  : null as any;

export function getServiceSupabase() {
  if (!isSupabaseEnabled) return null;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey;
  return createClient(supabaseUrl, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: { fetch: fastFetch },
  });
}
