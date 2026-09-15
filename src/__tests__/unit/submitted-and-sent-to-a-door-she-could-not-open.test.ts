/**
 * @jest-environment node
 */

/**
 *   #790 THREE FORMS SENT A JUST-SUBMITTED APPLICANT TO A DASHBOARD SHE COULD
 *        NOT OPEN.
 *
 *   The owner: "ensure that for the forms that are gated with auto-approval,
 *   they should also [be] redirected to dashboard automatically and for the
 *   forms without auto-approval, they should be redirected to a pending page
 *   with a home button on the page and once approved, they should have a direct
 *   access to their dashboard."
 *
 *   Every onboarding client had the rule TWICE: a gate on mount that maps the
 *   registration status to a screen, and a submit handler that hardcoded
 *   `/<module>/dashboard` without consulting anything. The two disagreed in the
 *   same file.
 *
 *       EXPORT              writes "pending_approval", grants no role
 *                           submit → /export/dashboard, refused, bounced twice
 *       MARKETPLACE seller  writes "pending", grants no role — same bounce
 *       MARKETPLACE buyer   writes "active" AND grants marketplace_buyer, so she
 *                           is auto-approved — and was sent to a generic
 *                           /marketplace/dashboard, not the buyer dashboard the
 *                           gate itself sends approved buyers to
 *       FARM NATION         writes "pending" but grants farmer/investor, which
 *                           admit her at Layer 1. Auto-approved in fact, pending
 *                           on the record — and its gate read the record, so the
 *                           same member was inside the module through one door
 *                           and told she was queuing at another
 *
 * ── WHY THE FIX ASKS ABOUT ACCESS, NOT ABOUT STATUS ─────────────────────────
 *
 *   Farm Nation is the proof that a status string cannot answer this: "pending"
 *   and fully admitted, at the same instant. Any destination table keyed on
 *   status has to PREDICT checkModuleAccess, and every place the prediction is
 *   wrong is a bounce. So the caller asks the module the same question the
 *   member layout will ask, and routes on that.
 *
 *   The first describe below is therefore the load-bearing one: it drives the
 *   REAL gate against the four states these submit actions actually produce. If
 *   those answers are not what this finding claims, the routing built on them is
 *   wrong however neat it looks.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     onboardingDestination ignoring hasAccess                     KILLED
 *     marketplace buyer/seller dashboards swapped                  KILLED
 *     farm-nation pointed at its pending page when admitted        KILLED
 *     the export submit handler's hardcoded dashboard restored     KILLED
 *     the marketplace submit handler's hardcoded push restored     KILLED
 *     the export RESUBMIT path's hardcoded dashboard restored      KILLED
 *     the farm-nation gate reverted to status-only routing         KILLED
 *     a destination pointed at a route that does not exist         KILLED
 *     reword this header                                SURVIVED, intended
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { stripComments } from '@/lib/testing/strip-comments';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import {
    onboardingDestination, ALL_ONBOARDING_DESTINATIONS,
} from '@/lib/onboarding-destination';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

let store: FakeDbHandle;
beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
});

const gate = () => import('@/lib/module-access-check');

/** A member record in the state one of these submit actions leaves behind. */
function seedMember(id: string, roles: string[], registrations: Record<string, any>): void {
    store.seed(COLLECTIONS.USERS, id, {
        email: `${id}@example.com`,
        roles,
        serviceRegistrations: registrations,
    });
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#790 — what the REAL gate says about a just-submitted applicant', () => {
    /*
     *   The instrument, audited before anything is built on it. The JWT is
     *   passed EMPTY throughout, because that is the honest post-submit case:
     *   the session token was minted before the submission and cannot carry a
     *   role granted a second ago. So these exercise Layers 2 and 2.5, which is
     *   where the database decides.
     */
    it('EXPORT: pending_approval with no role is REFUSED', async () => {
        seedMember('exp', ['general_user'], { export: { status: 'pending_approval' } });
        const { checkModuleAccess } = await gate();
        expect(await checkModuleAccess('exp', [], 'export')).toBe(false);
    });

    it('MARKETPLACE seller: pending with no role is REFUSED', async () => {
        seedMember('mps', ['general_user'], { marketplace: { status: 'pending', accountType: 'seller' } });
        const { checkModuleAccess } = await gate();
        expect(await checkModuleAccess('mps', [], 'marketplace')).toBe(false);
    });

    it('MARKETPLACE buyer: active AND the role is ADMITTED', async () => {
        seedMember('mpb', ['general_user', 'marketplace_buyer'],
            { marketplace: { status: 'active', accountType: 'buyer' } });
        const { checkModuleAccess } = await gate();
        expect(await checkModuleAccess('mpb', [], 'marketplace')).toBe(true);
    });

    it('FARM NATION: "PENDING" AND ADMITTED AT THE SAME TIME', async () => {
        /*
         *   THE measurement this finding turns on, and the reason the fix asks
         *   about access rather than status. submitFarmNationOnboardingAction
         *   writes status "pending" and grants `farmer`/`investor` in the same
         *   batch; Layer 2.5 reads the stored roles array and admits her. A
         *   router that believed the status would send this member to a screen
         *   saying she is waiting for a module she can already use.
         */
        seedMember('fn', ['general_user', 'farmer'], { farmNation: { status: 'pending' } });
        const { checkModuleAccess } = await gate();

        expect(await checkModuleAccess('fn', [], 'farm-nation')).toBe(true);
    });

    it('CONTROL: a REJECTED farm-nation member is still refused, role or not', async () => {
        //   #763's rule, and the thing that stops "ask about access" becoming
        //   "any leftover role opens the door".
        seedMember('fnr', ['general_user', 'farmer'], { farmNation: { status: 'rejected' } });
        const { checkModuleAccess } = await gate();
        expect(await checkModuleAccess('fnr', [], 'farm-nation')).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#790 — the destination follows the gate', () => {
    it('NO ACCESS SENDS HER TO THE PENDING PAGE, on every module', () => {
        for (const m of ['export', 'farm-nation', 'marketplace'] as const) {
            expect(onboardingDestination(m, { hasAccess: false })).toMatch(/\/pending$/);
        }
    });

    it('AND ACCESS SENDS HER TO A DASHBOARD', () => {
        expect(onboardingDestination('export', { hasAccess: true })).toBe('/export/dashboard');
        expect(onboardingDestination('farm-nation', { hasAccess: true })).toBe('/farm-nation/properties');
    });

    it('MARKETPLACE TELLS A BUYER FROM A SELLER', () => {
        //   The gate on the same screen has always made this distinction; the
        //   submit handler sent both to /marketplace/dashboard.
        expect(onboardingDestination('marketplace', { hasAccess: true, accountType: 'buyer' }))
            .toBe('/marketplace/buyer/dashboard');
        expect(onboardingDestination('marketplace', { hasAccess: true, accountType: 'seller' }))
            .toBe('/marketplace/seller/dashboard');
        expect(onboardingDestination('marketplace', { hasAccess: true, accountType: 'both' }))
            .toBe('/marketplace/seller/dashboard');
    });

    it('and an approved seller is never sent to the pending page by accident', () => {
        expect(onboardingDestination('marketplace', { hasAccess: true, accountType: 'seller' }))
            .not.toMatch(/pending/);
    });

    it('EVERY DESTINATION IS A ROUTE THAT EXISTS', () => {
        /*
         *   A redirect to a route that does not exist is the same dead end
         *   wearing a 404, and these paths cross route groups — /export/dashboard
         *   is really src/app/export/(app)/dashboard — so a spelling that looks
         *   right can still resolve to nothing.
         *
         *   Checked by walking the app directory rather than by guessing the
         *   group name: my first pass at this asked for
         *   src/app/export/dashboard/page.tsx, got "missing", and would have
         *   reported four routes as absent that are all present.
         */
        const pages = execSync(
            "find src/app -name page.tsx | sed 's|^src/app||; s|/page.tsx$||; s|/([^)]*)|/|g; s|//*|/|g'",
            { encoding: 'utf8' },
        ).split('\n').filter(Boolean);

        expect(pages.length).toBeGreaterThan(50);
        for (const dest of ALL_ONBOARDING_DESTINATIONS) {
            expect({ dest, exists: pages.includes(dest) }).toEqual({ dest, exists: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#790 — and no form decides this on its own any more', () => {
    const CLIENTS = [
        'src/app/export/onboarding/ExportOnboardingClient.tsx',
        'src/app/farm-nation/onboarding/FarmNationOnboardingClient.tsx',
        'src/app/marketplace/onboarding/MarketplaceOnboardingClient.tsx',
    ];

    it('THE HARDCODED DASHBOARD PUSHES ARE GONE — BOTH OF THEM, IN EACH FILE', () => {
        /*
         *   THE test. Each of these was a literal push to a dashboard with no
         *   question asked, sitting a hundred lines below a gate in the same
         *   file that knew better.
         *
         *   AND THERE WERE TWO PER FILE. The first pass fixed the submit path
         *   and this assertion failed on the RESUBMIT path, which had the same
         *   defect and a sharper version of it: the toast says "resubmitted for
         *   review" and the next line sent her to a dashboard, so the
         *   destination contradicted the sentence directly above it. A member
         *   correcting a rejected application goes back to pending.
         *
         *   Swept rather than specimen-checked for exactly that reason — this
         *   audit's most repeated finding is a correct rule applied to some of
         *   the places it names, and here the second place was in the same
         *   function.
         */
        for (const p of CLIENTS) {
            const src = stripComments(read(p));
            expect({ p, hit: /router\.(push|replace)\("\/export\/dashboard"\)/.test(src) })
                .toEqual({ p, hit: false });
            expect({ p, hit: /router\.(push|replace)\("\/farm-nation\/dashboard"\)/.test(src) })
                .toEqual({ p, hit: false });
            expect({ p, hit: /router\.(push|replace)\("\/marketplace\/dashboard"\)/.test(src) })
                .toEqual({ p, hit: false });
        }
    });

    it('AND EACH ASKS THE GATE BEFORE IT ROUTES', () => {
        const checks: Record<string, RegExp> = {
            'src/app/export/onboarding/ExportOnboardingClient.tsx': /checkExportAccessAction\(\)/,
            'src/app/farm-nation/onboarding/FarmNationOnboardingClient.tsx': /checkFarmNationAccessAction\(\)/,
            'src/app/marketplace/onboarding/MarketplaceOnboardingClient.tsx': /checkMarketplaceAccessAction\(\)/,
        };
        for (const [p, re] of Object.entries(checks)) {
            const src = stripComments(read(p));
            expect(src).toMatch(/onboardingDestination\(/);
            expect(src).toMatch(re);
        }
    });

    it('AND THE FARM NATION GATE NO LONGER CONTRADICTS ITS OWN SUBMIT', () => {
        /*
         *   The half that is not about submitting at all. A member who finished
         *   onboarding and later opened /farm-nation/onboarding again was read
         *   off her status — "pending" — and sent to a waiting screen, while
         *   holding the roles that admit her. It asks about access there too.
         */
        const src = stripComments(read('src/app/farm-nation/onboarding/FarmNationOnboardingClient.tsx'));
        const gateBlock = src.split('const checkStatus')[1].split('const handleSubmit')[0];

        expect(gateBlock).toMatch(/checkFarmNationAccessAction\(\)/);
        expect(gateBlock).toMatch(/onboardingDestination\("farm-nation"/);
        expect(gateBlock).not.toMatch(/router\.replace\("\/farm-nation\/onboarding\/pending"\)/);
    });

    it('CONTROL: WAVE and the cooperative are untouched, having never had this defect', () => {
        /*
         *   WAVE submits to its own success screen (#774) and the cooperative
         *   routes on a payment result, so neither carries the hardcoded push
         *   this finding removes. "Fix everything" applied to a working path is
         *   churn with a regression attached.
         */
        const wave = stripComments(read('src/app/wave/application/WaveApplicationClient.tsx'));
        expect(wave).toMatch(/router\.push\("\/wave\/application\/success"\)/);
        expect(wave).not.toMatch(/onboardingDestination/);
    });

    it('and the pending screens each still have a way home', () => {
        //   #781's rule, restated as the second half of the owner's sentence —
        //   a member with nothing to do on a screen must be able to leave it.
        for (const p of ALL_ONBOARDING_DESTINATIONS.filter(d => d.endsWith('/pending'))) {
            const file = `src/app${p}/page.tsx`;
            expect({ p, exists: existsSync(join(process.cwd(), file)) }).toEqual({ p, exists: true });
            expect(read(file)).toMatch(/<FormHomeButton\b/);
        }
    });
});
