/**
 * @jest-environment node
 */

/**
 *   #466 THE FORENSIC LEARNED TO FIND A MIGRATED USER'S PROFILE AND THE REPAIR
 *   DID NOT — AND THE REPAIR IS THE HALF THAT WRITES.
 *
 *   #464 taught the ghost scan that a migrated profile is NOT keyed by the auth
 *   id, and #465 made that lookup cheap enough to finish. Production went from
 *   83 "ghosts" to 58.
 *
 *   orphaned-user-repair.ts was never told. Both halves still asked only
 *   `db.collection(USERS).doc(uid)`:
 *
 *     detectOrphanedUsers   would list all 83, disagreeing with the fixed
 *                           forensic by 25 on the same 100 accounts.
 *     repairOrphanedUser    guarded on the SAME narrow lookup and then CREATED
 *                           A PROFILE. For a migrated user that guard passes,
 *                           so the repair writes a SECOND profile keyed by the
 *                           auth id — one person, two rows, data split between
 *                           them.
 *
 *   "Repair All" on /admin/orphaned-users was one click from manufacturing ~25
 *   duplicate accounts, to fix a problem those users did not have. Third time
 *   in this audit the fix reached some of the doors; first time the door left
 *   unfixed was the one holding a pen.
 *
 *   THE ASYMMETRY IS DELIBERATE. Matching on email is a weaker link than the
 *   `supabaseAuthId` pointer, which #465 could not afford to query — that field
 *   is unindexed and timed the scan out. A false NEGATIVE puts a name on a
 *   report for somebody to look at; a false POSITIVE lets the repair write a
 *   duplicate. Where the costs differ that much, the resolution that finds MORE
 *   existing profiles is the safe one.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the repair guard back to doc(uid) alone     KILLED
 *     the detector back to doc(uid) alone         KILLED
 *     the email step dropped from the resolution  KILLED (only after the fix below)
 *     the batch and single answers diverge        KILLED
 *     a blank email matches a blank stored one    KILLED
 *     reword this header                          SURVIVED, as intended
 *
 *   THE EMAIL-STEP MUTANT SURVIVED THE FIRST ROUND. It added an early
 *   `return found;` and left every string these tests scan for in place — so
 *   the source still said the words and the code skipped the step. That is the
 *   third time in two findings that a source-reading assertion has been
 *   satisfied by code doing the opposite, and the answer is the same one #464
 *   reached: ask the function. The last describe below does.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';

const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

const RESOLVER = 'src/lib/auth-profile-link.ts';
const REPAIR = 'src/lib/orphaned-user-repair.ts';
const FORENSICS = 'src/app/actions/forensics.ts';

// ─────────────────────────────────────────────────────────────────────────────
describe('#466 — the repair cannot create a profile for someone who has one', () => {
    it('THE GUARD BEFORE THE WRITE USES THE SHARED RESOLUTION', () => {
        // This is the assertion that matters. Everything after that guard
        // creates a user profile.
        const repair = source(REPAIR);

        expect(repair).toContain('await authAccountHasProfile({ uid, email: userRecord.email })');
    });

    it('AND NO LONGER GUARDS ON THE DOCUMENT ID ALONE', () => {
        // `doc(uid).get()` is exactly what a migrated user is not stored under.
        const repair = source(REPAIR);

        expect(repair).not.toMatch(/const existingDoc = await db\.collection\(COLLECTIONS\.USERS\)\.doc\(uid\)\.get\(\)/);
    });

    it('AND THE DETECTOR USES IT TOO — a report and its button must agree', () => {
        const repair = source(REPAIR);

        expect(repair).toContain('await authAccountsWithProfiles(');
        expect(repair).not.toContain('const refs = chunk.map(u => db.collection(COLLECTIONS.USERS).doc(u.uid))');
    });

    it('AND SO DOES THE FORENSIC SCAN — one rule, three callers', () => {
        const forensics = source(FORENSICS);

        expect(forensics).toContain('authAccountsWithProfiles(');
        // The scan's own copy of the lookup is gone.
        expect(forensics).not.toContain('.where("email", "in", chunk)');
        expect(forensics).not.toContain('.where("supabaseAuthId", "in", chunk)');
    });

    it('POSITIVE CONTROL: the repair still WRITES for a genuine orphan', () => {
        // Without this, a guard that refused everybody would satisfy every
        // assertion above and silently retire the repair.
        const repair = source(REPAIR);

        expect(repair).toMatch(/\.collection\(COLLECTIONS\.USERS\)\.doc\(uid\)\.set\(|await db\.collection\(COLLECTIONS\.USERS\)\.doc\(uid\)\.set/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#466 — the resolution looks in both places', () => {
    it('BY DOCUMENT ID, THEN BY EMAIL', () => {
        const resolver = source(RESOLVER);

        expect(resolver).toContain("where(FieldPath.documentId(), 'in', chunk)");
        expect(resolver).toContain("where('email', 'in', chunk)");
    });

    it('AND NOT BY supabaseAuthId — #465 measured what that costs', () => {
        // `canceling statement due to statement timeout`. The field is
        // unindexed; a correct join that never completes reports nothing.
        expect(source(RESOLVER)).not.toContain('supabaseAuthId');
    });

    it('AND THE EMAIL STEP ONLY RUNS ON WHAT THE FIRST DID NOT MATCH', () => {
        const resolver = source(RESOLVER);

        expect(resolver).toContain('const outstanding = accounts.filter((a) => !found.has(a.uid))');
        expect(resolver).toContain('if (outstanding.length === 0) return found');
    });

    it('and matches case-insensitively on both sides', () => {
        // Auth stores what somebody typed. "Ada@Example.com" against
        // "ada@example.com" would be a false orphan — and, before this, a
        // duplicate profile.
        const resolver = source(RESOLVER);

        expect(resolver).toContain("email.trim().toLowerCase()");
    });

    it('THE SINGLE-ACCOUNT ANSWER IS THE BATCH ANSWER — not a second implementation', () => {
        // Answering the same question two ways is how #466 happened. The
        // repair's guard must not drift from the detector's rule.
        const resolver = source(RESOLVER);
        const single = resolver.slice(resolver.indexOf('export async function authAccountHasProfile'));

        expect(single).toContain('await authAccountsWithProfiles([account])');
        expect(single).not.toContain('db.collection(');
    });

    it('and an empty input asks the database nothing', () => {
        const resolver = source(RESOLVER);

        expect(resolver).toContain('if (accounts.length === 0) return found');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#466 — asked directly, not read off the source', () => {
    /**
     * A mutant that added an early `return found;` while leaving every string
     * the tests above look for SURVIVED. The scan said the words and skipped the
     * step — the third time in two findings that a source-reading assertion has
     * been satisfied by code doing the opposite.
     *
     * The two queries both reach the harness as `mockFirestoreGet('users')`, so
     * they are told apart by ORDER: first the document-id lookup, then the email
     * one. That ordering is the behaviour under test, not an accident of it.
     */
    const snap = (docs: Array<{ id: string; data: () => unknown }>) =>
        Promise.resolve({ docs, empty: docs.length === 0, size: docs.length });

    beforeEach(() => { jest.clearAllMocks(); });

    it('FINDS A MIGRATED PROFILE BY EMAIL WHEN THE DOCUMENT ID MISSES', async () => {
        const { authAccountsWithProfiles } = await import('@/lib/auth-profile-link');

        (global as any).mockFirestoreGet
            .mockImplementationOnce(() => snap([]))                                  // by id: nothing
            .mockImplementationOnce(() => snap([                                     // by email: the legacy row
                { id: 'legacy-firebase-id', data: () => ({ email: 'ada@example.com' }) },
            ]));

        const found = await authAccountsWithProfiles([{ uid: 'auth-uuid', email: 'ada@example.com' }]);

        expect([...found]).toEqual(['auth-uuid']);
    });

    it('AND MATCHES ACROSS CASE AND SURROUNDING SPACE', async () => {
        const { authAccountsWithProfiles } = await import('@/lib/auth-profile-link');

        (global as any).mockFirestoreGet
            .mockImplementationOnce(() => snap([]))
            .mockImplementationOnce(() => snap([
                { id: 'legacy', data: () => ({ email: '  Ada@Example.COM ' }) },
            ]));

        const found = await authAccountsWithProfiles([{ uid: 'auth-uuid', email: 'ada@example.com' }]);

        expect(found.has('auth-uuid')).toBe(true);
    });

    it('AND A GENUINE ORPHAN IS FOUND BY NEITHER — the control', async () => {
        // Without this, a resolver that claimed everybody had a profile would
        // pass both tests above and disable the whole scan.
        const { authAccountsWithProfiles } = await import('@/lib/auth-profile-link');

        (global as any).mockFirestoreGet
            .mockImplementationOnce(() => snap([]))
            .mockImplementationOnce(() => snap([]));

        const found = await authAccountsWithProfiles([{ uid: 'auth-uuid', email: 'nobody@example.com' }]);

        expect([...found]).toEqual([]);
    });

    it('and the email query is SKIPPED when the id already matched', async () => {
        const { authAccountsWithProfiles } = await import('@/lib/auth-profile-link');

        (global as any).mockFirestoreGet
            .mockImplementationOnce(() => snap([{ id: 'auth-uuid', data: () => ({}) }]));

        const found = await authAccountsWithProfiles([{ uid: 'auth-uuid', email: 'ada@example.com' }]);

        expect(found.has('auth-uuid')).toBe(true);
        expect((global as any).mockFirestoreGet.mock.calls.length).toBe(1);
    });

    it('and an account with no email is not matched to a row with none either', async () => {
        // Two blanks are not a match. Without the guard, every profile whose
        // email is missing would claim every auth account whose email is too.
        const { authAccountsWithProfiles } = await import('@/lib/auth-profile-link');

        (global as any).mockFirestoreGet.mockImplementationOnce(() => snap([]));

        const found = await authAccountsWithProfiles([{ uid: 'auth-uuid', email: null }]);

        expect([...found]).toEqual([]);
        expect((global as any).mockFirestoreGet.mock.calls.length).toBe(1);
    });
});
