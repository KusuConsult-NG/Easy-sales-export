/**
 * @jest-environment node
 */

/**
 * Signing in picked which profile was yours by a rule that could pick someone
 * else's.
 *
 * Supabase authenticates the caller, which settles WHO they are. lib/auth.ts
 * then has to decide which USERS document is theirs — and when no profile sits
 * at the Supabase account id, it queries the collection by EMAIL. That query is
 * not unique: duplicate and legacy rows exist on this platform, which is why
 * broadcast.ts dedupes its recipient list by email before sending.
 *
 * TWO THINGS WERE WRONG WITH THE PICK.
 *
 * 1. `supabaseAuthId` was never consulted. It is the field the JIT migration
 *    writes to link a legacy profile to its new Supabase account —
 *    preValidateLoginAction writes it, resetPasswordAction resolves the account
 *    by it, and payments/service.ts uses precisely this order:
 *
 *        if (userData?._migratedTo)        activeUserId = userData._migratedTo;
 *        else if (userData?.supabaseAuthId) activeUserId = userData.supabaseAuthId;
 *
 *    The one place that decides who you are signed in AS used the first half
 *    and skipped the second.
 *
 * 2. The last resort preferred ANY row carrying a `_migratedTo` — whatever it
 *    pointed at — over the first row. The code immediately below then adopts
 *    that pointer as the session id:
 *
 *        if (matchedData._migratedTo) uid = matchedData._migratedTo;
 *
 *    So a caller could be issued a session for an account they had not
 *    authenticated as, selected because some unrelated row happened to carry a
 *    migration marker. It preferred one arbitrary answer over another and
 *    dressed it up as a match.
 *
 * The fix is three real identity matches in the platform's own order, then the
 * first row, and a loud log when it comes to that. The final fallback is
 * deliberately unchanged: with one row it is the only answer, and with several
 * unmatched rows any choice is a guess — so the guess is made visible rather
 * than made differently.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

const AUTH = 'src/lib/auth.ts';
const PAYMENTS = 'src/infrastructure/payments/service.ts';
const RESET = 'src/app/actions/password-reset.ts';
const ACTIONS_AUTH = 'src/app/actions/auth.ts';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function code(rel: string): string {
    return source(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

interface Doc { id: string; data: () => Record<string, unknown> }

const doc = (id: string, data: Record<string, unknown> = {}): Doc => ({ id, data: () => data });

/**
 * The resolution the login path performs, lifted out so it can be exercised.
 * Pinned to the original by "the rule the login path actually runs" below.
 */
function resolveProfile(docs: Doc[], authedId: string): Doc | undefined {
    return docs.find((d) => d.id === authedId)
        ?? docs.find((d) => d.data()?._migratedTo === authedId)
        ?? docs.find((d) => d.data()?.supabaseAuthId === authedId)
        ?? docs[0];
}

function identifiesItself(docs: Doc[], authedId: string): boolean {
    return docs.some((d) =>
        d.id === authedId
        || d.data()?._migratedTo === authedId
        || d.data()?.supabaseAuthId === authedId);
}

const AUTHED = 'supabase-uuid-of-the-caller';
const OTHER = 'supabase-uuid-of-somebody-else';

describe('the profile chosen is the one that identifies itself with the caller', () => {
    it('by document id', () => {
        const docs = [doc('legacy-firebase-uid'), doc(AUTHED)];
        expect(resolveProfile(docs, AUTHED)!.id).toBe(AUTHED);
    });

    it('by _migratedTo', () => {
        const docs = [doc('unrelated'), doc('legacy', { _migratedTo: AUTHED })];
        expect(resolveProfile(docs, AUTHED)!.id).toBe('legacy');
    });

    it('by supabaseAuthId — the tier that was missing', () => {
        // THE test. Before this, a legacy profile linked by the field the JIT
        // migration actually writes was not recognised at all.
        const docs = [doc('unrelated'), doc('legacy', { supabaseAuthId: AUTHED })];
        expect(resolveProfile(docs, AUTHED)!.id).toBe('legacy');
    });

    it('in that order, id beating _migratedTo beating supabaseAuthId', () => {
        const docs = [
            doc('by-supabase-auth-id', { supabaseAuthId: AUTHED }),
            doc('by-migrated-to', { _migratedTo: AUTHED }),
            doc(AUTHED),
        ];
        expect(resolveProfile(docs, AUTHED)!.id).toBe(AUTHED);
        expect(resolveProfile(docs.slice(0, 2), AUTHED)!.id).toBe('by-migrated-to');
        expect(resolveProfile(docs.slice(0, 1), AUTHED)!.id).toBe('by-supabase-auth-id');
    });

    it('which is the order the rest of the platform already resolves in', () => {
        // Vacuity guard: this is not an order invented here.
        const payments = code(PAYMENTS);
        const migratedAt = payments.indexOf('activeUserId = userData._migratedTo;');
        const supabaseAt = payments.indexOf('activeUserId = userData.supabaseAuthId;');

        expect(migratedAt).toBeGreaterThan(-1);
        expect(supabaseAt).toBeGreaterThan(migratedAt);

        // And the field really is written and read elsewhere, so consulting it
        // is using the platform's own link rather than inventing one.
        expect(code(ACTIONS_AUTH)).toContain('supabaseAuthId: newUser.user.id,');
        expect(code(RESET)).toContain('profile.data()?.supabaseAuthId');
    });
});

describe('a row carrying an unrelated migration pointer is no longer preferred', () => {
    it('so the caller is not handed somebody else\'s account', () => {
        // THE second test, and the sharp one. The old rule preferred the row
        // with ANY _migratedTo over the first row, and the code below then
        // adopts that pointer as the session id — issuing a session for OTHER.
        const docs = [
            doc('plain-profile'),
            doc('stale-legacy-row', { _migratedTo: OTHER }),
        ];

        expect(resolveProfile(docs, AUTHED)!.id).toBe('plain-profile');
        expect(resolveProfile(docs, AUTHED)!.data()._migratedTo).toBeUndefined();
    });

    it('and the old rule really would have picked it, so this is not a no-op', () => {
        // The removed branch, reconstructed. Without this the assertion above
        // proves only that the new rule works, not that the old one differed.
        const docs = [
            doc('plain-profile'),
            doc('stale-legacy-row', { _migratedTo: OTHER }),
        ];
        const oldRule = docs.find((d) => d.id === AUTHED)
            ?? docs.find((d) => d.data()?._migratedTo === AUTHED)
            ?? docs.find((d) => !!d.data()?._migratedTo)   // the branch that is gone
            ?? docs[0];

        expect(oldRule.id).toBe('stale-legacy-row');
        expect(oldRule.data()._migratedTo).toBe(OTHER);
    });

    it('and the branch is gone from the source, not merely reordered', () => {
        expect(code(AUTH)).not.toContain('anyMigratedMatch');
        expect(code(AUTH)).not.toContain('userSnap.docs.find(doc => !!doc.data()?._migratedTo)');
    });
});

describe('an unmatched pick is arbitrary, and says so', () => {
    it('the first row is still the last resort', () => {
        // Deliberately unchanged. With one row it is the only answer; with
        // several unmatched rows any choice is a guess.
        const docs = [doc('first'), doc('second')];
        expect(resolveProfile(docs, AUTHED)!.id).toBe('first');
    });

    it('but nothing identifying the caller is then present', () => {
        expect(identifiesItself([doc('first'), doc('second')], AUTHED)).toBe(false);
    });

    it('and any real match suppresses the warning', () => {
        expect(identifiesItself([doc(AUTHED)], AUTHED)).toBe(true);
        expect(identifiesItself([doc('x', { _migratedTo: AUTHED })], AUTHED)).toBe(true);
        expect(identifiesItself([doc('x', { supabaseAuthId: AUTHED })], AUTHED)).toBe(true);
    });

    it('with the source logging it as an error rather than swallowing it', () => {
        const auth = code(AUTH);

        expect(auth).toContain('No profile identifies itself with the authenticated account.');
        expect(auth).toContain('logger.error(');
    });
});

describe('the rule the login path actually runs', () => {
    const auth = code(AUTH);

    it('is the one exercised above', () => {
        // Pins the copy to the original.
        expect(auth).toContain('const authedId = sbData.user.id;');
        expect(auth).toContain('userSnap.docs.find(doc => doc.id === authedId)');
        expect(auth).toContain('?? userSnap.docs.find(doc => doc.data()?._migratedTo === authedId)');
        expect(auth).toContain('?? userSnap.docs.find(doc => doc.data()?.supabaseAuthId === authedId)');
        expect(auth).toContain('?? userSnap.docs[0];');
    });

    it('and the session id still follows a matching migration pointer', () => {
        // Unchanged, and correct: when _migratedTo names the authenticated
        // account, that IS the id the session should carry.
        expect(auth).toContain('if (matchedData._migratedTo) {');
        expect(auth).toContain('uid = matchedData._migratedTo;');
    });
});
