/**
 * @jest-environment node
 */

/**
 * The admin action surface, pinned across the split of admin.ts.
 *
 * WHAT HAPPENED
 * -------------
 * src/app/actions/admin.ts was 5,604 lines — the largest file in the repository,
 * and the one docs/audit/outstanding-work.md §5 names first ("admin.ts at 5,473
 * with 40 exported actions"; it had grown since). It is now
 * src/app/actions/admin/, one file per domain behind a barrel, so
 * `@/app/actions/admin` resolves exactly as before and no caller changed.
 *
 * It split cleanly for a reason worth recording: none of the 39 private
 * implementations called any other. They shared a 40-import header, two date
 * helpers and one type, and nothing else. So this was a move, not a rewrite —
 * every function body is what it was.
 *
 * WHY THIS TEST EXISTS
 * --------------------
 * The one thing a move like this can silently lose is an export. A dropped
 * action does not fail the type-checker at the barrel — it fails at whichever
 * page imports it, which may be a page no test renders.
 *
 * The list below is the export surface of admin.ts at the commit before the
 * split, taken from the file rather than typed from memory. It is 39 names and
 * they are asserted as a set: nothing missing, and nothing added by accident
 * either, because a barrel that starts re-exporting private helpers is how a
 * domain boundary stops meaning anything.
 *
 * The type export (EditableApplicationFields) is not checked here — types are
 * erased at runtime, so tsc is what pins it, and tsc runs over the whole tree.
 */

import { describe, it, expect } from '@jest/globals';

/** admin.ts's exports at 3864c026, the commit before the split. */
const EXPECTED_ACTIONS = [
    'approveAcademyApplicationAction',
    'approveExportOnboardingAction',
    'approveLoanApplication',
    'approveMarketplaceUserAction',
    'approveSellerVerificationAction',
    'approveWaveApplicationAction',
    'editApplicationAction',
    'getAcademyApplicationsAction',
    'getAdminSellerStatsAction',
    'getAllExportRequestsAction',
    'getExportApplicationsStatsAction',
    'getMarketplaceUsersAction',
    'getPendingLandListings',
    'getPendingLoanApplications',
    'getPendingWithdrawalsAction',
    'getPlatformSettingsAction',
    'getStandardExportApplicationsAction',
    'getStandardSellerVerificationsAction',
    'getUsersAction',
    'inviteLegacyMemberAction',
    'manualAcademyEnrollmentAction',
    'markAcademyApplicationUnderReviewAction',
    'onboardLegacyMemberAction',
    'processWithdrawalAction',
    'rejectAcademyApplicationAction',
    'rejectExportApplicationAction',
    'rejectLoanApplication',
    'rejectMarketplaceUserAction',
    'rejectWaveApplicationAction',
    'requestExportApplicationRevisionAction',
    'runSystemDiagnosticAction',
    'savePlatformSettingsAction',
    'toggleUserKycVerificationAction',
    'toggleUserVerificationAction',
    'toggleVerifiedBadgeAction',
    'unlockUserAccount',
    'updateUserGenderAction',
    'updateUserRolesAction',
    'verifyLandListing',
].sort();

describe('the admin barrel exports what admin.ts exported', () => {
    it('every action is still reachable at @/app/actions/admin', async () => {
        // THE test. A dropped export type-checks fine at the barrel and fails
        // at whichever page imports it.
        const mod: Record<string, unknown> = await import('@/app/actions/admin');

        const missing = EXPECTED_ACTIONS.filter((name) => !(name in mod));

        expect(missing).toEqual([]);
    });

    it('and each one is callable', async () => {
        // Vacuity guard: `name in mod` passes for a name exported as undefined.
        const mod: Record<string, unknown> = await import('@/app/actions/admin');

        const notFunctions = EXPECTED_ACTIONS.filter((name) => typeof mod[name] !== 'function');

        expect(notFunctions).toEqual([]);
    });

    it('and nothing else leaked out of the domain', async () => {
        // A barrel that starts re-exporting private helpers is how a domain
        // boundary stops meaning anything.
        const mod: Record<string, unknown> = await import('@/app/actions/admin');

        const extra = Object.keys(mod)
            .filter((k) => k !== '__esModule' && k !== 'default')
            .filter((k) => !EXPECTED_ACTIONS.includes(k));

        expect(extra).toEqual([]);
    });

    it('the count is the 39 the old file had', async () => {
        expect(EXPECTED_ACTIONS).toHaveLength(39);
    });
});

describe('the domain files keep the shape the audits expect', () => {
    const DOMAIN_FILES = [
        '_academy.ts',
        '_applications.ts',
        '_diagnostics.ts',
        '_exports.ts',
        '_land.ts',
        '_legacy.ts',
        '_loans.ts',
        '_marketplace.ts',
        '_settings.ts',
        '_users.ts',
        '_withdrawals.ts',
    ];

    function read(name: string): string {
        const { readFileSync } = require('fs');
        const { join } = require('path');
        return readFileSync(join(process.cwd(), 'src/app/actions/admin', name), 'utf-8');
    }

    it('each carries "use server"', () => {
        // action-security-audit.test.ts requires this of every file under
        // src/app/actions that is not a barrel.
        for (const file of DOMAIN_FILES) {
            expect(`${file}: ${read(file).includes('"use server"')}`).toBe(`${file}: true`);
        }
    });

    it('each guards its own actions', () => {
        // The same audit requires a session guard per file. Stated here too
        // because the old file satisfied it once for all 39 actions, and eleven
        // files have eleven chances to forget.
        for (const file of DOMAIN_FILES) {
            const src = read(file);
            const guarded =
                src.includes('requireSession') || src.includes('requireAdmin') || src.includes('auth()');
            expect(`${file}: ${guarded}`).toBe(`${file}: true`);
        }
    });

    it('none of them is the old shared module', () => {
        // The two date helpers moved to @/lib/date-utils and ActionState to
        // @/lib/safe-action, because a types-and-helpers file under
        // src/app/actions cannot satisfy either rule above.
        const { existsSync } = require('fs');
        const { join } = require('path');

        expect(existsSync(join(process.cwd(), 'src/app/actions/admin/_shared.ts'))).toBe(false);
        expect(existsSync(join(process.cwd(), 'src/app/actions/admin.ts'))).toBe(false);
    });
});
