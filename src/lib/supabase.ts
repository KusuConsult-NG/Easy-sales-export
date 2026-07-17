import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('[Supabase Client] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables.');
}

// Client-side / general access client (enforces Row Level Security)
export const supabase = createClient(
    supabaseUrl || 'https://placeholder.supabase.co', 
    supabaseAnonKey || 'placeholder'
);

// Admin-side service client (bypasses Row Level Security)
export const supabaseAdmin = createClient(
    supabaseUrl || 'https://placeholder.supabase.co', 
    supabaseServiceKey || supabaseAnonKey || 'placeholder', 
    {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
        realtime: {
            // Disabled on the admin client — it's never used server-side
            // and avoids Node.js 20 WebSocket compatibility issues in scripts
            params: { eventsPerSecond: 0 }
        } as any,
        global: {
            // Signal no realtime needed
            headers: { 'x-client-no-realtime': '1' }
        }
    }
);
