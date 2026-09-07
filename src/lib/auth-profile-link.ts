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
