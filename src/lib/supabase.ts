import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://viiilmbgqldwlzyarmdz.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'public-anon-key';

const fastFetch: typeof fetch = (url, options = {}) => {
  return fetch(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(1200),
  });
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: fastFetch },
});

export function getServiceSupabase() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseAnonKey;
  return createClient(supabaseUrl, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: { fetch: fastFetch },
  });
}
