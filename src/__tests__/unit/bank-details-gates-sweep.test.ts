/**
 * @jest-environment node
 */

/**
 * #151 — the sweep. One defect, found six times, one file at a time.
 *
 * THE SHAPE
 * ---------
 * A list action returns somebody's account number, account name and bank code —
 * sometimes their NIN and BVN as well — and is gated on isAdmin(), which is TRUE
 * FOR ALL TEN ADMIN ROLES. The action that screen exists to perform is gated on
 * a specific permission held by two or three of them. So a role that cannot act
 * on a single row can read every banking instrument the list covers.
 *
 * Six were closed one at a time as each module was audited:
 *
 *   #92  admin wallet withdrawals            finance:process_withdrawals
 *   #133 marketplace escrow list             finance:resolve_disputes
 *   #142 farm-nation transactions            finance:resolve_disputes
 *   #147 farm-nation registrants             finance:resolve_disputes
 *   #148 land verification queue             land:verify_listings
 *   #149 WAVE withdrawal queue               finance:process_withdrawals
 *
 * Finding the seventh the same way would have meant auditing every remaining
 * module first. This is the sweep instead — every remaining list that hydrates
 * bank details, closed together on the permission the screen's own action
 * requires:
 *
 *   academy enrolment report                 academy:approve_applications
 *   cooperative member roster                cooperatives:approve_members
 *   cooperative transaction list             finance:process_withdrawals
 *   cooperative loan applications            cooperatives:approve_loans
 *   WAVE application queue                   wave:approve_applications
 *
 * WHAT THIS TEST IS FOR
 * ---------------------
 * Not to re-prove each fix — the module suites do that behaviourally. It is the
 * standing guard that a NEW list cannot appear with the old shape. The
 * enumeration is explicit so that "every" means something a reader can check,
 * and the scan below fails when a file starts touching bank details without
 * appearing in it.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { hasAdminPermission } from '@/lib/admin-permissions';

/**
 * Every action that hydrates somebody's bank details INTO A RESPONSE, and the
 * permission each one now requires before it does.
 */
const GATED_LISTS: ReadonlyArray<readonly [string, string]> = [
    ['src/app/actions/wallet.ts', 'finance:process_withdrawals'],
    ['src/app/actions/marketplace/_escrow_actions.ts', 'finance:resolve_disputes'],
    ['src/app/actions/farm-nation-admin/_fna_finance.ts', 'finance:resolve_disputes'],
    ['src/app/actions/farm-nation-admin/_fna_registrants.ts', 'finance:resolve_disputes'],
    ['src/app/actions/farm-nation-admin/_fna_verifications.ts', 'land:verify_listings'],
    ['src/app/actions/wave/_wv_admin_withdrawals.ts', 'finance:process_withdrawals'],
    ['src/app/actions/academy/_ac_admin_reports.ts', 'academy:approve_applications'],
    ['src/app/actions/cooperative/_coop_admin_members.ts', 'cooperatives:approve_members'],
    ['src/app/actions/cooperative/_coop_admin_money.ts', 'finance:process_withdrawals'],
    ['src/app/actions/cooperative/_loans_applications.ts', 'cooperatives:approve_loans'],
    ['src/app/actions/wave/_wv_admin_applications.ts', 'wave:approve_applications'],

    // Found by the scan below, not by reading module by module — which is the
    // whole reason the scan exists.
    ['src/app/actions/admin/_users.ts', 'users:export'],
    ['src/app/actions/academy/_ac_admin_applications.ts', 'academy:approve_applications'],
    ['src/app/actions/admin/_marketplace.ts', 'marketplace:approve_sellers'],
    ['src/app/actions/admin/_withdrawals.ts', 'finance:process_withdrawals'],
    ['src/app/actions/admin/_academy.ts', 'academy:approve_applications'],
    ['src/app/actions/admin/_land.ts', 'land:verify_listings'],
    ['src/app/actions/admin/_loans.ts', 'cooperatives:approve_loans'],
    ['src/app/actions/disputes.ts', 'finance:resolve_disputes'],

    // #339. These four are HTTP routes, and this scan could not see them until
    // they were fixed: each spread a raw document — `...data`, `...doc.data()`
    // — with no literal `bankDetails` anywhere in the file to match on. The
    // account number was in the document, not in the source. They are here now
    // because the fix names the fields it is protecting.
    //
    // None is called by any screen. That is why the earlier passes over these
    // modules did not reach them, and it is not a reason to leave an HTTP GET
    // open: a session cookie is all it takes.
    ['src/app/api/admin/marketplace/withdrawals/route.ts', 'finance:process_withdrawals'],
    ['src/app/api/admin/marketplace/seller-verifications/route.ts', 'marketplace:approve_sellers'],
];

/**
 * Files that touch bank details WITHOUT returning them to a caller, and so are
 * not part of this rule.
 *
 * order-management.ts is the one the first version of this scan got wrong: it
 * loads a seller's account to hand to paystackPayout and never returns it.
 * Using someone's account number to PAY them is the point; showing it to an
 * admin who cannot pay them is the defect.
 */
const NOT_A_LIST = [
    'src/app/actions/order-management.ts',
    'src/app/actions/admin/_exports.ts',        // gated on users:export, its own decision (#64)
    'src/app/api/admin/export/users/route.ts',  // same

    // A member writing their OWN bank details, on their own application or
    // withdrawal request. Nobody else's data is in scope.
    //
    // #208's re-verification action is the same shape and is triaged here
    // deliberately rather than by loosening the scan. Every action in it is
    // scoped to the session user and NONE takes a userId, so there is no
    // argument through which another person's row could arrive; and the status
    // read returns the last FOUR DIGITS of the account number, never the whole
    // one — the member needs to recognise which account is on file, not to read
    // it back. It exists because a held payout has to point somewhere (#362's
    // shape), and it is a member's own record, not a list of other people's.
    'src/app/actions/bank-account.ts',
    'src/app/actions/user.ts',                              // GDPR erase — FieldValue.delete()
    'src/app/actions/export/_ex_onboarding.ts',
    'src/app/actions/marketplace/_mp_onboarding.ts',
    'src/app/actions/marketplace/_mp_seller_verification.ts',
    'src/app/actions/wave/_wv_applications.ts',
    'src/app/api/cooperative/withdraw/route.ts',
    'src/app/api/marketplace/submit-verification/route.ts',

    // An admin WRITING a record, not reading a list of them. Both are behind
    // users:create / users:update, held by super_admin and admin only.
    'src/app/actions/admin/_legacy.ts',
    'src/app/actions/admin/_applications.ts',

    // Names bankDetails only inside a .select() projection used to categorise a
    // recipient; the broadcast returns phone and name and nothing else.
    'src/app/actions/sms-broadcast.ts',
];

const ROOTS = ['src/app/actions', 'src/app/api'];

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (entry.endsWith('.ts')) out.push(full);
    }
    return out;
}

/** Every file under the action and route trees that mentions bank details. */
function filesTouchingBankDetails(): string[] {
    const hits: string[] = [];
    for (const root of ROOTS) {
        for (const file of walk(join(process.cwd(), root))) {
            const src = readFileSync(file, 'utf8');
            if (/bankDetails|bankAccountNumber/.test(src)) {
                hits.push(file.replace(process.cwd() + '/', ''));
            }
        }
    }
    return hits.sort();
}

describe('#151 — no list hands out bank details on isAdmin() alone', () => {
    it.each(GATED_LISTS)('%s gates them on %s', (file, permission) => {
        const src = readFileSync(join(process.cwd(), file), 'utf8');

        expect(src).toContain('hasAdminPermission');
        expect(src).toContain(permission);
    });

    it('no OTHER action has started returning bank details unnoticed', () => {
        // The enumeration above is only worth something if something fails when
        // it goes stale. Any new file touching bank details has to be triaged
        // into GATED_LISTS or NOT_A_LIST deliberately.
        const known = new Set([...GATED_LISTS.map(([f]) => f), ...NOT_A_LIST]);
        const unknown = filesTouchingBankDetails().filter((f) => !known.has(f));

        expect(unknown).toEqual([]);
    });

    it('every permission used is real, and none is held by all ten roles', () => {
        // A permission every role holds would restore the defect under a new
        // name.
        const EVERY_ROLE = [
            'super_admin', 'admin', 'moderator', 'support', 'wave_admin',
            'cooperative_admin', 'marketplace_admin', 'export_admin',
            'farm_nation_admin', 'academy_admin',
        ];

        for (const [, permission] of GATED_LISTS) {
            const holders = EVERY_ROLE.filter((r) => hasAdminPermission([r], permission as never));
            expect(holders.length).toBeGreaterThan(0);
            expect(holders.length).toBeLessThan(EVERY_ROLE.length);
        }
    });

    it('super_admin and admin keep every screen they had', () => {
        for (const [, permission] of GATED_LISTS) {
            expect(hasAdminPermission(['super_admin'], permission as never)).toBe(true);
            expect(hasAdminPermission(['admin'], permission as never)).toBe(true);
        }
    });

    it('each module admin keeps their OWN module, and gains nobody else\'s', () => {
        // Why the module's permission rather than one global finance one: a
        // wave_admin still reviews WAVE applications, a cooperative_admin still
        // reviews members and loans.
        expect(hasAdminPermission(['wave_admin'], 'wave:approve_applications')).toBe(true);
        expect(hasAdminPermission(['cooperative_admin'], 'cooperatives:approve_members')).toBe(true);
        expect(hasAdminPermission(['cooperative_admin'], 'cooperatives:approve_loans')).toBe(true);
        expect(hasAdminPermission(['academy_admin'], 'academy:approve_applications')).toBe(true);
        expect(hasAdminPermission(['farm_nation_admin'], 'land:verify_listings')).toBe(true);

        expect(hasAdminPermission(['academy_admin'], 'wave:approve_applications')).toBe(false);
        expect(hasAdminPermission(['wave_admin'], 'cooperatives:approve_loans')).toBe(false);
        expect(hasAdminPermission(['marketplace_admin'], 'land:verify_listings')).toBe(false);
        expect(hasAdminPermission(['support'], 'finance:process_withdrawals')).toBe(false);
    });
});
