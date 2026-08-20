/**
 * @jest-environment node
 */

/**
 * Five readers adopted a membership on an email match. One of them checked.
 *
 * Every cooperative reader looks a membership up by userId, falls back to the
 * document id, and then falls back to the caller's EMAIL:
 *
 *   _dashboard.ts        getDashboardDataAction
 *   _coop_membership.ts  _getMembershipAction
 *   _coop_membership.ts  _checkCooperativeStatusAction
 *   _coop_identity.ts    getCooperativeMemberIdCardAction
 *   _coop_registration.ts  getCooperativeApplicationAction
 *
 * On a hit they do not merely READ the row: they write `userId` onto it,
 * binding that membership to the caller permanently, and return it as theirs —
 * savingsBalance, loanBalance, documents, BVN and NIN included.
 *
 * A MATCHING EMAIL IS NOT PROOF OF OWNERSHIP. The caller's address comes from
 * their own profile and profile.ts lets them change it, so a user could point
 * their address at an ORPHANED membership — a member who paid by form
 * submission and never completed registration, the exact case the
 * processed_payments fallback beneath these exists to handle — load any of
 * those five screens, and inherit that person's cooperative record. Supabase
 * enforces uniqueness among registered addresses, so the target has to be an
 * address no account holds; an orphaned membership is precisely that.
 *
 * getDashboardDataAction was hardened against this in an earlier pass. Its four
 * siblings were not — and the hole stayed fully open, because once any of them
 * bound the row, the dashboard's own check passed trivially on the `userId` it
 * had just written. _checkCooperativeStatusAction is the worst of the four: the
 * branch it feeds heals the USER document from the membership and grants the
 * cooperative_member role, so adopting a stranger's record granted module
 * access as well as visibility.
 *
 * The rule is one module now, and the dashboard's inline copy imports it too.
 */

import { describe, it, expect, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { mayClaimMembershipByEmail } from '@/lib/cooperative-membership-claim';

const DASHBOARD = 'src/app/actions/cooperative/_dashboard.ts';
const MEMBERSHIP = 'src/app/actions/cooperative/_coop_membership.ts';
const IDENTITY = 'src/app/actions/cooperative/_coop_identity.ts';
const REGISTRATION = 'src/app/actions/cooperative/_coop_registration.ts';
const ADMIN_MEMBERS = 'src/app/actions/cooperative/_coop_admin_members.ts';
const PROFILE = 'src/app/actions/profile.ts';

const READERS: Array<[string, string]> = [
    ['the dashboard', DASHBOARD],
    ['the membership reader', MEMBERSHIP],
    ['the ID card', IDENTITY],
    ['the application reader', REGISTRATION],
];

function code(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

/** One function's body, so a correct sibling in the same file cannot mask it. */
function fn(rel: string, name: string): string {
    const src = code(rel);
    const start = src.search(new RegExp(`(export )?(async )?function ${name}\\(`));
    expect(start).toBeGreaterThan(-1);
    const after = src.slice(start + 10);
    const end = after.search(/\n(export )?(async )?function /);
    return end > 0 ? after.slice(0, end) : after;
}

/** A stand-in for the adapter, so the rule is tested rather than observed. */
function fakeDb(paymentRows: Array<Record<string, any>>) {
    return {
        collection: () => ({
            where: () => ({
                limit: () => ({
                    get: async () => ({
                        empty: paymentRows.length === 0,
                        docs: paymentRows.map((r) => ({ data: () => r })),
                    }),
                }),
            }),
        }),
    };
}

describe('the claim rule', () => {
    it('admits a row that is already the caller\'s', async () => {
        const db = fakeDb([]);
        await expect(
            mayClaimMembershipByEmail(db, { data: { userId: 'me' }, id: 'm1' }, 'me'),
        ).resolves.toBe(true);
    });

    it('refuses a row that belongs to somebody else', async () => {
        // THE test. This is the takeover.
        const db = fakeDb([{ userId: 'me' }]);
        await expect(
            mayClaimMembershipByEmail(db, { data: { userId: 'someone-else', paymentReference: 'ref-1' }, id: 'm1' }, 'me'),
        ).resolves.toBe(false);
    });

    it('refuses an orphaned row with no payment recorded on it', async () => {
        const db = fakeDb([{ userId: 'me' }]);
        await expect(
            mayClaimMembershipByEmail(db, { data: { savingsBalance: 250_000 }, id: 'm1' }, 'me'),
        ).resolves.toBe(false);
    });

    it('refuses an orphaned row whose payment was made by another user', async () => {
        const db = fakeDb([{ userId: 'the-real-payer' }]);
        await expect(
            mayClaimMembershipByEmail(db, { data: { paymentReference: 'ref-1' }, id: 'm1' }, 'me'),
        ).resolves.toBe(false);
    });

    it('and admits one the caller actually paid for', async () => {
        // The legitimate case the fallback exists to serve: a member who paid by
        // form submission and never got a userId written onto their row.
        const db = fakeDb([{ userId: 'me' }]);
        await expect(
            mayClaimMembershipByEmail(db, { data: { paymentReference: 'ref-1' }, id: 'm1' }, 'me'),
        ).resolves.toBe(true);
    });

    it('refusing when no payment row matches the reference at all', async () => {
        const db = fakeDb([]);
        await expect(
            mayClaimMembershipByEmail(db, { data: { paymentReference: 'ref-1' }, id: 'm1' }, 'me'),
        ).resolves.toBe(false);
    });

    it('and on a row with no data', async () => {
        const db = fakeDb([{ userId: 'me' }]);
        await expect(mayClaimMembershipByEmail(db, { data: null, id: 'm1' }, 'me')).resolves.toBe(false);
        await expect(mayClaimMembershipByEmail(db, { data: undefined, id: 'm1' }, 'me')).resolves.toBe(false);
    });
});

describe('the premise: the caller controls the email being matched', () => {
    it('because a user can change their own profile email', async () => {
        // Without this, matching on email would be as good as matching on id.
        const profile = code(PROFILE);

        expect(profile).toMatch(/email/i);
    });
});

describe.each(READERS)('%s email fallback', (_label: string, rel: string) => {
    it('asks the shared rule before adopting the row', () => {
        // THE test.
        expect(code(rel)).toContain('mayClaimMembershipByEmail(');
    });

    it('and nothing binds the row between finding it and deciding', () => {
        // Anchored to the claim, not to the first email query in the file:
        // _coop_registration.ts has an unrelated `.where("email", ...)` — the
        // duplicate-email dedup guard — hundreds of lines earlier, and slicing
        // from that one swept in the docId fallback's own legitimate bind.
        const src = code(rel);
        const claimAt = src.indexOf('mayClaimMembershipByEmail(');
        expect(claimAt).toBeGreaterThan(-1);

        const emailAt = src.lastIndexOf('.where("email", "=="', claimAt);
        expect(emailAt).toBeGreaterThan(-1);

        const between = src.slice(emailAt, claimAt);
        expect(between).not.toMatch(/update\(\{ userId/);
    });
});

describe('the status reader is the one that granted a role', () => {
    it('so its fallback matters most', () => {
        // Vacuity guard: if the healing path did not write a role, adopting a
        // membership there would be a visibility bug rather than an access one.
        const membership = code(MEMBERSHIP);

        expect(membership).toContain('roles: FieldValue.arrayUnion("cooperative_member")');
        expect(membership).toContain('const needsUserDocHeal =');
    });

    it('and it now checks before adopting', () => {
        // PER FUNCTION, not per file. _coop_membership.ts holds TWO email
        // fallbacks — _getMembershipAction's and this one — so a file-level
        // "contains mayClaimMembershipByEmail" passed with this one's guard
        // removed entirely. The correct sibling masked the broken one.
        const status = fn(MEMBERSHIP, '_checkCooperativeStatusAction');

        expect(status).toContain('mayClaimMembershipByEmail(');

        const guard = status.indexOf('mayClaimMembershipByEmail(');
        const adopt = status.indexOf('memberDocData = emailQuery.docs[0].data();');

        expect(adopt).toBeGreaterThan(guard);
    });

    it('and so does the membership reader, in the same file', () => {
        const getMembership = fn(MEMBERSHIP, '_getMembershipAction');

        expect(getMembership).toContain('mayClaimMembershipByEmail(');
        expect(getMembership).toContain('if (!mayClaim) {');
    });
});

describe('the dashboard no longer keeps its own copy', () => {
    it('it imports the shared rule like the other four', () => {
        const dashboard = code(DASHBOARD);

        expect(dashboard).toContain('mayClaimMembershipByEmail(');
        expect(dashboard).not.toContain('let mayClaim = false;');
        expect(dashboard).not.toContain('mayClaim = true;');
    });
});

describe('the admin member readers no longer report a partial list as complete', () => {
    const admin = code(ADMIN_MEMBERS);

    it('getAllMembers stops claiming hasMore: false unconditionally', () => {
        expect(admin).not.toContain('meta: { hasMore: false, cursor: null }');
        expect(admin).toContain('const truncated = snapshot.docs.length >= fetchLimit;');
        expect(admin).toContain('the member list returned is INCOMPLETE');
    });

    it('and the filtered cohort reports when it hit its cap', () => {
        // Any search, date range, state, LGA, registry or gender sort switches
        // to in-memory pagination over 5,000 rows; _hasMore was computed purely
        // from what had been fetched, so the admin paged to the end of the cap
        // and was told there was no more.
        expect(admin).toContain('const cohortTruncated = useMemoryPagination && hasMoreRaw;');
        expect(admin).toContain('the list AND the stats beside it are INCOMPLETE');
        expect(admin).toContain('truncated: cohortTruncated,');
    });

    it('which is a real cap, not a hypothetical one', () => {
        // Vacuity guard.
        expect(admin).toContain('const fetchLimit = useMemoryPagination ? 5000 : limitCount;');
        expect(admin).toContain('hasMoreRaw = applications.length > fetchLimit;');
    });
});

describe('a membership document id is not a user id', () => {
    // The type said `id: string; // Document ID (User ID in this case)` and the
    // member loans page believed it, passing membership.id to
    // getUserLoanApplicationsAction — whose guard is
    // `session.user.id !== userId && !isAdmin`. When the two differ that guard
    // refuses and returns an empty list, so the member's own loans page showed
    // them nothing while their loan was live.
    const TYPES = 'src/lib/types/cooperative.ts';
    const MY_LOANS = 'src/app/cooperatives/(member)/my-loans/page.tsx';
    const APPLICATIONS = 'src/app/actions/cooperative/_loans_applications.ts';

    it('and they really can differ', () => {
        // THE premise: a membership created this way has an auto-generated id.
        const registration = code('src/app/actions/cooperative/_coop_registration.ts');

        expect(registration).toContain('const newMemberRef = membershipsRef.doc();');
    });

    it('so the type carries userId and no longer claims id is one', () => {
        const types = readFileSync(join(process.cwd(), TYPES), 'utf-8');

        expect(types).toContain('userId?: string;');
        expect(types).not.toContain('id: string; // Document ID (User ID in this case)');
    });

    it('and the loans page passes the member, not the row', () => {
        // THE test.
        const page = code(MY_LOANS);

        expect(page).toContain('membershipRecord.userId || membershipRecord.id');
        expect(page).not.toContain('getUserLoanApplicationsAction(result.data.membership.id)');
    });

    it('which matters because the action refuses a mismatch outright', () => {
        // Vacuity guard: if the action ignored the argument, passing the wrong
        // id would be harmless.
        const action = fn(APPLICATIONS, 'getUserLoanApplicationsAction');

        expect(action).toContain('session.user.id !== userId && !isAdmin(session.user.roles)');
        expect(action).toContain('return [];');
    });
});
