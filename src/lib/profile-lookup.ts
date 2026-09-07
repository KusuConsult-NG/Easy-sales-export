/**
 * Finding the profile that belongs to an email, the way the data is stored.
 *
 *   #476 A PROFILE STORED WITH DIFFERENT CASE OR SURROUNDING SPACE IS INVISIBLE
 *   TO LOGIN, AND LOGIN THEN CREATES A BLANK ONE OVER THE TOP.
 *
 *   lib/auth.ts looked for the caller's profile with
 *
 *       db.collection(USERS).where('email', '==', email.toLowerCase())
 *
 *   lowercasing the INPUT and nothing else. Proven against a real PostgreSQL,
 *   with a row stored the way legacy rows are:
 *
 *       stored:  [  Ada@Example.COM ]   roles: wave_participant, academy_participant
 *       where email = 'ada@example.com'                ->  0 rows
 *       where lower(btrim(email)) = 'ada@example.com'  ->  1 row
 *
 *   That person authenticates correctly, the profile query finds nothing, and
 *   auth.ts auto-provisions a blank profile — roles ['general_user'], fullName
 *   from the email prefix, profileComplete false. Their name, roles and approved
 *   registrations vanish from the session, and a SECOND row now exists under the
 *   auth id. Every login afterwards has two rows matching the email, neither
 *   identified with the auth account, and falls to auth.ts's last resort —
 *   `?? userSnap.docs[0]` — which picks arbitrarily.
 *
 *   THE REPOSITORY ALREADY KNEW. #465's authAccountsWithProfiles normalises BOTH
 *   sides and its test asserts '  Ada@Example.COM ' matches. The forensic scan
 *   was taught this; the login was not.
 *
 *   THE FALLBACK IS EXACT, NOT FUZZY. `ilike` without wildcards does not survive
 *   the surrounding spaces, and WITH wildcards `*ada@example.com*` also matches
 *   `xada@example.com.attacker` — a different account. A login must never
 *   resolve identity by substring, so this goes through
 *   find_users_by_normalised_email, which is `lower(btrim(...)) = lower(btrim(...))`.
 *
 *   IT ONLY RUNS WHEN THE EXACT MATCH FAILED, so a correctly stored email costs
 *   nothing extra — the overwhelmingly common case is one round trip, as before.
 */

import { supabaseDb as db } from './supabase-db';
import { COLLECTIONS } from './types/firestore';

/** The shape auth.ts already works with, so the two paths are interchangeable. */
export interface ProfileRow {
    id: string;
    data(): any;
}

export const normaliseEmail = (email: unknown): string =>
    typeof email === 'string' ? email.trim().toLowerCase() : '';

/**
 * Profiles whose email is `email`, matching the way the data is actually stored.
 *
 * Exact first — that is what almost every row needs and it uses the plain index.
 * Only if that finds nothing does it ask the database to compare normalised
 * values, which is the case legacy rows fall into.
 *
 * `viaFallback` is returned rather than logged here so the caller can say so in
 * its own words: a login resolving this way is worth a line in the log, and this
 * module should not decide what that line says.
 */
export async function findProfilesByEmail(
    email: string,
): Promise<{ rows: ProfileRow[]; viaFallback: boolean }> {
    const wanted = normaliseEmail(email);
    if (!wanted) return { rows: [], viaFallback: false };

    const exact = await db.collection(COLLECTIONS.USERS).where('email', '==', wanted).get();
    if (!exact.empty) {
        return {
            rows: exact.docs.map((d: any) => ({ id: d.id, data: () => d.data() })),
            viaFallback: false,
        };
    }

    // The legacy case: stored with different case, or surrounding whitespace.
    const { supabaseAdmin } = await import('./supabase');
    const { data, error } = await supabaseAdmin.rpc('find_users_by_normalised_email', {
        p_email: wanted,
    });

    if (error) {
        //   Not fatal, and not silent. Without migration 030 this returns
        //   nothing and the caller carries on exactly as it did before — which
        //   is the pre-#476 behaviour, not a new failure. The log names the file
        //   that fixes it, per #473: a fallback that degrades quietly to the
        //   thing it replaced looks exactly like a fix that works.
        console.error(
            '[profile-lookup] find_users_by_normalised_email unavailable — a profile stored ' +
            'with different case or surrounding space will not be found, and login will ' +
            'auto-provision a blank one over it (#476). Apply ' +
            'supabase/migrations/030_find_users_by_normalised_email.sql. Reason:',
            error.message,
        );
        return { rows: [], viaFallback: false };
    }

    const rows = (data ?? []) as Array<{ id: string; raw_data: any }>;
    return {
        rows: rows.map((r) => ({ id: r.id, data: () => ({ ...(r.raw_data ?? {}), id: r.id }) })),
        viaFallback: rows.length > 0,
    };
}
