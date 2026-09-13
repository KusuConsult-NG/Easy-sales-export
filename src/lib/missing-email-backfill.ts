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
 * ── AND THAT LAST PARAGRAPH IS FALSE FOR THE 48 IT WAS WRITTEN ABOUT ────────
 *
 *   Left standing above, because it is what this module was built on and the
 *   correction only means anything beside it.
 *
 *   #671 asserted it and nothing had checked: the repair was reachable only
 *   behind an admin session and had never been run. #702 put it on a daily
 *   cron; #714 and #715 made its answer trustworthy. The first run against
 *   production that could be believed reported:
 *
 *       scanned 48, filled 0, needsAPerson 47, couldNotTell 1
 *
 *       47 × no-auth-account      Auth was REACHED and says there is no
 *                                 account at that id
 *        1 × auth-lookup-failed   "Expected parameter to be UUID but is not"
 *                                 — EHp5pfEwUqVBQve9s3fh3dfehrJ2, a
 *                                 Firebase-era uid Supabase will not accept
 *
 *   No outcome carried "resolved to <id>", so not one of the 48 has a
 *   `_migratedTo` or `supabaseAuthId` pointer either. They are not migrated
 *   rows whose account sits elsewhere. THERE IS NO ACCOUNT.
 *
 *   So these 48 people hold a profile with no login behind it: they cannot
 *   sign in and never could, and no automatic repair can change that. Copying
 *   an address is a fact-moving operation; creating a login is not, and
 *   inventing one for somebody is not this audit's to do.
 *
 *   WHAT THIS MODULE IS STILL FOR is unchanged and worth keeping: the day a
 *   49th profile appears whose account DOES exist, the cron fills it silently
 *   and nobody has to notice. What changed is that the 48 already on the list
 *   are now known to need a person, and #718 gives that person something to
 *   work with instead of a column of UUIDs.
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

/**
 * A phone number, masked to the last four digits — #490's rule, for #718.
 *
 * Enough for an operator to recognise the person against a membership list or
 * a bank record, and not enough to be a contact-details export. A repair
 * screen is as likely to be screenshotted as a report.
 */
export function maskPhone(phone: string): string {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 4) return "***";
    return `***${digits.slice(-4)}`;
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

/** Everything the read-only half of this module works out, for both callers. */
export interface ProfileLookups {
    profiles: { id: string; data: Record<string, any> }[];
    /** Profile id -> the id Auth was asked about, after following #449's walk. */
    authIdFor: Map<string, string>;
    /** That asked-about id -> what Auth established. */
    lookupById: Map<string, AuthLookup>;
}

/**
 * Select the blank-email profiles and find out what Auth knows about each.
 *
 * WRITES NOTHING, and is shared by the repair and by the admin preview — #718.
 * The preview used to return bare ids while the repair did all of this, so the
 * two knew different amounts about the same rows. The endpoint's own header
 * already states the rule this keeps: "the preview cannot disagree with the
 * action — this audit's two-hand-maintained-copies defect, avoided by having
 * one."
 */
export async function lookUpProfilesWithNoEmail(limit = 500): Promise<ProfileLookups> {
    const profiles = await profilesWithNoEmail(limit);

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

    return { profiles, authIdFor, lookupById };
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
    const { profiles, authIdFor, lookupById } = await lookUpProfilesWithNoEmail(limit);
    const outcomes: EmailBackfillOutcome[] = [];

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

/** What an operator needs to act on one unreachable profile — #718. */
export interface ProfileWithNoEmail {
    profileId: string;
    /** The id Auth was asked about. Differs only for a migrated row. */
    authId: string;
    /** fullName, or the structured name fields joined. Empty when the row has neither. */
    name: string;
    /** Masked to the last four digits, or null when the row carries none. */
    phone: string | null;
    roles: string[];
    createdAt: string | null;
    /**
     * What Supabase Auth said about `authId`.
     *
     *   has-account      the person can sign in; the address is simply absent
     *                    from the profile and the repair will fill it
     *   no-account       Auth was reached and says there is none — this person
     *                    CANNOT SIGN IN, and no automatic repair exists
     *   could-not-tell   the lookup did not work; nothing is known — #714
     */
    authAccount: "has-account" | "no-account" | "could-not-tell";
    /** Why, when the lookup failed. Carried through from the Auth client. */
    detail?: string;
}

/**
 * Describe every profile with no email address, for a person who has to act.
 *
 *   #718 THE OPERATOR WAS HANDED FORTY-EIGHT UUIDs AND NOTHING ELSE.
 *
 *   GET /api/admin/backfill-missing-emails returned `profileIds` — bare ids —
 *   and said why in its own comment: "the whole point of these rows is that
 *   they have no address to return, and the rest of a profile is not this
 *   endpoint's business."
 *
 *   THAT REASONING RESTED ON A PREMISE THAT IS NOW KNOWN TO BE FALSE. It was
 *   written when #671's claim held — "the address is not missing, it is in
 *   Supabase Auth against the same account id, verified" — so the ids were all
 *   anyone needed, because the repair would fill them in unattended.
 *
 *   The first real run says otherwise. Of the 48 in production, 47 came back
 *   `no-auth-account` from a lookup that reached Auth, and the 48th is a
 *   Firebase-era uid Supabase will not even accept as a parameter. There is no
 *   account to copy an address from. A person has to identify these people by
 *   other means, and a list of opaque UUIDs gives them nothing to do it with.
 *
 *   SO THE ENDPOINT NOW RETURNS WHAT IT ALREADY HAS. Name, masked phone, roles
 *   and creation date are on the row that was read anyway, and they are the
 *   keys left: a name and the last four digits of a phone are what match a
 *   person against a cooperative's membership list or a bank record.
 *
 *   NOT the NIN, BVN, address or bank details those rows also carry. This is a
 *   screen for finding out who somebody is, not for exporting their identity
 *   documents, and #490's rule is that a repair view is as likely to be
 *   screenshotted as a report.
 *
 *   It also says, per row, whether Auth has an account — because "this person
 *   cannot sign in at all" and "this row is just missing a field" need
 *   completely different responses, and the old list could not tell an operator
 *   which they were looking at.
 */
export async function describeProfilesWithNoEmail(limit = 500): Promise<ProfileWithNoEmail[]> {
    const { profiles, authIdFor, lookupById } = await lookUpProfilesWithNoEmail(limit);

    return profiles.map((profile) => {
        const data = profile.data ?? {};
        const authId = authIdFor.get(profile.id) ?? profile.id;
        const lookup = lookupById.get(authId);

        //   Absent from the map means no answer was seen for it, which is
        //   "could not tell" — the same default the repair takes (#714).
        const authAccount: ProfileWithNoEmail["authAccount"] =
            lookup?.kind === "found" ? "has-account"
            : lookup?.kind === "absent" ? "no-account"
            : "could-not-tell";

        //   fullName is what old registration wrote; the structured fields are
        //   what every module written after April 2026 writes. Rows exist with
        //   one, the other, or neither, so both are read and neither is assumed.
        const structured = [data.firstName, data.otherName, data.lastName]
            .filter((part) => typeof part === "string" && part.trim() !== "")
            .join(" ")
            .trim();
        const name = (typeof data.fullName === "string" && data.fullName.trim() !== "")
            ? data.fullName.trim()
            : structured;

        const rawPhone = typeof data.phone === "string" ? data.phone.trim() : "";

        return {
            profileId: profile.id,
            authId,
            name,
            phone: rawPhone === "" ? null : maskPhone(rawPhone),
            roles: Array.isArray(data.roles) ? data.roles.map(String) : [],
            createdAt: typeof data.createdAt === "string"
                ? data.createdAt
                : (data.createdAt?.toDate?.()?.toISOString?.() ?? null),
            authAccount,
            ...(lookup?.kind === "failed" && lookup.detail ? { detail: lookup.detail } : {}),
        };
    });
}
