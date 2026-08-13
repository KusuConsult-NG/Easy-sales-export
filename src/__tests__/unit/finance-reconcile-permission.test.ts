/**
 * @jest-environment node
 */

/**
 * A route that replays payment fulfilment was guarded by a READ permission.
 *
 * /api/admin/finance/paystack-sync reads nothing. It fetches every transaction
 * on the Paystack account and puts each successful one through the same
 * processors the webhook uses:
 *
 *     processMarketplaceOrder            processAcademyRegistration
 *     processExportInvestment            processFarmNationRegistration
 *     processCooperativeRegistration     processWaveRegistration
 *     confirmWalletFundingAction
 *
 * Those grant roles, activate cooperative and academy memberships, and credit
 * wallets. The guard was:
 *
 *     hasAdminPermission(session.user.roles, "finance:read")
 *
 * finance:read is held by five roles. Three of them — support,
 * cooperative_admin and marketplace_admin — hold no other finance permission at
 * all. So a support agent could trigger platform-wide payment fulfilment.
 *
 * WHY A NEW PERMISSION
 * --------------------
 * The matrix already had the right shape: finance:process_withdrawals is held
 * by super_admin and admin alone, and that is the boundary this needs. It is
 * granted to exactly that set. The name is new only because none of the
 * existing four describe replaying fulfilment — calling it
 * finance:process_withdrawals would have been the same class of mislabel this
 * audit keeps finding, where the word in the code and the thing it protects
 * have drifted apart.
 *
 * THE SCHEDULED TWIN WAS ALWAYS RIGHT
 * -----------------------------------
 * cron/reconcile-paystack runs the same processors behind CRON_SECRET, and
 * fails closed when that variable is unset. The same job existed twice — once
 * correctly guarded for the scheduler, once behind a read permission for
 * people. Recorded below so a future change to one is visibly a change to only
 * one.
 *
 * IT WAS ALSO UNTHROTTLED
 * -----------------------
 * `export const GET = paystackSyncHandler` — no rate limit, on a handler that
 * pages the entire Paystack transaction history across three status buckets in
 * parallel, 100 per page, with no page ceiling, and then runs fulfilment on
 * everything successful. Any holder of the guard permission could run that as
 * fast as they could issue requests, against a third-party API with its own
 * limits and a bill attached.
 *
 * TWO THINGS THE SCAN FOUND THAT WERE NOT DEFECTS
 * ----------------------------------------------
 * The same sweep flagged admin/finance/reconcile and admin/password-resets.
 * Both were false positives, and both are asserted below so the scanner's own
 * blind spot stays visible:
 *
 *     finance/reconcile     localReferences.add(...)  — a Set
 *     password-resets       toDelete.set(...)         — a Map, and its DELETE
 *                                                       handler correctly uses
 *                                                       users:update
 *
 * Acting on either would have narrowed a route that was already correct. This
 * audit has now nearly done that three times.
 */

import { describe, it, expect } from '@jest/globals';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { hasAdminPermission } from '@/lib/admin-permissions';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function codeOnly(src: string): string {
    return src
        .split('\n')
        .filter((l) => {
            const t = l.trim();
            return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
        })
        .join('\n');
}

const SYNC = 'src/app/api/admin/finance/paystack-sync/route.ts';

describe('replaying fulfilment needs a write permission', () => {
    it('the route asks for finance:reconcile, not finance:read', () => {
        // THE test.
        const code = codeOnly(source(SYNC));

        expect(code).toContain('hasAdminPermission(session.user.roles, "finance:reconcile")');
        expect(code).not.toContain('hasAdminPermission(session.user.roles, "finance:read")');
    });

    it('the roles that only read finance can no longer trigger it', () => {
        for (const role of ['support', 'cooperative_admin', 'marketplace_admin']) {
            expect(hasAdminPermission([role], 'finance:read' as any)).toBe(true);
            expect(hasAdminPermission([role], 'finance:reconcile' as any)).toBe(false);
        }
    });

    it('the roles that were meant to can', () => {
        // Vacuity guard: a permission nobody holds passes every refusal
        // assertion and silently removes the feature.
        for (const role of ['super_admin', 'admin']) {
            expect(hasAdminPermission([role], 'finance:reconcile' as any)).toBe(true);
        }
    });

    it('it is granted to exactly the set that already held the finance writes', () => {
        // finance:process_withdrawals was the existing boundary. The new
        // permission does not invent a different one.
        for (const role of ['super_admin', 'admin', 'support', 'cooperative_admin', 'marketplace_admin', 'moderator', 'wave_admin']) {
            expect(hasAdminPermission([role], 'finance:reconcile' as any))
                .toBe(hasAdminPermission([role], 'finance:process_withdrawals' as any));
        }
    });

    it('the route really does run fulfilment', () => {
        // The premise of the whole change. If these calls ever leave, the
        // permission should be revisited rather than kept out of habit.
        const src = source(SYNC);

        for (const fn of [
            'processMarketplaceOrder',
            'processExportInvestment',
            'processCooperativeRegistration',
            'processAcademyRegistration',
            'processFarmNationRegistration',
            'processWaveRegistration',
        ]) {
            expect(src).toContain(fn);
        }
    });
});

describe('and a rate limit, on a handler that pages an entire payment history', () => {
    it('is wrapped', () => {
        expect(source(SYNC)).toContain('export const GET = withRateLimit(paystackSyncHandler)');
    });

    it('the guard runs before the Paystack fan-out', () => {
        // Ordering: a permission checked after the pages are fetched has
        // already spent the money.
        const src = source(SYNC);
        const guardAt = src.indexOf('finance:reconcile"');
        const fetchAt = src.indexOf('fetchAllPaystackByStatus("success"');

        expect(guardAt).toBeGreaterThan(-1);
        expect(fetchAt).toBeGreaterThan(guardAt);
    });
});

describe('the scheduled twin, which was always guarded correctly', () => {
    const CRON = 'src/app/api/cron/reconcile-paystack/route.ts';

    it('requires the shared secret', () => {
        expect(source(CRON)).toContain('Bearer ${cronSecret}');
    });

    it('fails closed when the secret is not configured', () => {
        // Rather than treating an unset variable as "no check needed", which is
        // how an unauthenticated fulfilment endpoint appears in an environment
        // nobody thought about.
        const src = source(CRON);
        expect(src).toContain('CRON_SECRET not configured');
        expect(src.indexOf('CRON_SECRET not configured'))
            .toBeLessThan(src.indexOf('processMarketplaceOrder'));
    });

    it('runs the same processors, which is why both needed checking', () => {
        expect(source(CRON)).toContain('processCooperativeRegistration');
    });
});

describe('no route gated on a read permission performs a write', () => {
    /**
     * Write signals chosen to exclude Set.add and Map.set, which is what made
     * two of the three original hits false positives.
     */
    const WRITE = /process[A-Z]\w*\(|\.doc\([^)]*\)\.(set|update|delete)\(|\.collection\([^)]*\)\.add\(|batch\.(set|update|delete)\(|creditWallet|debitWallet|claimPayment/;

    function routesGatedOnRead(): Array<{ file: string; perm: string }> {
        const files = execSync(`grep -rl 'hasAdminPermission' src/app/api --include='route.ts' || true`, {
            encoding: 'utf-8',
            cwd: process.cwd(),
        }).split('\n').filter(Boolean);

        const out: Array<{ file: string; perm: string }> = [];
        for (const file of files) {
            const src = source(file);
            // Every permission the file checks, not only the first — the first
            // is what a naive scan sees, and password-resets checks users:read
            // in GET and users:update in DELETE.
            const perms = [...src.matchAll(/hasAdminPermission\([^,]+,\s*"([a-z_]+:[a-z_]+)"/g)].map((m) => m[1]);
            if (perms.length > 0 && perms.every((p) => p.endsWith(':read'))) {
                out.push({ file, perm: perms[0] });
            }
        }
        return out;
    }

    it('holds across every route that checks a permission', () => {
        const offenders = routesGatedOnRead().filter(({ file }) => WRITE.test(codeOnly(source(file))));

        expect(offenders.map((o) => o.file)).toEqual([]);
    });

    it('the sweep still sees routes, so an empty result means something', () => {
        // Vacuity guard: a broken grep returns no files and the assertion above
        // passes for the wrong reason.
        const checked = execSync(`grep -rl 'hasAdminPermission' src/app/api --include='route.ts' || true`, {
            encoding: 'utf-8',
            cwd: process.cwd(),
        }).split('\n').filter(Boolean);

        expect(checked.length).toBeGreaterThan(3);
        expect(routesGatedOnRead().length).toBeGreaterThan(0);
    });

    it('the two false positives are recorded as correct', () => {
        // finance/reconcile: Set.add. password-resets: Map.set, and its writing
        // handler asks for users:update.
        expect(source('src/app/api/admin/finance/reconcile/route.ts'))
            .toContain('localReferences.add(');
        expect(source('src/app/api/admin/password-resets/route.ts'))
            .toContain('hasAdminPermission(session.user.roles, "users:update")');
    });
});
