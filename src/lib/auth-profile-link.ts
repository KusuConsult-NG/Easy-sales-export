/**
 * Which auth accounts already have a profile, and where that profile is.
 *
 *   #466 THE FORENSIC LEARNED TO FIND A MIGRATED USER'S PROFILE AND THE REPAIR
 *   DID NOT — AND THE REPAIR IS THE HALF THAT WRITES.
 *
 *   #464 and #465 taught the ghost scan that a migrated profile is NOT keyed by
 *   the auth id: user-migration.ts leaves it under its original Firebase-era id
 *   and writes `supabaseAuthId` onto it, so the join goes through that pointer
 *   or through the email both records share. The scan went from 83 "ghosts" to
 *   58.
 *
 *   orphaned-user-repair.ts was never told. Both halves of it still ask only
 *   `db.collection(USERS).doc(uid)`:
 *
 *     detectOrphanedUsers   would list all 83 — the count the fixed forensic
 *                           now disagrees with by 25.
 *     repairOrphanedUser    guards on the SAME narrow lookup and then CREATES A
 *                           PROFILE. For a migrated user that guard passes, and
 *                           the repair writes a SECOND profile keyed by the auth
 *                           id, splitting one person's data across two rows.
 *
 *   So "Repair All" on /admin/orphaned-users was one click away from
 *   manufacturing 25 duplicate accounts, to fix a problem those users did not
 *   have. That is the fix-reaches-one-of-N shape at its worst: the door left
 *   unfixed is the one holding a pen.
 *
 *   ONE RESOLUTION, HERE, used by the scan, the detector and the repair.
 *
 *   BY DOCUMENT ID, THEN BY EMAIL, and deliberately not by `supabaseAuthId`:
 *   that field lives inside raw_data with no index, and #465 measured what
 *   querying it costs — `canceling statement due to statement timeout`. `email`
 *   is a native column, and is the key user-migration.ts itself matches a legacy
 *   record on.
 *
 *   THE EMAIL MATCH IS A WEAKER LINK than the pointer and the asymmetry is
 *   deliberate: a false NEGATIVE here means a name appears on a report for
 *   somebody to look at, while a false POSITIVE lets the repair write a
 *   duplicate profile. Where the two costs differ that much, the check that
 *   finds MORE existing profiles is the safe one.
 */

import { supabaseDb as db } from './supabase-db';
import { FieldPath } from './firestore-compat';
import { COLLECTIONS } from './types/firestore';

export interface AuthAccount {
    uid: string;
    email?: string | null;
}

/** PostgREST caps an `in` list; the same 30 the forensic scan already used. */
const CHUNK = 30;

function chunked<T>(values: T[]): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < values.length; i += CHUNK) out.push(values.slice(i, i + CHUNK));
    return out;
}

const key = (email: unknown): string =>
    typeof email === 'string' ? email.trim().toLowerCase() : '';

/**
 * The subset of `accounts` that already have a profile.
 *
 * Anything NOT in the returned set is an auth account with no profile found by
 * either route — which is what "orphaned" actually means.
 */
export async function authAccountsWithProfiles(accounts: AuthAccount[]): Promise<Set<string>> {
    const found = new Set<string>();
    if (accounts.length === 0) return found;

    // 1. The ordinary case: the profile is keyed by the auth id.
    const ids = accounts.map((a) => a.uid);
    const byId = await Promise.all(
        chunked(ids).map((chunk) =>
            db.collection(COLLECTIONS.USERS).where(FieldPath.documentId(), 'in', chunk).get(),
        ),
    );
    byId.forEach((snap) => snap.docs.forEach((d: any) => found.add(d.id)));

    // 2. The migrated case: same person, profile under their legacy id.
    const outstanding = accounts.filter((a) => !found.has(a.uid));
    if (outstanding.length === 0) return found;

    const uidByEmail = new Map<string, string>();
    for (const account of outstanding) {
        const email = key(account.email);
        if (email) uidByEmail.set(email, account.uid);
    }
    if (uidByEmail.size === 0) return found;

    const byEmail = await Promise.all(
        chunked([...uidByEmail.keys()]).map((chunk) =>
            db.collection(COLLECTIONS.USERS).where('email', 'in', chunk).get(),
        ),
    );
    byEmail.forEach((snap) => snap.docs.forEach((d: any) => {
        const uid = uidByEmail.get(key(d.data()?.email));
        if (uid) found.add(uid);
    }));

    /**
     *   #478 THE `in` FILTER COMPARES THE RAW COLUMN, SO A ROW STORED AS
     *   '  Ada@Example.COM ' IS NEVER FETCHED.
     *
     *   The normalisation above runs on the stored value AFTER the query, which
     *   reads as though the case is handled — and is not, because the row never
     *   comes back. #476 found this at the login; it is the same shape here, and
     *   here it matters more: repairOrphanedUser guards on this result and then
     *   CREATES A PROFILE, so a person whose profile is merely stored with odd
     *   spacing gets a second one written by the button meant to help them.
     *
     *   Only the accounts still unresolved are asked about, so a tenant with
     *   tidy data pays nothing.
     */
    const stillMissing = accounts.filter((a) => !found.has(a.uid));
    if (stillMissing.length === 0) return found;

    const outstandingEmails = [...new Set(stillMissing.map((a) => key(a.email)).filter(Boolean))];
    if (outstandingEmails.length === 0) return found;

    const { supabaseAdmin } = await import('./supabase');
    const { data, error } = await supabaseAdmin.rpc('find_users_by_normalised_emails', {
        p_emails: outstandingEmails,
    });

    if (error) {
        //   Not silent. Without migration 031 this scan reports people as
        //   ghosts who are not, and the repair beside it may write duplicates
        //   for them — so the log names the file, per #473.
        console.error(
            '[auth-profile-link] find_users_by_normalised_emails unavailable — profiles stored ' +
            'with different case or surrounding space will be reported as orphaned, and the ' +
            'repair may create duplicates for them (#478). Apply ' +
            'supabase/migrations/031_find_users_by_normalised_emails_batch.sql. Reason:',
            error.message,
        );
        return found;
    }

    for (const r of (data ?? []) as Array<{ email: string }>) {
        const uid = uidByEmail.get(key(r.email));
        if (uid) found.add(uid);
    }

    /**
     *   #489 EVERY ROUTE ABOVE NEEDS AN EMAIL, AND 49 PROFILES HAVE NONE.
     *
     *   Two admin approvals minted profiles with `email: ""` — see
     *   lib/profile-email-resolution.ts, which is where that is now stopped.
     *   The rows they already wrote answer to none of the three strategies
     *   above: not the document id, if the profile is a migrated one kept under
     *   its Firebase-era id; not `email`; not the normalised email.
     *
     *   So those people are reported as GHOSTS, and repairOrphanedUser guards
     *   on this same result and then CREATES A PROFILE — writing a second one
     *   for somebody who already has one. That is #466's defect, reached
     *   through a different door.
     *
     *   THE POINTER IS THE STRONGEST LINK OF THE FOUR and the only one that
     *   works with no email: user-migration.ts writes `supabaseAuthId` onto the
     *   legacy profile as an explicit statement of ownership, and
     *   profile-choice.ts and password-reset.ts both already read it.
     *
     *   The header of this file says it was excluded because the field is
     *   unindexed and #465 measured the timeout. Migration 033 adds the index —
     *   measured, 23.608 ms to 0.298 ms for the batch of 100 this scan issues —
     *   so the reason no longer holds.
     *
     *   LAST, because it is the only one needing a migration: a database
     *   without 033 keeps exactly today's behaviour rather than failing.
     */
    const withoutProfile = accounts.filter((a) => !found.has(a.uid));
    if (withoutProfile.length === 0) return found;

    const { data: byPointer, error: pointerError } = await supabaseAdmin.rpc(
        'find_users_by_supabase_auth_ids',
        { p_auth_ids: withoutProfile.map((a) => a.uid) },
    );

    if (pointerError) {
        //   Loud, per #473. A silent degrade here means the scan reports
        //   ghosts who are not, and the repair beside it writes duplicates for
        //   them — which is the exact failure #466 exists to prevent.
        console.error(
            '[auth-profile-link] find_users_by_supabase_auth_ids unavailable — a profile with no ' +
            'email address cannot be linked to its auth account, so those users will be reported ' +
            'as orphaned and the repair may create duplicates for them (#489). Apply ' +
            'supabase/migrations/033_find_users_by_supabase_auth_id.sql. Reason:',
            pointerError.message,
        );
        return found;
    }

    const claimed = new Set(withoutProfile.map((a) => a.uid));
    for (const row of (byPointer ?? []) as Array<{ supabase_auth_id: string }>) {
        //   The RPC returns the pointer, so the row maps straight back to the
        //   account that asked about it — no second pass, and no guessing.
        if (claimed.has(row.supabase_auth_id)) found.add(row.supabase_auth_id);
    }

    return found;
}

/**
 * Whether ONE auth account already has a profile.
 *
 * The repair's guard. Kept beside the batch version so the two cannot drift:
 * the single-account question is the batch question with one element, and
 * answering it a second way is how this finding happened in the first place.
 */
export async function authAccountHasProfile(account: AuthAccount): Promise<boolean> {
    const found = await authAccountsWithProfiles([account]);
    return found.has(account.uid);
}
