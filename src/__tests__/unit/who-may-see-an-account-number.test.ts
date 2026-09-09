/**
 * @jest-environment node
 */

/**
 *   #535 THE DECISION THAT REVEALS A MEMBER'S ACCOUNT NUMBER AND ID PAPERS IS
 *        MADE SIXTEEN TIMES, AND FOURTEEN OF THEM ASKED THE TOKEN.
 *
 *   Sixteen admin lists hydrate a seller's, borrower's, applicant's or
 *   withdrawer's bank details — and at four of them the URLs of their ID card
 *   and business certificate, and their hashed BVN and NIN — behind one
 *   expression:
 *
 *       const maySee… = hasAdminPermission(<roles>, "<permission>");
 *
 *   Measured across the tree, <roles> was resolved four different ways:
 *
 *     _withdrawals.ts        gate.roles          live   (#532)
 *     _escrow_actions.ts     callerDoc.roles     live
 *     _coop_admin_money.ts   `roles`             LOOKS live, is not
 *     _coop_admin_members.ts `roles`             LOOKS live, is not
 *     ...and twelve more     session.user.roles  the JWT claim
 *
 *   #356 established that the JWT claim keeps its value for hours after the
 *   database loses it. So on fourteen of these sixteen screens, "may this person
 *   see every member's account number, ID card and BVN" was answered by a token,
 *   and a just-revoked admin kept seeing them until their session rolled over.
 *
 * ── THE TWO THAT LOOK LIVE AND ARE NOT ──────────────────────────────────────
 *
 *       let roles = session.user.roles;
 *       if (!isAdmin(roles)) { ...read the live roles... }
 *
 *   _coop_admin_money and _coop_admin_members both did this and both commented
 *   that "`roles` above is the LIVE set this action already resolves". It is
 *   not: the database is consulted ONLY when the token is too NARROW. When the
 *   token already claims admin — the ordinary case, and the revoked-admin case
 *   the pattern exists for — the roles are the token's, unread. The fallback can
 *   enlarge a too-small claim and can never shrink a too-large one. Both
 *   comments are corrected rather than deleted.
 *
 * ── WHY THIS IS NOT #532 AGAIN ──────────────────────────────────────────────
 *
 *   #532 converted GATES — who may call an action — and deliberately stopped at
 *   the three files that contradicted themselves, leaving 88 measured and
 *   capped. This is a different question: what the RESPONSE may contain. On
 *   these screens the two answers are meant to differ — every admin role may
 *   open the withdrawal queue, and only the roles that can pay one out may see
 *   where the money would go.
 *
 *   SO THIS DOES NOT MAKE THOSE FOURTEEN SCREENS SAFE AGAINST A STALE TOKEN.
 *   Their own gates are untouched and still among the 88. It makes the most
 *   sensitive FIELDS on them safe, and says so rather than implying more.
 *
 *   A mechanical sweep of all 35 gates in those files was attempted and
 *   abandoned: the shapes vary — compound conditions, optional chaining, a
 *   second session variable, single-line returns — and a regex rewriting 35
 *   heterogeneous gates on live money and PII paths is the change most likely to
 *   break the thing the owner's brief says must not break.
 *
 * ── FAILING CLOSED ──────────────────────────────────────────────────────────
 *
 *   Every refusal answers false: unauthenticated, no profile, suspended, banned,
 *   not an admin, or a read that threw. A list without account numbers is a
 *   working screen; one that shows them because a lookup failed is the defect.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the rule back on the session roles              KILLED
 *     the rule answering true on a failed read        KILLED
 *     the permission argument ignored                 KILLED
 *     one call site reverted to the token             KILLED
 *     the suspended check dropped                     KILLED
 *     reword this header                              SURVIVED, as intended
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { auth } from '@/lib/auth';

const ROOT = process.cwd();
const code = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf-8'), { label: p });

const RULE = 'src/lib/member-pii-visibility.ts';

/** Every file that decides whether a member's sensitive fields are returned. */
const DECIDERS = [
    'src/app/actions/academy/_ac_admin_applications.ts',
    'src/app/actions/academy/_ac_admin_reports.ts',
    'src/app/actions/admin/_exports.ts',
    'src/app/actions/admin/_marketplace.ts',
    'src/app/actions/admin/_users.ts',
    'src/app/actions/cooperative/_coop_admin_members.ts',
    'src/app/actions/cooperative/_coop_admin_money.ts',
    'src/app/actions/cooperative/_loans_applications.ts',
    'src/app/actions/farm-nation-admin/_fna_finance.ts',
    'src/app/actions/farm-nation-admin/_fna_registrants.ts',
    'src/app/actions/wave/_wv_admin_applications.ts',
    'src/app/actions/wave/_wv_admin_withdrawals.ts',
    'src/app/api/admin/marketplace/seller-verifications/route.ts',
];

/** The two that already read the database, each in its own way. */
const ALREADY_LIVE = [
    'src/app/actions/admin/_withdrawals.ts',
    'src/app/actions/marketplace/_escrow_actions.ts',
];

let store: FakeDbHandle;
const BOSS = 'boss-1';

function actAs(id: string | null, tokenRoles: string[], recordRoles: string[] | null): void {
    (auth as unknown as jest.Mock).mockImplementation(() => Promise.resolve(
        id === null ? null : { user: { id, roles: tokenRoles, email: `${id}@e.com` } },
    ));
    if (id !== null && recordRoles !== null) {
        store.seed(COLLECTIONS.USERS, id, { roles: recordRoles, email: `${id}@e.com` });
    }
}

const mayReveal = async (permission: string) => {
    const { mayRevealMemberPii } = await import('@/lib/member-pii-visibility');
    return mayRevealMemberPii(permission as any);
};

beforeEach(() => {
    //   No resetModules: requireAdmin reads auth() from @/lib/auth and a fresh
    //   registry hands it a different copy of that mock than actAs configures.
    jest.clearAllMocks();
    store = installFakeDb();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#535 — the record decides, not the token', () => {
    it('A TOKEN CLAIMING super_admin DOES NOT REVEAL AN ACCOUNT NUMBER', async () => {
        //   THE test. The row says support; the token has not caught up.
        actAs(BOSS, ['super_admin'], ['support']);

        expect(await mayReveal('finance:process_withdrawals')).toBe(false);
    });

    it('AND A RECORD THAT STILL HOLDS THE PERMISSION DOES', async () => {
        //   The vacuity guard: a rule that answered false for everybody would
        //   satisfy the assertion above and empty every payout screen.
        actAs(BOSS, ['support'], ['admin']);

        expect(await mayReveal('finance:process_withdrawals')).toBe(true);
    });

    it('AND THE PERMISSION ASKED FOR IS THE ONE ANSWERED', async () => {
        //   A rule that ignored its argument would pass both tests above.
        actAs(BOSS, ['admin'], ['marketplace_admin']);

        expect(await mayReveal('marketplace:approve_sellers')).toBe(true);
        expect(await mayReveal('finance:process_withdrawals')).toBe(false);
    });

    it('AND A SUSPENDED ADMIN SEES NOTHING', async () => {
        //   requireAdmin checks this while it has the document, and the token
        //   never carried it at all.
        actAs(BOSS, ['super_admin'], null);
        store.seed(COLLECTIONS.USERS, BOSS, { roles: ['super_admin'], suspended: true });

        expect(await mayReveal('finance:process_withdrawals')).toBe(false);
    });

    it('AND AN UNAUTHENTICATED CALLER SEES NOTHING', async () => {
        actAs(null, [], null);

        expect(await mayReveal('finance:process_withdrawals')).toBe(false);
    });

    it('AND A CALLER WITH NO PROFILE ROW SEES NOTHING', async () => {
        //   Fails closed rather than falling back on the token, which is the
        //   whole point.
        actAs(BOSS, ['super_admin'], null);

        expect(await mayReveal('finance:process_withdrawals')).toBe(false);
    });

    it('and a failed read withholds rather than reveals', async () => {
        actAs(BOSS, ['super_admin'], ['super_admin']);
        (globalThis as any).mockFirestoreGet.mockImplementation(() => {
            throw new Error('users table is down');
        });

        expect(await mayReveal('finance:process_withdrawals')).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#535 — one rule, every screen that hands the fields over', () => {
    it('NO SCREEN DECIDES THIS FROM THE SESSION ROLES', () => {
        //   THE sweep. Derived from the tree rather than from the list above, so
        //   a seventeenth screen written next month fails here too.
        const offenders: string[] = [];
        const walk = (dir: string) => {
            for (const e of readdirSync(dir)) {
                const full = join(dir, e);
                if (statSync(full).isDirectory()) {
                    if (e !== '__tests__') walk(full);
                } else if (/\.tsx?$/.test(e)) {
                    const src = stripComments(readFileSync(full, 'utf-8'), { label: full });
                    if (/may(See|View|Reveal)\w*\s*=\s*hasAdminPermission\(\s*session/.test(src)) {
                        offenders.push(full.slice(ROOT.length + 1));
                    }
                }
            }
        };
        walk(join(ROOT, 'src'));

        expect(offenders).toEqual([]);
    });

    it('AND EVERY ONE OF THE THIRTEEN ASKS THE SHARED RULE', () => {
        for (const f of DECIDERS) {
            expect({ f, shared: code(f).includes('mayRevealMemberPii(') })
                .toEqual({ f, shared: true });
        }
    });

    it('AND THE TWO THAT ALREADY READ THE DATABASE STILL DO', () => {
        //   Left alone deliberately: each already has the live roles in hand
        //   from its own gate, so routing through the shared rule would read the
        //   same document a second time.
        expect(code(ALREADY_LIVE[0])).toContain('hasAdminPermission(gate.roles,');
        expect(code(ALREADY_LIVE[1])).toContain('hasAdminPermission(callerRoles,');
    });

    it('AND THE FILES READ ARE REAL', () => {
        //   #484's shape — a control that reads as present and is none.
        for (const f of [...DECIDERS, ...ALREADY_LIVE]) {
            expect(code(f).length).toBeGreaterThan(1000);
        }
    });

    it('and the two misleading comments are corrected, not deleted', () => {
        //   They asserted "`roles` above is the LIVE set this action already
        //   resolves", which the fallback shape made false. The record of the
        //   mistake is worth more than a tidy file.
        for (const f of ['src/app/actions/cooperative/_coop_admin_money.ts',
            'src/app/actions/cooperative/_coop_admin_members.ts']) {
            const raw = readFileSync(join(ROOT, f), 'utf-8');

            //   The old sentence still appears — QUOTED, inside the correction,
            //   which is the point. What must not survive is it standing on its
            //   own as a claim, so the check is positional: every occurrence
            //   comes after "USED TO SAY".
            //   Asserted in two pieces because the correction WRAPS across
            //   comment lines — "AND IT" ends one and "WAS NOT TRUE" opens the
            //   next, so the contiguous phrase does not exist in the file. The
            //   first version of this test looked for it and reported a defect
            //   in prose it had itself mis-quoted.
            expect(raw).toContain('USED TO SAY');
            expect(raw).toContain('WAS NOT TRUE');
            const quotedAt = raw.indexOf('USED TO SAY');
            const claimAt = raw.indexOf('check below inherits that');

            expect(quotedAt).toBeGreaterThan(-1);
            expect(claimAt).toBeGreaterThan(quotedAt);
            expect(raw.indexOf('check below inherits that', claimAt + 1)).toBe(-1);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#535 — the rule itself', () => {
    it('IT IS SERVER-ONLY', () => {
        //   It reads the caller's user document; a client bundle must not be
        //   able to import it. #382's class.
        expect(code(RULE)).toContain('import "server-only"');
    });

    it('AND IT FAILS CLOSED IN EVERY BRANCH', () => {
        const src = code(RULE);
        const fn = src.slice(src.indexOf('export async function mayRevealMemberPii'));

        expect(fn).toContain('if ("error" in live) return false;');
        expect(fn).toContain('return false;');
        expect(fn).not.toContain('return true;');
    });

    it('and liveAdminRoles is the gate module\'s own first four steps', () => {
        //   Not a second implementation of the admin check — the same document
        //   read, the same suspended/banned refusal, returning what it read.
        const src = code('src/lib/require-admin.ts');
        const fn = src.slice(src.indexOf('export async function liveAdminRoles'));

        expect(fn.slice(0, 400)).toContain('await requireAdmin()');
    });
});
