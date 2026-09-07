/**
 * @jest-environment node
 */

/**
 *   #489 TWO ADMIN APPROVALS MINT A USER PROFILE WITH `email: ""`, AND THAT IS
 *        WHERE THE 49 BLANK-EMAIL ACCOUNTS CAME FROM.
 *
 *   The owner's forensic report has carried two findings for weeks:
 *
 *       Profiles With No Email Address    49  (48 cooperative_member, 1 farmer)
 *       Ghost Users (Auth, no profile)    53
 *
 *   The split — forty-eight of one role and exactly one of another — is not what
 *   scattered bad data looks like. It is what two code paths look like.
 *
 * ── THE FORTY-EIGHT ─────────────────────────────────────────────────────────
 *
 *   _coop_admin_members.ts, approving a cooperative member who has no user
 *   document yet:
 *
 *       const initialData = {
 *           uid: targetUserId,
 *           email: memberData?.email || "",      ← here
 *           roles: ["cooperative_member"],
 *           isVerified: true,
 *           …
 *       };
 *       await userRef.set(initialData);
 *
 *   `|| ""` on an identity field. The membership row is the only place it
 *   looks, and a row created by a legacy import or an invite may not carry one.
 *
 * ── AND THE ONE ─────────────────────────────────────────────────────────────
 *
 *   _fn_admin.ts, approving a farmer with no user document:
 *
 *       email: profile.email || appData.userEmail || "",
 *
 *   Two sources instead of one, then the same fallback. One farmer.
 *
 * ── WHY AN EMPTY STRING IS NOT A SMALL THING ────────────────────────────────
 *
 *   #479 established it: a blank email is not an identity. Such a profile can
 *   be found ONLY by its document id — not by login, not by password reset, not
 *   by the admin search, and not by authAccountsWithProfiles, which resolves an
 *   auth account to its profile by document id or by EMAIL.
 *
 *   So a person approved through either path, whose profile is not keyed by
 *   their auth id, is unreachable by every route the platform has. They cannot
 *   sign in. And they are counted as a GHOST by the forensic scan — which is
 *   the second finding, and which is one click from being "repaired" into a
 *   duplicate profile.
 *
 *   The two findings are one defect.
 *
 * ── WHAT THIS CHANGES ───────────────────────────────────────────────────────
 *
 *   Both paths look properly before giving up: the membership or application
 *   record, then the AUTH RECORD for that same uid — which is where the address
 *   almost always is, because the person signed up with it.
 *
 *   AND IF THERE IS GENUINELY NONE, THE APPROVAL REFUSES, naming what is
 *   missing. That is the half worth arguing about, so it is argued here: the
 *   alternative is what the code did, which is to create an account nobody can
 *   sign into, that no admin can search for, that the platform's own scan
 *   reports as a ghost, and that has `isVerified: true` on it. A refusal an
 *   admin can act on is strictly better than a record nobody can. The message
 *   names the member and the missing field.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the `|| ""` fallback restored, cooperative    KILLED
 *     the `|| ""` fallback restored, farm nation     KILLED
 *     the auth-record lookup removed                 KILLED
 *     the refusal returning success, cooperative     KILLED
 *     the refusal returning success, farm nation     KILLED
 *     the supabaseAuthId strategy removed            KILLED
 *     the migration's schema reload dropped          KILLED
 *     reword this header                             SURVIVED, as intended
 *
 *   THE REFUSAL MUTANT SURVIVED THE FIRST RUN. The assertion looked for the
 *   message text anywhere in the file, so a version that kept the wording and
 *   returned `success: true` passed — the approval would have carried on and
 *   created the profile with the sentence of a refusal sitting beside it. A
 *   message is not a control, and the test now pins the return.
 *
 *   Two other mutants reported SURVIVED on that run without having been
 *   applied at all: their anchors matched a different number of times than the
 *   harness expected, and it printed a result anyway. Both were re-run once the
 *   anchors were right. A mutation table is only worth the integrity check
 *   underneath it.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';

const code = (rel: string) => stripComments(readFileSync(rel, 'utf-8'), { label: rel });

const COOP = 'src/app/actions/cooperative/_coop_admin_members.ts';
const FARM = 'src/app/actions/farm-nation/_fn_admin.ts';
const RESOLVER = 'src/lib/profile-email-resolution.ts';

/** The block that creates a user document, in each file. */
function creationBlock(rel: string, marker: string): string {
    const body = code(rel);
    const start = body.indexOf(marker);
    return start === -1 ? '' : body.slice(start, start + 1800);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#489 — neither approval mints a profile with an empty email', () => {
    it('THE COOPERATIVE APPROVAL DOES NOT WRITE `email: ""`', () => {
        //   THE test, and the source of forty-eight of the forty-nine.
        const block = creationBlock(COOP, 'const initialData = {');

        expect(block.length).toBeGreaterThan(0);
        expect(block).not.toMatch(/email:\s*[^,\n]*\|\|\s*""/);
    });

    it('AND NEITHER DOES THE FARM NATION APPROVAL', () => {
        //   The forty-ninth. Two sources instead of one, then the same
        //   fallback — which is why the count is 48 and 1 rather than 49 and 0.
        const block = creationBlock(FARM, 'transaction.set(userRef, {');

        expect(block.length).toBeGreaterThan(0);
        expect(block).not.toMatch(/email:\s*[^,\n]*\|\|\s*""/);
    });

    it('POSITIVE CONTROL: the pattern really does match what was there', () => {
        //   Both assertions above are `not.toMatch`, which passes over an empty
        //   string or a block the marker failed to find.
        const sample = 'email: profile.email || appData.userEmail || "",';

        expect(/email:\s*[^,\n]*\|\|\s*""/.test(sample)).toBe(true);
    });

    it('BOTH ASK THE AUTH RECORD, WHICH IS WHERE THE ADDRESS ACTUALLY IS', () => {
        //   A member being approved signed up with an email. Neither path
        //   looked there; both looked only at the record in front of them.
        for (const rel of [COOP, FARM]) {
            expect({ rel, resolves: code(rel).includes('resolveProfileEmail') })
                .toEqual({ rel, resolves: true });
        }
        expect(code(RESOLVER)).toContain('adminAuth.getUser');
    });

    it('AND BOTH REFUSE RATHER THAN CREATE AN ACCOUNT NOBODY CAN REACH', () => {
        //   The deliberate half. The alternative is an account that cannot log
        //   in, cannot be searched for, is reported as a ghost by the platform's
        //   own scan, and carries isVerified: true.
        //
        //   IT ASSERTS THE REFUSAL, NOT THE SENTENCE. The first version looked
        //   for the message text anywhere in the file, and a mutant that kept
        //   the message and returned `success: true` SURVIVED — the approval
        //   would have carried on and created the profile with the wording of a
        //   refusal sitting beside it. A message is not a control.
        for (const rel of [COOP, FARM]) {
            const body = code(rel);
            const at = body.indexOf('no email address on file');

            expect({ rel, present: at > -1 }).toEqual({ rel, present: true });

            //   The `return` that carries it must be a failure, and must come
            //   before the message rather than after some other branch's.
            const block = body.slice(Math.max(0, at - 400), at);
            expect({ rel, refuses: /success:\s*false as const/.test(block) })
                .toEqual({ rel, refuses: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#489 — the refusal is narrow, and the rest of the approval is untouched', () => {
    /**
     * The way this becomes an outage is by refusing approvals that would have
     * worked. The guard fires only on the path that CREATES a profile, and only
     * when no address exists anywhere.
     */
    it('AN EXISTING USER DOCUMENT IS STILL UPDATED WITHOUT ANY EMAIL CHECK', () => {
        //   The common case by far: the member already has a profile. Nothing
        //   about this change may touch it.
        const body = code(COOP);
        const update = body.indexOf('await userRef.update(normalizeUserUpdate(userDocUpdate))');

        expect(update).toBeGreaterThan(-1);
        //   The refusal sits inside the creation branch, before the set.
        const refusal = body.indexOf('no email address on file');
        const create = body.indexOf('await userRef.set(initialData)');
        expect(refusal).toBeLessThan(create);
        expect(refusal).toBeGreaterThan(-1);
    });

    it('AND THE RESOLVER PREFERS THE RECORD IN HAND BEFORE CALLING OUT', () => {
        //   An auth lookup per approval is a round trip. It runs only when the
        //   record does not already carry an address, which is the rare case —
        //   and it must never overwrite one that is there.
        const resolver = code(RESOLVER);
        const candidates = resolver.indexOf('for (const candidate of candidates)');
        const authCall = resolver.indexOf('adminAuth.getUser');

        expect(candidates).toBeGreaterThan(-1);
        expect(candidates).toBeLessThan(authCall);
    });

    it('and a failed auth lookup is not an error the admin has to decode', () => {
        //   The auth record may genuinely be absent — an admin-created
        //   membership for somebody who never signed up. That is the case the
        //   refusal is FOR, and it must arrive as the refusal, not as a stack
        //   trace.
        const resolver = code(RESOLVER);

        expect(resolver).toContain('catch');
        expect(resolver).toContain('return null');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#489 — and the ghost scan can see a profile that has no email', () => {
    /**
     * The other half of the same defect. authAccountsWithProfiles resolves an
     * auth account to its profile by document id, then by email, then by
     * normalised email. A profile with NO email answers to none of those, so a
     * migrated user whose profile is blank-emailed is reported as a ghost — and
     * "Repair All" would write them a second profile.
     */
    it('IT ALSO MATCHES ON supabaseAuthId, THE POINTER MIGRATION WRITES', () => {
        const link = code('src/lib/auth-profile-link.ts');

        expect(link).toContain('find_users_by_supabase_auth_ids');
    });

    it('AND IT SAYS SO LOUDLY WHEN THE MIGRATION IS NOT APPLIED', () => {
        //   #473's rule. A silent degrade here means the scan reports ghosts
        //   who are not, and the repair beside it may write duplicates for
        //   them — which is exactly what #466 was about.
        const link = code('src/lib/auth-profile-link.ts');

        expect(link).toContain('033_find_users_by_supabase_auth_id.sql');
        expect(link).toContain('console.error');
    });

    it('and the migration is transaction-safe and in the consolidated deploy', () => {
        //   #469: the SQL Editor always opens a transaction, so a migration
        //   that cannot run in one is a migration that never gets applied here.
        const sql = readFileSync('supabase/migrations/033_find_users_by_supabase_auth_id.sql', 'utf-8');

        expect(sql).not.toMatch(/CREATE\s+INDEX\s+CONCURRENTLY/i);
        expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
        expect(readFileSync('scripts/build-deploy-sql.mjs', 'utf-8')).toContain('n: "033"');
    });
});
