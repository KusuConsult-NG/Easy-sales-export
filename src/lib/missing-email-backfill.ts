/**
 * Filling in the address on a profile that has none.
 *
 *   #671 FORTY-EIGHT PROFILES WITH NO EMAIL, AND THE ONLY REPAIR REQUIRED THE
 *   PERSON TO LOG IN FIRST.
 *
 *        The owner's production forensic scan:
 *
 *            Profiles With No Email Address — 48 records
 *            (every one of them general_user, cooperative_member)
 *
 *        #479 established what this costs. Every lookup in this codebase that
 *        resolves a person from an address — the login, the ghost scan, the
 *        session guard, password reset, the cooperative and module checks —
 *        misses a profile with no address. If the row sits under a legacy id
 *        rather than the auth id, the person is unreachable and #476's branch
 *        writes them a blank profile at their next login instead of finding the
 *        one they have.
 *
 *        #479's fix was to make the LOGIN repair its own row from the address
 *        Supabase Auth had just verified. That is right, and it only ever
 *        reaches people who log in. These 48 are, by construction, the ones who
 *        have not — so the population that most needs the repair is exactly the
 *        population the repair cannot reach. It would have sat there
 *        indefinitely.
 *
 *        THE ADDRESS IS NOT MISSING. It is in Supabase Auth, against the same
 *        account id, verified. Nothing needs to be guessed, asked for, or
 *        reconstructed — it needs to be copied from the system of record for
 *        addresses into the profile that should already have it.
 *
 * ── WHAT THIS WILL NOT DO ───────────────────────────────────────────────────
 *
 *   IT NEVER OVERWRITES AN ADDRESS. Only a profile whose email is null, empty
 *   or whitespace is touched, and the check is re-read immediately before the
 *   write rather than trusted from the scan that selected it. A profile whose
 *   address DIFFERS from the authenticated one is a finding, not something to
 *   quietly reconcile, and overwriting it would destroy the evidence — #479's
 *   rule, kept verbatim.
 *
 *   IT NEVER DELETES OR REPLACES ANYTHING ELSE. One field, merged. No row is
 *   removed, no row is created, no other field is written but `updatedAt`.
 *
 *   IT IS IDEMPOTENT. A second run finds the repaired rows no longer blank and
 *   skips them, so it can be run twice, or interrupted and re-run, with the
 *   same result. Every outcome is reported per profile rather than totalled, so
 *   a partial run says exactly which rows it reached.
 *
 *   AND IT IS NOT PART OF THE SCAN. The forensics screen tells the operator it
 *   only reads, and a measurement that repairs what it measures cannot be run
 *   twice for the same answer. This is a separate action, pressed on purpose.
 */

import { adminAuth } from "@/lib/firebase-admin";
import { supabaseDb as db } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";

/** What happened to one profile, and why. Never a bare count — #658. */
export interface EmailBackfillOutcome {
    profileId: string;
    result:
        | "filled"
        | "no-auth-account"
        | "auth-has-no-email"
        | "already-had-one"
        | "profile-vanished"
        | "write-failed";
    /** The address written, masked. Absent unless something was written. */
    filled?: string;
    detail?: string;
}

export interface EmailBackfillReport {
    scanned: number;
    filled: number;
    outcomes: EmailBackfillOutcome[];
}

/** The same masking the forensic report uses — #490. A repair log is as screenshotted as a report. */
export function maskAddress(email: string): string {
    const [local, domain] = email.split("@");
    if (!domain) return "***";
    return `${local.slice(0, 3)}${local.length > 3 ? "***" : ""}@${domain}`;
}

/** Blank means null, undefined, empty or whitespace — #479, and the reason `|| ''` is not enough. */
export function isBlankEmail(value: unknown): boolean {
    return typeof value !== "string" || value.trim() === "";
}

/**
 * Decide what to do about one profile, given what Auth says.
 *
 * SEPARATED FROM THE I/O ON PURPOSE. This is the whole rule, and it is the part
 * worth testing directly: a repair whose decision can only be exercised by
 * standing up a database and an auth service is a repair nobody re-tests after
 * changing it.
 *
 * @param storedEmail what the profile currently has
 * @param authEmail   what Supabase Auth holds for the same id, if the account exists
 */
export function backfillDecision(
    storedEmail: unknown,
    authEmail: string | null | undefined,
): { write: false; result: EmailBackfillOutcome["result"] } | { write: true; value: string } {
    //   Re-checked here rather than trusted from the query that selected the
    //   row. The scan and the write are two round trips apart, and a login in
    //   between would have filled it — at which point this must do nothing.
    if (!isBlankEmail(storedEmail)) return { write: false, result: "already-had-one" };

    if (authEmail === null || authEmail === undefined) return { write: false, result: "no-auth-account" };

    const normalised = String(authEmail).trim().toLowerCase();
    //   An auth account with no address of its own — a phone-only signup. There
    //   is nothing to copy, and inventing one would be worse than the gap.
    if (normalised === "") return { write: false, result: "auth-has-no-email" };

    return { write: true, value: normalised };
}

/**
 * Find every profile whose email is blank.
 *
 * BOTH SHAPES. `""` and `null` are separate rows to a database and the forensic
 * check above has always queried them separately; a backfill that repaired only
 * one of them would report success and leave half the population behind.
 */
export async function profilesWithNoEmail(limit = 500): Promise<{ id: string; data: Record<string, any> }[]> {
    const found = new Map<string, Record<string, any>>();

    for (const value of ["", null]) {
        const snap = await db.collection(COLLECTIONS.USERS)
            .where("email", "==", value as any)
            .limit(limit)
            .get();
        for (const d of snap.docs) {
            if (!found.has(d.id)) found.set(d.id, (d.data() ?? {}) as Record<string, any>);
        }
    }

    return [...found].map(([id, data]) => ({ id, data }));
}

/**
 * Copy the verified address from Supabase Auth onto every profile that has
 * none.
 *
 * Auth is read in batches through `getUsers`, which point-reads by uid and
 * reports misses rather than throwing — a profile whose auth account is gone
 * must not fail the whole run for the other forty-seven.
 */
export async function backfillMissingEmails(limit = 500): Promise<EmailBackfillReport> {
    const profiles = await profilesWithNoEmail(limit);
    const outcomes: EmailBackfillOutcome[] = [];

    //   Auth addresses first, in chunks, so the loop below does one write per
    //   profile and no reads.
    const authEmailById = new Map<string, string | null>();
    const CHUNK = 100;
    for (let i = 0; i < profiles.length; i += CHUNK) {
        const chunk = profiles.slice(i, i + CHUNK);
        try {
            const result: any = await (adminAuth as any).getUsers(chunk.map((p) => ({ uid: p.id })));
            for (const user of result?.users ?? []) {
                if (user?.uid) authEmailById.set(user.uid, user.email ?? "");
            }
        } catch (e: any) {
            //   A failed chunk leaves its ids absent from the map, so every
            //   profile in it is reported "no-auth-account" and NOTHING IS
            //   WRITTEN for it. That is the safe direction: the run
            //   under-repairs and says so, and can simply be run again.
            logger.error(`[missing-email-backfill] Could not read an Auth batch: ${e?.message}`);
        }
    }

    let filled = 0;
    for (const profile of profiles) {
        /**
         * RE-READ, rather than trusting the query that selected this row.
         *
         *   The header above promises the blank is checked "immediately before
         *   the write", and the first version of this loop did not do it — it
         *   passed `profile.data.email`, the value captured when the selection
         *   query ran, several round trips and one batched Auth read earlier.
         *
         *   A behavioural test written against that promise is what found it.
         *   The window is real: #479 has the LOGIN repair the same field, so a
         *   person signing in between the selection and the write is exactly
         *   the case that fills a row underneath this loop — and the whole
         *   safety claim of this module is that an address already present is
         *   never overwritten.
         *
         *   It is one point read per row, on a job that is already doing one
         *   write per row.
         */
        let current: unknown = profile.data.email;
        try {
            const fresh = await db.collection(COLLECTIONS.USERS).doc(profile.id).get();
            if (!fresh.exists) {
                //   Deleted between the selection and now. Nothing to repair,
                //   and creating the row would resurrect an account somebody
                //   removed.
                outcomes.push({ profileId: profile.id, result: "profile-vanished" });
                continue;
            }
            current = (fresh.data() ?? {}).email;
        } catch {
            //   Could not confirm the row is still blank, so it is not written.
            //   Reported as its own outcome rather than guessed either way.
            outcomes.push({ profileId: profile.id, result: "write-failed", detail: "could not re-read the profile" });
            continue;
        }

        const decision = backfillDecision(current, authEmailById.has(profile.id) ? authEmailById.get(profile.id) : null);

        if (!decision.write) {
            outcomes.push({ profileId: profile.id, result: decision.result });
            continue;
        }

        try {
            await db.collection(COLLECTIONS.USERS).doc(profile.id).set(
                { email: decision.value, updatedAt: FieldValue.serverTimestamp() },
                { merge: true },
            );
            filled += 1;
            outcomes.push({ profileId: profile.id, result: "filled", filled: maskAddress(decision.value) });
            logger.warn(
                `[missing-email-backfill] Profile ${profile.id} had NO email stored and was reachable only `
                + `by id (#479/#671). Filled it in from the address Supabase Auth holds for the same account.`,
            );
        } catch (e: any) {
            //   Reported, not thrown. One row that will not take a write must
            //   not strand the rest, and the operator needs to know which.
            outcomes.push({ profileId: profile.id, result: "write-failed", detail: e?.message ?? "unknown error" });
            logger.error(`[missing-email-backfill] Could not fill ${profile.id}: ${e?.message}`);
        }
    }

    return { scanned: profiles.length, filled, outcomes };
}
