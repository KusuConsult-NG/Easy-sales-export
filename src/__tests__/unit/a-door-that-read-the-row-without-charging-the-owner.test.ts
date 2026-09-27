/**
 * @jest-environment node
 */

/**
 *   #962 THIRTEEN DOORS STOPPED JUDGING A TWO-MINUTE-OLD CLAIM, AND ONE OF THEM
 *        DID IT WITHOUT CHARGING THE MEMBER A DATABASE READ.
 *
 *   The owner's decision, asked and answered: read the row, keep isAdmin()'s ten
 *   roles. So `support` and `moderator` lose nothing — which is what makes this a
 *   security fix rather than a width change, and what dissolved a question this
 *   audit had put to the owner three times without needing to.
 *
 *   What it fixes: `session.user.roles` is minted at sign-in and refreshed on a
 *   two-minute cycle, so a REVOKED administrator kept these thirteen actions for
 *   up to two minutes after the revocation. #951's rule, applied where it was
 *   still outstanding.
 *
 * ── THE PART THAT IS MEASURED HERE RATHER THAN REASONED ABOUT ───────────────
 *
 *   stale-authorisation's OWNER_OR_ADMIN_SHAPE records why the owner-or-admin
 *   gates cannot take a naive conversion: "the live read has to sit inside the
 *   non-owner branch, or every member pays a database read to act on their own
 *   row and is then refused for not being an admin."
 *
 *   _loans_applications.ts:337 is one of those, and it converted by plain
 *   substitution:
 *
 *       session.user.id !== userId && !isAdmin(await liveRolesForDoor(...))
 *
 *   `&&` short-circuits, so the read is never reached when the caller IS the
 *   owner. That is the right behaviour, and it arrived by accident of JavaScript
 *   rather than by design — which is exactly the kind of claim that deserves a
 *   measurement instead of a comment. So this suite COUNTS THE READS: one for a
 *   stranger, zero for the owner.
 *
 *   If somebody later rewrites that condition — hoists the roles above the
 *   ownership test for readability, say — the count goes to one and this fails.
 *   Nothing else in the codebase would notice.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const OWNER = 'uid-the-member-whose-list-it-is';
const STRANGER = 'uid-somebody-else';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
/**
 * The same file with comments removed.
 *
 *   #962 — the first draft counted `isAdmin(session` in the raw source and found
 *   one in _loans_applications.ts:796, inside a comment quoting the shape this
 *   batch removed. Prose is not evidence, and a ratchet that counts it fails on
 *   a file that DESCRIBES the defect as loudly as one that has it.
 */
const code = (rel: string) => stripComments(read(rel), { minRetainedRatio: 0, label: rel });

/**
 * Drive getUserLoanApplicationsAction and count how many times the door read a row.
 *
 * The count is taken at `readUserDocOnce`, the seam liveRolesForDoor goes
 * through, because that is where a read costs a round trip.
 */
async function readsFor(
    { caller, subject, roles }: { caller: string; subject: string; roles: string[] },
): Promise<{ reads: number }> {
    jest.resetModules();

    let reads = 0;
    jest.doMock('@/lib/current-user-doc', () => ({
        readUserDocOnce: jest.fn(async (userId: string) => {
            reads += 1;
            return { exists: true, data: { id: userId, roles } };
        }),
        forgetUserDoc: jest.fn(),
    }));

    jest.doMock('@/lib/session-guard', () => ({
        requireSession: async () => ({
            session: { user: { id: caller, email: 'c@e.com', roles: [] } },
            error: null,
        }),
    }));

    const { installFakeDb } = require('@/lib/testing/fake-db');
    installFakeDb();

    const mod = await import('@/app/actions/cooperative/_loans_applications');
    const action = (mod as Record<string, unknown>).getUserLoanApplicationsAction as
        undefined | ((id: string) => Promise<unknown>);

    //   Named rather than assumed: if the export is renamed this must fail
    //   loudly rather than silently measure nothing.
    expect(typeof action).toBe('function');
    await action!(subject);

    return { reads };
}

beforeEach(() => {
    jest.clearAllMocks();
});

afterEach(() => {
    jest.resetModules();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#962 — the owner-or-admin door reads the row only when it must', () => {
    it('A MEMBER READING THEIR OWN LIST COSTS ZERO ROLE READS', async () => {
        /*
         *   The property OWNER_OR_ADMIN_SHAPE exists to protect. Every member of
         *   this platform hits this path for their own applications; a read here
         *   would be a round trip added to an ordinary member's page, to answer a
         *   question about admin rights that does not arise.
         */
        const { reads } = await readsFor({
            caller: OWNER, subject: OWNER, roles: ['general_user'],
        });

        expect({ reads }).toEqual({ reads: 0 });
    });

    it('AND A STRANGER ASKING ABOUT SOMEBODY ELSE COSTS EXACTLY ONE', async () => {
        /*
         *   The positive control, and it is what makes the zero above mean
         *   something: if the door never read at all, both numbers would be zero
         *   and the first test would pass over a door that trusts the token.
         */
        const { reads } = await readsFor({
            caller: STRANGER, subject: OWNER, roles: ['general_user'],
        });

        expect({ reads }).toEqual({ reads: 1 });
    });

    it('AND AN ADMIN STRANGER IS ADMITTED ON THE ROW, not on their token', async () => {
        //   The token in every case above carries `roles: []`. This one is
        //   admitted, so the admission can only have come from the row.
        const { reads } = await readsFor({
            caller: STRANGER, subject: OWNER, roles: ['super_admin'],
        });

        expect({ reads }).toEqual({ reads: 1 });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#962 — and the thirteen converted gates all judge the row', () => {
    const CONVERTED = [
        ['src/app/actions/export-admin.ts', 5],
        ['src/app/actions/admin/_marketplace.ts', 4],
        ['src/app/actions/cooperative/_loans_applications.ts', 4],
    ] as const;

    it('EACH FILE HAS THE COUNT THIS BATCH CONVERTED, AND NO TOKEN GATE LEFT', () => {
        for (const [rel, expected] of CONVERTED) {
            const src = code(rel);

            const live = [...src.matchAll(/isAdmin\(await liveRolesForDoor\(/g)].length;
            expect({ rel, live }).toEqual({ rel, live: expected });

            /*
             *   And none of the old shape survives in the same file. A partial
             *   conversion is the worst outcome: it reads as done and leaves a
             *   door on the token beside twelve that are not.
             */
            const token = [...src.matchAll(/isAdmin\(session[?.]/g)].length;
            expect({ rel, token }).toEqual({ rel, token: 0 });
        }
    });

    it('AND THE WIDTH IS UNCHANGED — still isAdmin, never a named permission', () => {
        /*
         *   THE ASSERTION THAT PROTECTS THE OWNER'S ACTUAL DECISION. They chose
         *   "live read, keep all ten roles" over "live read AND narrow", because
         *   narrowing drops `support` and `moderator` from doors whose permission
         *   they do not hold — staff losing access to work they do today.
         *
         *   requireAdmin("some:permission") is how that narrowing would arrive,
         *   and it would look like an improvement in a diff. Asserting its
         *   absence in these files is what makes the decision stick.
         */
        for (const [rel] of CONVERTED) {
            const src = code(rel);

            expect({ rel, narrowed: /requireAdmin\(\s*["']/.test(src) })
                .toEqual({ rel, narrowed: false });
        }
    });
});
