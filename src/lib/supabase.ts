import { createClient } from '@supabase/supabase-js';

/** The stand-in used when no usable URL was supplied. Never reaches a network. */
export const PLACEHOLDER_SUPABASE_URL = 'https://placeholder.supabase.co';

/**
 *   #451 `url || fallback` HANDLED MISSING AND NOT MALFORMED, AND THAT KILLED
 *        THE WHOLE BUILD.
 *
 *        `createClient(supabaseUrl || 'https://placeholder.supabase.co', ...)`
 *        runs at MODULE SCOPE, and this module is pulled in by auth.config.ts
 *        through schemas.ts and supabase-db.ts. An EMPTY value took the
 *        fallback and was fine. A non-empty value that is not a URL — a
 *        placeholder pasted literally into the deployment platform, a typo, a
 *        stray quote, a trailing space — went straight to createClient, which
 *        threw:
 *
 *            Error: Failed to collect configuration for
 *                   /api/academy/certificate/generate
 *              [cause]: Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL.
 *                at src/lib/supabase.ts:12
 *
 *        Two things make that bad out of proportion to the typo. It fails the
 *        BUILD rather than a request, so nothing ships at all; and the message
 *        names an academy certificate route four frames from the cause, so the
 *        person reading it starts in the wrong file.
 *
 *        A malformed value now degrades exactly like a missing one — same
 *        fallback, same warning path — and the warning says which variable and
 *        what is wrong with it. Being unable to reach Supabase is a runtime
 *        condition the platform already handles; being unable to BUILD is not.
 */
function usableUrl(raw: string | undefined, name: string): string {
    const value = (raw ?? '').trim();
    if (value === '') return '';

    try {
        const parsed = new URL(value);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return value;
        console.error(`[Supabase Client] ${name} is not http(s): "${parsed.protocol}". Using a placeholder; this instance cannot reach Supabase.`);
    } catch {
        console.error(`[Supabase Client] ${name} is not a valid URL. Using a placeholder; this instance cannot reach Supabase. Check the deployment platform for an unreplaced placeholder or a stray quote.`);
    }
    return '';
}

const supabaseUrl = usableUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('[Supabase Client] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables.');
}

// Client-side / general access client (enforces Row Level Security)
export const supabase = createClient(
    supabaseUrl || PLACEHOLDER_SUPABASE_URL,
    supabaseAnonKey || 'placeholder'
);

if (typeof window === 'undefined' && !supabaseServiceKey && process.env.NODE_ENV !== 'test') {
    console.error('[Supabase Client] CRITICAL WARNING: SUPABASE_SERVICE_ROLE_KEY is missing in server environment. Admin database operations will fail RLS permissions.');
}

// Admin-side service client (bypasses Row Level Security)
export const supabaseAdmin = createClient(
    supabaseUrl || PLACEHOLDER_SUPABASE_URL,
    supabaseServiceKey || 'placeholder-service-key-missing', 
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
