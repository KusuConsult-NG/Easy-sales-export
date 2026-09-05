/**
 * @jest-environment node
 */

/**
 *   #399 THE ORPHAN QUEUE, CLOSED AND PINNED.
 *
 *   #395 replaced an assumption with a measurement: count the callers before
 *   deciding what a door is. #396 ran that count over every exported *Action in
 *   src/ — 457 of them — and reported 45 with no live caller.
 *
 *   THAT NUMBER WAS WRONG, AND THIS SUITE IS WHERE IT IS CORRECTED.
 *   The counter matched identifiers in RAW file text, so a module whose PROSE
 *   named an action counted as a caller of it. This codebase annotates heavily,
 *   which is normally the point — here it hid 25 orphans behind their own
 *   tombstones. Writing lib/marketplace-escrow-lifecycle.ts even dropped the
 *   four escrow actions off the list without anything wiring them. Counting
 *   with comments stripped, the real figure is 69. Same trap as #383, #384,
 *   #392 and #394, this time in my own measuring tool.
 *
 *   WHAT THE QUEUE PRODUCED
 *   -----------------------
 *     #396  createImpersonationTokenAction minted a token nothing could redeem,
 *           with active/expiresAt/usedAt written and enforced by nothing.
 *           RETIRED behind ADMIN_IMPERSONATION_ACTION.
 *     #397  land verification had two doors; the screen used the one that wrote
 *           status blind and wrote only one of the three decision fields.
 *           FIXED on the wired door.
 *     #398  a complete second escrow lifecycle — create, fund, request release,
 *           release — none of it ever reached, its create using a random id no
 *           release, refund or cron could address. RETIRED behind
 *           MARKETPLACE_ESCROW_LIFECYCLE_ACTIONS.
 *     #399  the seller badge pair never called notifyBadgeUpdated, which #391
 *           had wired into the other badge door. FIXED — #297's class, a repair
 *           landing on one of several copies.
 *
 *   TRIAGED, AND NOT YET TRIAGED
 *   -----------------------------
 *   32 names carry a verdict below. 37 do not: they are listed in PENDING,
 *   named, and explicitly NOT waved through. Several are money or user-flow
 *   paths where the answer matters — walletCheckoutAction,
 *   processLoanRepaymentAction, the two alternate order creators in
 *   _payment_orders.ts, uploadCertificateAction, bookExportSlotAction.
 *
 *   Recording them as pending is the honest state. Writing 37 verdicts I have
 *   not earned would make this file look finished while carrying guesses, which
 *   is exactly the failure the queue exists to catch.
 *
 *   Where a verdict does say "left alone", it is because being unwired is a gap
 *   in the product rather than a defect in the code, and a flag in front of a
 *   correct action would add friction and prevent nothing. Retiring is only a
 *   fix when the thing retired is wrong — #384's rule, which cuts both ways.
 *
 *   WHAT THIS SUITE IS FOR
 *   -----------------------
 *   Pinning the list, in both directions. A new unreached action fails the first
 *   case; a pending or retired one quietly acquiring a caller fails the second.
 *   Either way the triage is redone deliberately rather than a dead door
 *   becoming a live one by accident — the failure mode #276, #297, #384, #386,
 *   #395 and #397 are all versions of.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the badge pair stops notifying               KILLED
 *     the scan starts reading comments as code     KILLED
 *     a pending name is silently dropped           KILLED
 *     reword the header prose                      SURVIVED, as intended
 */

import { describe, it, expect } from '@jest/globals';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

const cache = new Map<string, string>();
const code = (p: string) => {
    if (!cache.has(p)) cache.set(p, stripComments(readFileSync(p, 'utf-8'), { label: relative(ROOT, p) }));
    return cache.get(p)!;
};

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry === 'node_modules') continue;
            walk(full, out);
        } else if (/\.tsx?$/.test(entry)) {
            out.push(full);
        }
    }
    return out;
}

const FILES = walk(SRC);
const isTest = (p: string) => p.includes('__tests__') || /\.test\.tsx?$/.test(p);
const PROD = FILES.filter((p) => !isTest(p));

/** Every exported name ending in "Action", and the file that defines it. */
function definitions(): Map<string, string> {
    const out = new Map<string, string>();
    for (const p of PROD) {
        const src = code(p);
        for (const re of [
            /export\s+(?:async\s+)?function\s+(\w*Action)\b/g,
            /export\s+const\s+(\w*Action)\b/g,
        ]) {
            for (const m of src.matchAll(re)) if (!out.has(m[1])) out.set(m[1], p);
        }
    }
    return out;
}

/** Names with no mention outside their defining file, comments not counted. */
function unreached(): string[] {
    const defs = definitions();
    const idents = new Map<string, Set<string>>();
    for (const p of PROD) idents.set(p, new Set(code(p).match(/[A-Za-z_$][\w$]*/g) ?? []));

    const out: string[] = [];
    for (const [name, owner] of defs) {
        const reached = PROD.some((p) => p !== owner && idents.get(p)!.has(name));
        if (!reached) out.push(name);
    }
    return out.sort();
}

/**
 * The triage, for the ones actually looked at. The value is the verdict, and it
 * is prose on purpose: a bare list would say which doors are shut without saying
 * why anybody decided that was correct.
 */
const TRIAGED: Record<string, string> = {
    // Not server actions — lib/ helpers the name-based scan picks up.
    canPerformAction: 'lib/role-utils helper, not an action',
    getSeverityForAction: 'lib/audit-log helper, not an action',
    logFinancialAction: 'lib/audit-log helper, not an action',

    // Retired behind flags by this queue and its predecessors.
    createImpersonationTokenAction: '#396 retired — token nothing can redeem',
    createEscrowAction: '#398 retired — random id no release can address',
    confirmEscrowPaymentAction: '#398 retired — funds rows the create never made',
    requestEscrowReleaseAction: '#398 retired — writes a field nothing reads',
    releaseEscrowAction: '#398 retired — duplicate of releaseEscrowFunds',
    sendBulkEmailAction: '#395 retired — no bounce list, no unsubscribe header',
    getEmailHistoryAction: '#395 retired — reads EMAIL_HISTORY, which is empty',

    // Already carrying a deliberate "do not wire" decision.
    confirmDeliveryAction: 'owner rejected this payout model (2026-08-10); only implementation of commission-on-sale',
    loginAction: 'stub — returns "Please use client-side login"',

    // Correct, guarded, simply unwired. Checked and left alone.
    bulkActivateUsersAction: '#396 — correct, no screen; nothing else activates a platform user',
    bulkSuspendUsersAction: '#396 — correct, no screen; nothing else suspends a platform user',
    bulkAssignRolesAction: '#396 — correct after #87; no screen',
    bulkDeleteUsersAction: '#396 — correct after #305; no screen',
    exportUserDataAction: '#396 — correct, no screen; nothing else exports one user',
    grantSellerVerifiedBadgeAction: '#399 — now notifies, matching the live badge door',
    revokeSellerVerifiedBadgeAction: '#399 — now notifies, matching the live badge door',
    updateSellerCategoryAction: 'correct after #116; no screen',
    verifyLandListingAction: '#397 — hardened sibling of the wired land-actions door',
    rejectLandListingAction: '#397 — hardened sibling of the wired land-actions door',
    getPendingLandListingsAction: 'reader for the land queue above',
    repairDataAction: 'maintenance; /admin/settings/maintenance exposes only cleanupAbandonedDrafts',
    runConsistencyCheckAction: 'maintenance; same screen, no button',
    hardResetCacheAction: 'maintenance; same screen, no button',
    getPlatformMetricsAction: 'global-aggregation; the dashboard uses admin-analytics',
    getUserMetricsAction: 'global-aggregation; the dashboard uses admin-analytics',
    getMarketplaceMetricsAction: 'global-aggregation; the dashboard uses admin-analytics',
    getCommunicationsMetricsAction: 'global-aggregation; the dashboard uses admin-analytics',
    getGlobalPendingApprovalsAction: 'global-aggregation; the dashboard uses admin-analytics',
    createOrderAction: 'parallel of initializeOrderPaymentAction, which /marketplace/checkout uses',
};

/**
 * MEASURED, NOT YET INDIVIDUALLY TRIAGED.
 *
 * Listed rather than waved through. Each still needs the same three-way
 * question the queue asks — is it wrong, is it a hazard if wired, or is it
 * merely unwired — and several are money or user-flow paths where the answer
 * matters: walletCheckoutAction, processLoanRepaymentAction, the two alternate
 * order creators in _payment_orders.ts, uploadCertificateAction.
 *
 * Recording them as pending is the honest state. Writing a verdict I have not
 * earned would make this file look finished while carrying guesses, which is
 * the failure the whole queue exists to catch.
 */
const PENDING: readonly string[] = [
    'bookExportSlotAction',
    'broadcastToCooperativeMembersAction',
    'checkOnboardingStatusAction',
    'completeOnboardingAction',
    'createBankTransferOrderAction',
    'createBulkNotificationsAction',
    'createLandListingAction',
    'createPaymentOnDeliveryOrderAction',
    'createPaymentRecordAction',
    'createReviewAction',
    'deleteCertificateAction',
    'getApprovedCooperativeMembersAction',
    'getBuyerDisputesAction',
    'getCleanBroadcastListAction',
    'getEscrowStatusAction',
    'getFeaturedProductsAction',
    'getOrderDetailsAction',
    'getPaymentByReferenceAction',
    'getPendingContentAction',
    'getPendingReviewsAction',
    'getProductsByCategoryAction',
    'getSavedItemCountAction',
    'getSellerDisputesAction',
    'getSellerRatingAction',
    'getSellerReviewSummaryAction',
    'getUnreadCountAction',
    'getUserCertificatesAction',
    'getUserExportSlotsAction',
    'getUserNotificationsAction',
    'getUserPaymentHistoryAction',
    'processLoanRepaymentAction',
    'removeFlashSaleProductAction',
    'softDeleteUserAction',
    'submitForVerificationAction',
    'submitLandInquiryAction',
    'uploadCertificateAction',
    'walletCheckoutAction',
];

// ─────────────────────────────────────────────────────────────────────────────
describe('#399 — the queue is closed and pinned', () => {
    it('EVERY UNREACHED ACTION IS EITHER TRIAGED OR NAMED AS PENDING', () => {
        const known = new Set([...Object.keys(TRIAGED), ...PENDING]);
        const unaccounted = unreached().filter((n) => !known.has(n));
        // A new name here means somebody added an action nothing calls, or the
        // scan changed. Either way the triage has to be redone deliberately.
        expect(unaccounted).toEqual([]);
    });

    it('and the count is the corrected one, not #396\'s undercount', () => {
        /**
         * 69, measured with THIS suite's stripper — the same one the rest of the
         * ratchets use. #396 said 45 because its counter read prose as callers.
         *
         * A hand-rolled stripper used while triaging said 70, disagreeing on
         * submitWaveApplicationAction. The real stripper wins: the number is a
         * property of the tool that enforces it, and a second implementation
         * that "mostly" agrees is how #75 started.
         */
        expect(unreached().length).toBe(Object.keys(TRIAGED).length + PENDING.length);
        expect(PENDING.length).toBeGreaterThan(0);
    });

    it('and nothing in the record has quietly been wired up', () => {
        const now = new Set(unreached());
        const wired = [...Object.keys(TRIAGED), ...PENDING].filter((n) => !now.has(n));
        /**
         * The other direction, and the one that matters more. If a retired or
         * deliberately-unwired action acquires a caller, this fails and the
         * entry must be revisited rather than the door silently opening.
         */
        expect(wired).toEqual([]);
    });

    it('and the scan reads code, not the notes describing it', () => {
        /**
         * The artifact that bit: lib/marketplace-escrow-lifecycle.ts names all
         * four retired escrow actions in its header, and a raw-text counter
         * read that as four live callers, dropping them off the list without
         * anything having been wired. #383, #384, #392 and #394 all hit some
         * version of this.
         */
        const flag = join(SRC, 'lib/marketplace-escrow-lifecycle.ts');
        expect(readFileSync(flag, 'utf-8')).toContain('createEscrowAction');
        expect(code(flag)).not.toContain('createEscrowAction');
        // And the list still carries them, which is the proof the fix works.
        expect(unreached()).toContain('createEscrowAction');
    });

    it('and the counter can still see a reached action', () => {
        // Positive control. Without it, "everything is unreached" would pass.
        const defs = definitions();
        expect(defs.has('toggleVerifiedBadgeAction')).toBe(true);
        expect(unreached()).not.toContain('toggleVerifiedBadgeAction');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#399 — the badge doors agree about what a badge change means', () => {
    it('BOTH NOTIFY THE SELLER', () => {
        // #391 wired notifyBadgeUpdated into the door the admin screen uses and
        // left the other pair without it. #297's fault: a fix landing on one of
        // several copies.
        const pair = code(join(SRC, 'app/actions/marketplace/_mp_seller_verification.ts'));
        const live = code(join(SRC, 'app/actions/admin/_marketplace.ts'));

        expect(pair).toContain('notifyBadgeUpdated(');
        expect(live).toContain('notifyBadgeUpdated(');
    });

    it('and both still write the same fields and record the same audit action', () => {
        const pair = code(join(SRC, 'app/actions/marketplace/_mp_seller_verification.ts'));
        const live = code(join(SRC, 'app/actions/admin/_marketplace.ts'));
        for (const field of ['isVerifiedBadge', 'badgeGrantedBy', 'badgeGrantedAt']) {
            expect({ field, pair: pair.includes(field), live: live.includes(field) })
                .toEqual({ field, pair: true, live: true });
        }
        // And on the same permission — #118's repair, which must not diverge.
        expect(pair).toContain('marketplace:approve_sellers');
        expect(live).toContain('marketplace:approve_sellers');
    });
});
