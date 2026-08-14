/**
 * @jest-environment node
 */

/**
 * The cooperative action surface, pinned across the split of _actions.ts.
 *
 * WHAT HAPPENED
 * -------------
 * src/app/actions/cooperative/_actions.ts was 2,380 lines, third-largest after
 * admin.ts (#202) and marketplace/_actions.ts (#203). It is now four files
 * behind the barrel that was already there:
 *
 *     _coop_registration.ts   689
 *     _coop_money.ts          661
 *     _coop_identity.ts       580
 *     _coop_membership.ts     375
 *
 * THIS ONE DID NOT SPLIT CLEANLY, UNLIKE THE FIRST TWO
 * ----------------------------------------------------
 * admin.ts and marketplace/_actions.ts had no calls between their private
 * implementations. This file had four:
 *
 *     autoProvisionZereCooperative      <- initiateCooperativePayment,
 *                                          getMembership, checkCooperativeStatus
 *     autoProvisionLegacyCooperative    <- getMembership
 *     registerCooperativeMemberAction   <- checkCooperativeStatus
 *     validateCooperativeInviteAction   <- registerCooperativeMember
 *
 * The last two are already exported actions, so a sibling file importing them
 * changes nothing. The first two were the problem, and the resolution is the
 * point of this test.
 *
 * WHY THE PROVISIONING HELPERS LEFT THE ACTIONS TREE
 * --------------------------------------------------
 * Sharing them between domain files would have meant exporting them — and
 * every export of a "use server" module is a callable endpoint.
 *
 * Their signatures are (userId, email) and (userId, userData). What they do is
 * write a cooperative membership with membershipStatus "approved" and
 * paymentStatus "completed". Exporting them would have published "provision a
 * paid membership for an arbitrary user id" as an RPC whose only gate is an
 * email address the caller would be supplying.
 *
 * So they went to @/lib/cooperative-provisioning, a plain module a client
 * cannot call. The alternative — a _shared.ts beside the actions — is what
 * admin.ts's split first tried, and it fails this repository's own rule that
 * everything under src/app/actions carries "use server".
 *
 * bypass-email-claim.test.ts, which asserts what the payment bypass grants, now
 * reads that module. The guard it checks is unchanged and still the first line.
 */

import { describe, it, expect } from '@jest/globals';

/** _actions.ts's exports at dd89576f, the commit before the split. */
const EXPECTED_ACTIONS = [
    'applyForLoanAction',
    'checkCooperativeStatusAction',
    'createFixedSavingsAction',
    'getCooperativeApplicationAction',
    'getCooperativeMemberIdCardAction',
    'getDirectoryMembersAction',
    'getMembershipAction',
    'getTransactionsAction',
    'getUserTierAction',
    'initiateCooperativePaymentAction',
    'joinCooperativeAction',
    'makeContributionAction',
    'registerCooperativeMemberAction',
    'resubmitCooperativeApplicationAction',
    'submitWithdrawalAction',
    'updateMemberProfileDetailsAction',
    'updatePassportPhotoAction',
    'validateCooperativeInviteAction',
].sort();

describe('the cooperative barrel exports what _actions.ts exported', () => {
    it('every action is still reachable at @/app/actions/cooperative', async () => {
        const mod: Record<string, unknown> = await import('@/app/actions/cooperative');

        const missing = EXPECTED_ACTIONS.filter((name) => !(name in mod));

        expect(missing).toEqual([]);
    });

    it('and each one is callable', async () => {
        // Vacuity guard: `name in mod` passes for a name exported as undefined.
        const mod: Record<string, unknown> = await import('@/app/actions/cooperative');

        const notFunctions = EXPECTED_ACTIONS.filter((name) => typeof mod[name] !== 'function');

        expect(notFunctions).toEqual([]);
    });

    it('the count is the 18 the old file had', () => {
        expect(EXPECTED_ACTIONS).toHaveLength(18);
    });
});

describe('provisioning a paid membership is not an endpoint', () => {
    function read(rel: string): string {
        const { readFileSync } = require('fs');
        const { join } = require('path');
        return readFileSync(join(process.cwd(), rel), 'utf-8');
    }

    it('the helpers live in a module with no "use server" DIRECTIVE', () => {
        // THE test for this split. With the directive, both exports below
        // become callable from a browser.
        //
        // Asserted on code rather than on the file: the header comment explains
        // why the directive is absent, and quotes it to do so. A substring
        // check matched the explanation and failed — which is the same trap
        // this suite's other assertions have to avoid.
        const code = read('src/lib/cooperative-provisioning.ts')
            .split('\n')
            .filter((l: string) => {
                const t = l.trim();
                return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
            })
            .join('\n');

        expect(code).not.toContain('use server');
    });

    it('and they are the ones that grant the membership', () => {
        // Vacuity guard: the assertion above is worthless if this file is not
        // the thing that does the granting.
        const lib = read('src/lib/cooperative-provisioning.ts');

        expect(lib).toContain('export async function autoProvisionZereCooperative');
        expect(lib).toContain('export async function autoProvisionLegacyCooperative');
        expect(lib).toContain('membershipStatus: "approved"');
        expect(lib).toContain('paymentStatus: "completed"');
    });

    it('the bypass guard is still the first thing either one does', () => {
        const lib = read('src/lib/cooperative-provisioning.ts');

        expect(lib).toContain('if (!isPaymentBypassAccount(email)) return');
    });

    it('no action file re-exports them', () => {
        // The route back to an endpoint is a domain file deciding to forward
        // them. It would type-check and it would be wrong.
        for (const file of [
            '_coop_registration.ts',
            '_coop_membership.ts',
            '_coop_money.ts',
            '_coop_identity.ts',
        ]) {
            const src = read(`src/app/actions/cooperative/${file}`);
            expect(`${file}: ${/export\s*\{[^}]*autoProvision/.test(src)}`).toBe(`${file}: false`);
        }
    });
});

describe('the domain files keep the shape the audits expect', () => {
    const DOMAIN_FILES = [
        '_coop_registration.ts',
        '_coop_membership.ts',
        '_coop_money.ts',
        '_coop_identity.ts',
    ];

    function read(name: string): string {
        const { readFileSync } = require('fs');
        const { join } = require('path');
        return readFileSync(join(process.cwd(), 'src/app/actions/cooperative', name), 'utf-8');
    }

    it('"use server" is the first line of each', () => {
        for (const file of DOMAIN_FILES) {
            const first = read(file).split('\n')[0].trim();
            expect(`${file}: ${first}`).toBe(`${file}: "use server";`);
        }
    });

    it('each guards its own actions', () => {
        for (const file of DOMAIN_FILES) {
            const src = read(file);
            const guarded =
                src.includes('requireSession') || src.includes('requireAdmin') || src.includes('auth()');
            expect(`${file}: ${guarded}`).toBe(`${file}: true`);
        }
    });

    it('the old file is gone', () => {
        const { existsSync } = require('fs');
        const { join } = require('path');

        expect(existsSync(join(process.cwd(), 'src/app/actions/cooperative/_actions.ts'))).toBe(false);
    });
});
