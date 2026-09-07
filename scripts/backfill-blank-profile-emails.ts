/**
 * Give the 49 email-less profiles their address back, from the auth record.
 *
 * Run (report only, writes nothing):   npm run backfill:blankemails
 * Run (writes the addresses):          npm run backfill:blankemails -- --apply
 *
 * WHY IT IS NEEDED
 * ----------------
 * #489 found where they came from: two admin approvals created a user profile
 * with `email: ""` when the record in front of them carried no address —
 * `_coop_admin_members.ts` (48, all cooperative_member) and `_fn_admin.ts`
 * (1, a farmer). Both now look at the auth record before giving up, and refuse
 * rather than mint an account nobody can reach. That stops the next one. It
 * does nothing for the forty-nine already written.
 *
 * WHAT A BLANK EMAIL COSTS THE PERSON IT WAS WRITTEN FOR
 * -----------------------------------------------------
 * #479 established it: such a profile is findable only by its document id. The
 * member cannot sign in, password reset cannot find them, the admin search
 * cannot find them, and authAccountsWithProfiles — which joins an auth account
 * to its profile by document id or by email — reports them as a GHOST. That is
 * the owner's other standing finding. The two are one defect.
 *
 * WHERE THE ADDRESS COMES FROM
 * ----------------------------
 * The person's own auth record. They signed up with an email; it is on the
 * account. This script reads it and writes it onto the profile, and does
 * nothing else.
 *
 * WHAT IT WILL NOT DO
 * -------------------
 *   - OVERWRITE AN EXISTING ADDRESS. It only ever fills a blank. A profile
 *     whose email is already set is not touched, not even to normalise it.
 *   - INVENT ONE. A profile whose owner has no auth record, or whose auth
 *     record has no email either, is REPORTED and left exactly as it is. Those
 *     are people the platform genuinely cannot identify, and a made-up address
 *     would make them findable under a name that is not theirs — which is worse
 *     than being unfindable.
 *   - CLAIM A ROW ON AN EMAIL MATCH. It goes from the profile to ITS OWN auth
 *     account, never the other way. Matching profiles to accounts by address is
 *     how one person's records get bound to another's, which is the whole
 *     subject of lib/cooperative-membership-claim.ts.
 *   - DELETE OR MERGE ANYTHING. It writes one field.
 *
 * WHY IT IS SAFE TO RE-RUN
 * ------------------------
 * The second run finds no blanks among the rows the first one filled, and
 * refuses the same unidentifiable ones. Running it twice writes nothing the
 * first run did not.
 *
 * HOW A PROFILE'S AUTH ACCOUNT IS FOUND
 * -------------------------------------
 * Two ways, in order:
 *   1. `supabaseAuthId` on the profile — the pointer user-migration.ts writes,
 *      an explicit statement of ownership.
 *   2. The document id, when it is itself an auth uid.
 * Both are the profile asserting which account is its own. Neither guesses.
 */

import { createClient } from '@supabase/supabase-js';
import { existsSync } from 'fs';
import { config as loadEnv } from 'dotenv';
import { isApply, targetHost, modeBanner, runScript } from './_maintenance-guard';

if (existsSync('.env.development.local')) loadEnv({ path: '.env.development.local' });
loadEnv({ path: '.env.local' });

const APPLY = isApply();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function fail(msg: string): never {
    console.error(`\n❌ ${msg}\n`);
    process.exit(1);
}

if (!url || !serviceKey) {
    fail('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.');
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

interface BlankProfile {
    id: string;
    raw: Record<string, any>;
}

/** The same "is there an identity here" test the application uses (#489). */
function usable(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/** Every profile whose email is blank, missing or whitespace. */
async function readBlankProfiles(): Promise<BlankProfile[]> {
    const PAGE = 1000;
    const out: BlankProfile[] = [];

    for (let from = 0; ; from += PAGE) {
        //   `email` is a native column, so the blank cases are askable directly
        //   rather than by reading the whole table. `is.null` and `eq.` are two
        //   different storage answers to the same question and both count.
        const { data, error } = await admin
            .from('users')
            .select('id, email, raw_data')
            .or('email.is.null,email.eq.')
            .range(from, from + PAGE - 1);

        if (error) fail(`Reading users: ${error.message}`);
        if (!data || data.length === 0) break;

        for (const row of data as any[]) {
            const raw = (row.raw_data ?? {}) as Record<string, any>;
            //   Re-checked in JS: a row holding '   ' passes neither filter
            //   above but is not an identity either, and the raw_data copy can
            //   disagree with the column.
            if (!usable(row.email) && !usable(raw.email)) {
                out.push({ id: String(row.id), raw });
            }
        }
        if (data.length < PAGE) break;
    }
    return out;
}

/** The auth account this profile says is its own. */
function claimedAuthId(profile: BlankProfile): string | null {
    return usable(profile.raw?.supabaseAuthId) ?? usable(profile.id);
}

async function main(): Promise<void> {
    console.log(modeBanner('Blank profile email backfill (#489)', APPLY, targetHost()));

    const blanks = await readBlankProfiles();
    console.log(`\nProfiles with no email address: ${blanks.length}\n`);

    if (blanks.length === 0) {
        console.log('Nothing to do.\n');
        return;
    }

    const filled: Array<{ id: string; email: string; via: string }> = [];
    const refused: Array<{ id: string; reason: string }> = [];

    for (const profile of blanks) {
        const authId = claimedAuthId(profile);
        if (!authId) {
            refused.push({ id: profile.id, reason: 'the profile names no auth account' });
            continue;
        }

        const { data, error } = await admin.auth.admin.getUserById(authId);
        if (error || !data?.user) {
            refused.push({
                id: profile.id,
                reason: `no auth record for ${authId}${error ? ` (${error.message})` : ''}`,
            });
            continue;
        }

        const email = usable(data.user.email);
        if (!email) {
            refused.push({ id: profile.id, reason: 'the auth record has no email either' });
            continue;
        }

        const via = profile.raw?.supabaseAuthId ? 'supabaseAuthId' : 'document id';
        filled.push({ id: profile.id, email, via });

        if (APPLY) {
            //   The native column AND the raw_data copy, because both are read:
            //   the adapter routes email filters to the column, and several
            //   readers take `data.email` off the document. Leaving one blank
            //   would fix the login and not the admin screen, or the reverse.
            const { error: writeError } = await admin
                .from('users')
                .update({
                    email,
                    raw_data: { ...profile.raw, email },
                })
                .eq('id', profile.id);

            if (writeError) {
                refused.push({ id: profile.id, reason: `write failed: ${writeError.message}` });
                filled.pop();
            }
        }
    }

    console.log(`${APPLY ? 'FILLED' : 'WOULD FILL'} — ${filled.length}`);
    for (const f of filled.slice(0, 60)) {
        console.log(`  ${f.id}  ->  ${f.email}   (via ${f.via})`);
    }
    if (filled.length > 60) console.log(`  … and ${filled.length - 60} more`);

    console.log(`\nREFUSED, and left exactly as they are — ${refused.length}`);
    for (const r of refused.slice(0, 60)) {
        console.log(`  ${r.id}  —  ${r.reason}`);
    }
    if (refused.length > 60) console.log(`  … and ${refused.length - 60} more`);

    if (!APPLY) {
        console.log('\nReport only. Re-run with --apply to write the addresses.\n');
    } else {
        console.log('\nDone. Nothing was deleted, merged, or overwritten.\n');
    }

    if (refused.length > 0) {
        console.log(
            'The refused profiles belong to people this platform cannot identify. They are\n'
            + 'left alone deliberately: an invented address would make them findable under a\n'
            + 'name that is not theirs, which is worse than unfindable. They need a decision\n'
            + 'about who they are, not a script.\n'
        );
    }
}

runScript('backfill-blank-profile-emails', main);
