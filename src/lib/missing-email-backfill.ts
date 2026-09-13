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
import { resolveActiveUserId } from "@/lib/user-identity";
import { logger } from "@/lib/logger";

/** What happened to one profile, and why. Never a bare count — #658. */
export interface EmailBackfillOutcome {
    profileId: string;
    result:
        | "filled"
        | "no-auth-account"
        | "auth-lookup-failed"
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
 * What the Auth read established about one profile id.
 *
 *   #714 "AUTH HAS NO ACCOUNT FOR THIS PERSON" AND "I COULD NOT ASK AUTH" WERE
 *   THE SAME ANSWER.
 *
 *   `backfillDecision` took `authEmail: string | null | undefined` and read
 *   null-or-undefined as `no-auth-account`. Everything that could not produce
 *   an address arrived as one of those two: an account that genuinely does not
 *   exist, a batch read that threw, a service key Supabase would not accept, an
 *   id that is not a UUID. The caller then reported all of them as a statement
 *   about the PERSON — that they have no auth account — having established
 *   nothing of the kind.
 *
 *   THE FIRST PRODUCTION RUN IS WHY THIS IS A FINDING AND NOT A TIDY-UP. It
 *   returned `no-auth-account` for all 48 profiles, unanimously. Forty-eight
 *   orphaned profiles and one broken lookup produce exactly the same report,
 *   and they need completely different responses — so the report was unusable
 *   for the only question anyone wanted to ask of it.
 *
 *   Three states, named, so a caller cannot accidentally collapse two of them.
 */
export type AuthLookup =
    /** Auth answered, and holds this account. `email` may still be blank. */
    | { kind: "found"; email: string | null | undefined }
    /** Auth answered, and says there is no such account. */
    | { kind: "absent" }
    /** The lookup did not work. Nothing is known about this account either way. */
    | { kind: "failed"; detail?: string };

/**
 * Decide what to do about one profile, given what Auth says.
 *
 * SEPARATED FROM THE I/O ON PURPOSE. This is the whole rule, and it is the part
 * worth testing directly: a repair whose decision can only be exercised by
 * standing up a database and an auth service is a repair nobody re-tests after
 * changing it.
 *
 * @param storedEmail what the profile currently has
 * @param lookup      what the Auth read established — see AuthLookup
 */
export function backfillDecision(
    storedEmail: unknown,
    lookup: AuthLookup,
): { write: false; result: EmailBackfillOutcome["result"]; detail?: string } | { write: true; value: string } {
    //   Re-checked here rather than trusted from the query that selected the
    //   row. The scan and the write are two round trips apart, and a login in
    //   between would have filled it — at which point this must do nothing.
    if (!isBlankEmail(storedEmail)) return { write: false, result: "already-had-one" };

    //   Both write nothing, and they are still reported apart: `absent` is a
    //   fact about the account that somebody must now act on, `failed` is a
    //   fact about this run that means run it again.
    if (lookup.kind === "failed") return { write: false, result: "auth-lookup-failed", detail: lookup.detail };
    if (lookup.kind === "absent") return { write: false, result: "no-auth-account" };

    const normalised = String(lookup.email ?? "").trim().toLowerCase();
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

    /**
     * What Auth established about each id, in chunks, so the loop below does
     * one write per profile and no reads.
     *
     *   #714 — A MAP OF ADDRESSES CANNOT EXPRESS "I DID NOT FIND OUT".
     *
     *   This was `Map<string, string | null>`, and an id simply absent from it
     *   meant "no auth account". A failed chunk left its ids absent in exactly
     *   the same way, so a run where the Auth read did not work was reported as
     *   a run that proved forty-eight people have no account.
     *
     *   THE DEFAULT IS NOW "failed", NOT "absent". An id is only reported
     *   `no-auth-account` when Auth was reached and named it in `notFound`;
     *   anything this code did not see an answer for stays "I could not find
     *   out". Writing is unaffected — neither state writes — so the change is
     *   in what the run CLAIMS, which is the part that was wrong.
     */
    /**
     * WHICH ID TO ASK AUTH ABOUT — #715.
     *
     *   THE BACKFILL LOOKED UP SUPABASE AUTH BY THE DOCUMENT ID, FOR EXACTLY
     *   THE POPULATION WHOSE DOCUMENT ID IS NOT THE AUTH ID.
     *
     *   #464/#466 established the rule and lib/user-identity.ts states it once:
     *   a migrated profile keeps its Firebase-era document id and carries
     *   `_migratedTo`, then `supabaseAuthId`, pointing at the live account.
     *   #449 built resolveActiveUser after finding SIX readers answering this
     *   question and five of them differently — a cycle that hung a login, a
     *   dangling pointer that refused one, and a two-hop chain that split the
     *   session from the payment.
     *
     *   This module was written afterwards and is a SEVENTH reader that never
     *   got the rule. It asked `getUsers([{ uid: profile.id }])`, and for a
     *   legacy-keyed row that id is not an account anywhere, so Auth answers
     *   404 truthfully and the run concluded "this person has no auth account"
     *   from the wrong key. Same class as #710 and #713 and half this audit:
     *   a correct rule applied to some of the places it names.
     *
     *   AND ITS TARGET POPULATION IS PRECISELY THE ONE THAT NEEDS IT. These
     *   rows are, by definition, reachable only by id — they have no email for
     *   the fallback join in auth-profile-link.ts to use — and one of the 48 in
     *   production is `EHp5pfEwUqVBQve9s3fh3dfehrJ2`, a Firebase-era uid, which
     *   cannot be a Supabase account id at all.
     *
     *   The full walk, not activeIdFromRow's single hop: #449 measured a
     *   two-hop chain, and stopping at the middle row would ask Auth about
     *   another id that is not an account either. A row with no pointer stops
     *   immediately and costs one read.
     */
    const authIdFor = new Map<string, string>();
    for (const profile of profiles) {
        try {
            const resolved = await resolveActiveUserId(profile.id, db.collection(COLLECTIONS.USERS));
            authIdFor.set(profile.id, resolved.id);
            if (resolved.healed) {
                //   A broken chain is a finding in its own right, and the walk
                //   degrades to the last row that exists rather than to nothing.
                logger.warn(
                    `[missing-email-backfill] profile ${profile.id} has a ${resolved.stoppedBecause} `
                    + `migration pointer; asking Auth about ${resolved.id} after ${resolved.hops} hop(s).`,
                );
            }
        } catch (e: any) {
            //   Could not resolve, so fall back to the document id rather than
            //   skipping the row. That is what this did for every row before,
            //   and it is still the right floor.
            logger.error(`[missing-email-backfill] could not resolve an active id for ${profile.id}: ${e?.message}`);
            authIdFor.set(profile.id, profile.id);
        }
    }

    /** Auth answers are keyed by the id ASKED ABOUT; profiles map onto them. */
    const lookupById = new Map<string, AuthLookup>();
    const askedIds = [...new Set(profiles.map((p) => authIdFor.get(p.id) ?? p.id))];
    const CHUNK = 100;
    for (let i = 0; i < askedIds.length; i += CHUNK) {
        const chunk = askedIds.slice(i, i + CHUNK);
        try {
            const result: any = await (adminAuth as any).getUsers(chunk.map((uid) => ({ uid })));
            for (const user of result?.users ?? []) {
                if (user?.uid) lookupById.set(user.uid, { kind: "found", email: user.email ?? "" });
            }
            for (const identifier of result?.notFound ?? []) {
                if (identifier?.uid) lookupById.set(identifier.uid, { kind: "absent" });
            }
            for (const failure of result?.errored ?? []) {
                if (failure?.identifier?.uid) {
                    lookupById.set(failure.identifier.uid, { kind: "failed", detail: failure.message });
                }
            }
        } catch (e: any) {
            //   A failed chunk leaves its ids absent from the map, so every
            //   profile in it falls to the "failed" default below and NOTHING
            //   IS WRITTEN for it. That is the safe direction: the run
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

        const askedAbout = authIdFor.get(profile.id) ?? profile.id;
        const decision = backfillDecision(
            current,
            //   The default is the honest one: an id this run never saw an
            //   answer for is one it could not find out about — #714.
            lookupById.get(askedAbout) ?? { kind: "failed", detail: "the Auth read returned nothing for this id" },
        );

        if (!decision.write) {
            outcomes.push({
                profileId: profile.id,
                result: decision.result,
                //   Which id the answer is ABOUT, whenever it is not the
                //   profile's own — #715. Without it, "no-auth-account" on a
                //   migrated row is unreadable: the operator cannot tell which
                //   of two ids Auth was asked about.
                detail: askedAbout === profile.id
                    ? decision.detail
                    : [decision.detail, `resolved to ${askedAbout}`].filter(Boolean).join("; "),
            });
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
