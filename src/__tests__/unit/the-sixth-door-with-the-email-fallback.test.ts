/**
 * @jest-environment node
 */

/**
 *   A CONTROL PRESENT IN FIVE DOORS OF SIX IS NOT A CONTROL.
 *
 *   lib/cooperative-membership-claim.ts opens by naming the readers that look
 *   a cooperative membership up by userId, fall back to the document id, and
 *   then fall back to the caller's EMAIL. It lists five, and every one of them
 *   is in src/app/actions/cooperative — because that hardening pass was scoped
 *   to that directory.
 *
 *   /cooperatives/onboarding is a SIXTH, and it did the whole thing:
 *
 *       email match  →  read the row  →  WRITE `userId` onto it  →  return it
 *
 *   In that module's own words: "A MATCHING EMAIL IS NOT PROOF OF OWNERSHIP.
 *   The caller's address comes from their own profile, and profile.ts lets
 *   them change it." The reachable target is an ORPHANED membership — somebody
 *   who paid and never finished registering — because Supabase enforces
 *   uniqueness among registered addresses, so the address has to be one no
 *   account currently holds. The heal then binds it permanently, with
 *   savingsBalance, loanBalance, documents, BVN and NIN attached.
 *
 *   And once any one door binds the row, the others pass trivially, because
 *   `userId` now matches. Which is why the count mattered: it was one of six,
 *   not one of five.
 *
 *   THE FOURTH TIME IN THIS SWEEP THE SCOPE WAS THE DEFECT.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { stripComments } from '@/lib/testing/strip-comments';

//   The page renders a client component, which jest cannot parse as ESM. The
//   subject here is the server half — which membership row the page resolves
//   and whether it writes to one — so the client is a stub.
jest.mock('@/app/cooperatives/onboarding/OnboardingClient', () => ({
    __esModule: true,
    default: () => null,
}));

//   The page reads request headers before it reaches the membership logic,
//   and `headers()` throws outside a request scope.
jest.mock('next/headers', () => ({
    headers: async () => new Map<string, string>(),
    cookies: async () => ({ get: () => undefined }),
}));
import { COLLECTIONS } from '@/lib/types/firestore';

const OLD = 'a-superseded-member';
const LIVE = 'b-live-member';
const ATTACKER = 'c-another-account';

const SHARED_EMAIL = 'orphan@example.com';

let store: FakeDbHandle;

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    store.seed(COLLECTIONS.USERS, LIVE, { email: 'member@example.com' });
    store.seed(COLLECTIONS.USERS, OLD, { email: 'member@example.com', _migratedTo: LIVE });
    store.seed(COLLECTIONS.USERS, ATTACKER, { email: SHARED_EMAIL });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the claim gate asks about the person, not the string', () => {
    const gate = async (rowUserId: string | undefined, caller: string) => {
        const { mayClaimMembershipByEmail } =
            await import('@/lib/cooperative-membership-claim');
        const { supabaseDb } = await import('@/lib/supabase-db');
        return await mayClaimMembershipByEmail(
            supabaseDb,
            { data: { userId: rowUserId, savingsBalance: 50_000 }, id: 'm-1' },
            caller,
        );
    };

    it('THE test — a row carrying the caller\'s OWN superseded id is already theirs', async () => {
        //   `===` refused this and logged the member as "owned by another
        //   user". It is their own record.
        expect(await gate(OLD, LIVE)).toBe(true);
    });

    it('and the live id matches itself, as it always did', async () => {
        expect(await gate(LIVE, LIVE)).toBe(true);
    });

    it("VACUITY CONTROL: another person's row is still never claimable", async () => {
        //   The whole point of the gate. isSamePerson must widen to the
        //   caller's own profiles and no further.
        expect(await gate(ATTACKER, LIVE)).toBe(false);
    });

    it('VACUITY CONTROL: and an ORPHANED row is not claimable without payment', async () => {
        //   No userId at all is the reachable case, and it stays gated on a
        //   completed registration payment tying the row to the caller's money.
        expect(await gate(undefined, LIVE)).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 *   THE ONBOARDING PAGE IS NOT DRIVEN HERE, AND THAT IS RECORDED RATHER THAN
 *   PAPERED OVER.
 *
 *   Three tests stood here that rendered the page and asserted it had not
 *   written `userId` onto an orphaned membership. All three passed. All three
 *   also passed with the gate replaced by `if (true)` — the mutation run is
 *   the only reason that is known.
 *
 *   The page is a server component that reads request headers, renders a
 *   client component, and wraps its whole membership lookup in a try/catch
 *   that logs and continues. Mocking the first two got further; the third
 *   means any failure inside the lookup — including never reaching it —
 *   is indistinguishable from the lookup deciding not to write. So an
 *   assertion of the form "nothing was written" is satisfied by the code
 *   never running, which is exactly the shape of a test that certifies
 *   nothing.
 *
 *   A precondition test was added to catch that (drive the CLAIMABLE case and
 *   require that it IS bound, proving the path is reached). It could not be
 *   made to pass either, which settled it: the page cannot be driven from a
 *   unit test without a request scope.
 *
 *   WHAT COVERS THE FIX INSTEAD, and it is not nothing:
 *
 *     - mayClaimMembershipByEmail is driven directly above, including the
 *       superseded-id case the `===` comparison refused. That mutant dies.
 *     - the tree-wide invariant below fails the day any caller-facing door
 *       matches a membership on email without reaching for the gate, which is
 *       the defect class rather than this one instance of it.
 *
 *   What is NOT covered is the wiring in the page itself. Said plainly so
 *   nobody reads this file as proof of something it does not show.
 */

describe('and the member walk is the shared one everywhere', () => {
    it('EVERY CALLER-FACING door that matches a membership on EMAIL is gated', () => {
        /*
         *   The invariant the claim module exists for, asserted over the whole
         *   TREE rather than one directory — which is the mistake that left
         *   the onboarding page off its list of five and module-access-check
         *   off it entirely.
         *
         *   NOT EVERY EMAIL MATCH IS A CLAIM, and a test that said so would be
         *   wrong rather than strict. An admin searching members by address,
         *   and the forensics tooling that finds duplicate accounts, look a
         *   membership up by email as their whole purpose — they are not a
         *   caller asserting the row is theirs. Those are listed by name, so
         *   the list is a record of what IS and a NEW ungated door fails here
         *   on the day it is written, wherever it is put.
         */
        const { execSync } = require('child_process');
        const { readFileSync } = require('fs');

        /** Email matchers that are an ADMIN or TOOLING lookup, not a claim. */
        const NOT_A_CLAIM = [
            //   Admin surfaces: the operator is searching, and the row they
            //   find is never bound to them.
            'src/app/actions/admin/_legacy.ts',
            'src/app/actions/cooperative/_coop_admin_members.ts',
            'src/app/api/admin/verify-id/lookup/route.ts',
            //   #724's duplicate-profile forensics: finding two records for
            //   one person by address is the entire job.
            'src/app/actions/forensics.ts',
            //   Messaging resolves a recipient, and writes nothing onto the
            //   membership it finds.
            'src/app/actions/messages.ts',
        ];

        const matchers = execSync(
            `grep -rl 'COLLECTIONS.COOPERATIVE_MEMBERS' src --include=*.ts --include=*.tsx `
            + `| xargs grep -l 'where("email", "=="' || true`,
            { encoding: 'utf8' },
        ).trim().split('\n').filter(Boolean)
            .filter((f: string) => !f.includes('__tests__'));

        //   STRIPPED, BECAUSE PROSE IS NOT A CALL. Every one of these files
        //   now carries a comment explaining the gate, and `includes` on the
        //   raw source is satisfied by that alone — a mutation run proved it,
        //   by deleting the import and the call from the onboarding page and
        //   passing this test on the strength of the paragraph above them.
        const ungated = matchers
            .filter((f: string) => !NOT_A_CLAIM.includes(f))
            .filter((f: string) => !stripComments(readFileSync(f, 'utf-8'))
                .includes('mayClaimMembershipByEmail'));

        expect({ found: matchers.length, ungated }).toEqual({
            found: matchers.length, ungated: [],
        });
    });

    it('VACUITY GUARD: a mention in a COMMENT does not satisfy the gate check', () => {
        //   The exact hole the mutation run found.
        const commentOnly = '// see mayClaimMembershipByEmail for why\nconst x = 1;';

        expect(commentOnly).toContain('mayClaimMembershipByEmail');
        expect(stripComments(commentOnly)).not.toContain('mayClaimMembershipByEmail');
    });

    it('VACUITY GUARD: the scan finds the doors, and the allow-list is not a blanket', () => {
        //   Two ways this could pass for nothing: the grep matching no files,
        //   or NOT_A_CLAIM having grown to cover everything. Both pinned.
        const { execSync } = require('child_process');
        const matchers = execSync(
            `grep -rl 'COLLECTIONS.COOPERATIVE_MEMBERS' src --include=*.ts --include=*.tsx `
            + `| xargs grep -l 'where("email", "=="' || true`,
            { encoding: 'utf8' },
        ).trim().split('\n').filter(Boolean)
            .filter((f: string) => !f.includes('__tests__'));

        expect(matchers).toContain('src/app/cooperatives/onboarding/page.tsx');
        expect(matchers).toContain('src/lib/module-access-check.ts');
        //   And those two are gated rather than excused.
        const { readFileSync } = require('fs');
        for (const f of ['src/app/cooperatives/onboarding/page.tsx', 'src/lib/module-access-check.ts']) {
            expect(stripComments(readFileSync(f, 'utf-8'))).toContain('mayClaimMembershipByEmail');
        }
    });
});
