/**
 * @jest-environment node
 */

/**
 * No seller approval, rejection or suspension has ever been written to the
 * audit log.
 *
 * The AuditAction union declares the vocabulary:
 *
 *     | 'seller_approved'
 *     | 'seller_rejected'
 *     | 'seller_suspended'
 *
 * Every one of them had zero emitters anywhere in the codebase. `land_verified`
 * and `land_rejected` did have emitters — in src/app/actions/land-listings.ts,
 * which the admin screen does not call:
 *
 *     admin/farm-nation/land-verification/page.tsx
 *         → fetch("/api/admin/farm-nation/approve-land")
 *         → fetch("/api/admin/farm-nation/reject-land")
 *
 *     admin/marketplace/sellers/page.tsx
 *         → fetch("/api/admin/marketplace/approve-seller")
 *         → fetch("/api/admin/marketplace/suspend-seller")
 *
 * So the platform has an audited path for these decisions and a screen that
 * uses the other one. The same shape as the certificate finding: the correct
 * implementation exists and nothing reaches it.
 *
 * These are the decisions an audit log is for. Who approved this seller, who
 * suspended that one and why, who verified this land listing — none of it was
 * recorded, while getAuditLogsAction and the CSV export sat ready to report it.
 *
 * TWO MORE, FOUND ON THE WAY
 * --------------------------
 * The land routes assigned `verificationStatus` as a fresh object, so approving
 * a listing that had been rejected erased the rejection reason and who gave it.
 * The record of the earlier decision disappeared at the moment it was reversed,
 * which is when it matters.
 *
 * approve-seller marked the verification approved FIRST, then granted the
 * seller role inside a try/catch marked `// Non-fatal — continue`. A failure
 * there produced an approved seller with no seller role — someone the admin
 * screen shows as approved and who cannot sell — and the route returned
 * success. The order is inverted now: the seller record and role are written
 * first, the verification is marked approved last, and a failure returns 500
 * with the verification untouched. Both writes are idempotent, so the retry is
 * safe.
 *
 * WHAT WAS CHECKED AND LEFT ALONE
 * -------------------------------
 * The same upsert writes `rating: 0, totalSales: 0` with { merge: true }, which
 * resets both on every approval. Neither field is read from that document —
 * the seller dashboard computes totalSales from orders and the rating shown on
 * a seller page is summed from reviews — so this is a latent trap rather than a
 * live defect, and changing it would alter what a newly created seller document
 * contains for no present benefit. Asserted below so that a reader appearing
 * turns it into a failure.
 */

import { describe, it, expect } from '@jest/globals';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

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

const ROUTES = {
    approveLand: 'src/app/api/admin/farm-nation/approve-land/route.ts',
    rejectLand: 'src/app/api/admin/farm-nation/reject-land/route.ts',
    approveSeller: 'src/app/api/admin/marketplace/approve-seller/route.ts',
    rejectSeller: 'src/app/api/admin/marketplace/reject-seller/route.ts',
    suspendSeller: 'src/app/api/admin/marketplace/suspend-seller/route.ts',
};

/** Non-comment emitters of an audit action name. */
function emitters(action: string): string[] {
    return execSync(`grep -rn "\\"${action}\\"" src --include='*.ts' || true`, {
        encoding: 'utf-8',
        cwd: process.cwd(),
    })
        .split('\n')
        .filter(Boolean)
        .filter((l) => !l.includes('__tests__') && !l.includes('lib/audit-log.ts') && !l.includes('types/strict.ts'))
        .filter((l) => {
            const body = l.slice(l.indexOf(':', l.indexOf(':') + 1) + 1).trim();
            return !body.startsWith('//') && !body.startsWith('*') && !body.startsWith('/*');
        });
}

describe('every admin approval decision is recorded', () => {
    it('all five routes write an audit entry', () => {
        // THE test.
        for (const [name, file] of Object.entries(ROUTES)) {
            expect(`${name}: ${source(file).includes('createAdminAuditLog')}`).toBe(`${name}: true`);
        }
    });

    it('the three seller actions now have emitters, having had none', () => {
        for (const action of ['seller_approved', 'seller_rejected', 'seller_suspended']) {
            expect(`${action}: ${emitters(action).length > 0}`).toBe(`${action}: true`);
        }
    });

    it('the land actions are emitted by the route the screen calls', () => {
        expect(source(ROUTES.approveLand)).toContain('action: "land_verified"');
        expect(source(ROUTES.rejectLand)).toContain('action: "land_rejected"');
    });

    it('the screens really do call these routes', () => {
        // The premise. If a screen is ever repointed at the audited server
        // actions instead, this fails and the duplication should be resolved
        // rather than both paths maintained.
        expect(source('src/app/admin/farm-nation/land-verification/page.tsx'))
            .toContain('/api/admin/farm-nation/approve-land');
        expect(source('src/app/admin/marketplace/sellers/page.tsx'))
            .toContain('/api/admin/marketplace/approve-seller');
    });

    it('a failed audit write does not fail the decision', () => {
        // The decision has already been made and persisted; throwing here would
        // return an error for an action that succeeded, which is worse than a
        // missing log line. Each call is caught.
        for (const file of Object.values(ROUTES)) {
            expect(source(file)).toContain('audit log failed');
        }
    });

    it('the audit action names are real ones', () => {
        // Vacuity guard: an action outside the union is stored but cannot be
        // filtered for, and getAuditStatsAction groups by it.
        const union = source('src/lib/audit-log.ts');

        for (const action of ['seller_approved', 'seller_rejected', 'seller_suspended', 'land_verified', 'land_rejected']) {
            expect(union).toContain(`'${action}'`);
        }
    });
});

describe('reversing a decision does not erase the previous one', () => {
    it('the land routes carry the prior verificationStatus forward', () => {
        for (const file of [ROUTES.approveLand, ROUTES.rejectLand]) {
            expect(source(file)).toContain('...(previous.verificationStatus ?? {})');
        }
    });

    it('approving clears the rejection reason rather than leaving it stale', () => {
        // Carrying the object forward without this would leave a verified
        // listing displaying why it was rejected.
        expect(source(ROUTES.approveLand)).toContain('rejectionReason: null');
    });

    it('the new decision still wins', () => {
        // Vacuity guard: spreading the old object AFTER the new fields would
        // preserve history by discarding the change.
        const approve = source(ROUTES.approveLand);
        const spreadAt = approve.indexOf('...(previous.verificationStatus');
        const verifiedAt = approve.indexOf('verified: true,', spreadAt);

        expect(spreadAt).toBeGreaterThan(-1);
        expect(verifiedAt).toBeGreaterThan(spreadAt);
    });

    it('the previous status is recorded in the audit entry', () => {
        for (const file of [ROUTES.approveLand, ROUTES.rejectLand]) {
            expect(source(file)).toContain('previousStatus: previous.status ?? null');
        }
    });
});

describe('a seller is not approved before they can sell', () => {
    const approve = source(ROUTES.approveSeller);

    it('the role grant is no longer swallowed', () => {
        const code = codeOnly(approve);

        expect(code).not.toContain('// Non-fatal — continue');
        expect(approve).toContain('Could not grant the seller role');
        expect(approve).toContain('{ status: 500 }');
    });

    it('the verification is marked approved after the role is granted', () => {
        // THE ordering. Approved-then-grant leaves an approved seller with no
        // seller role when the grant fails; grant-then-approve leaves the
        // verification pending, which the admin can retry.
        const roleAt = approve.indexOf('Failed to grant seller role');
        const approvedAt = approve.indexOf('status: "approved",\n            reviewedAt');

        expect(roleAt).toBeGreaterThan(-1);
        expect(approvedAt).toBeGreaterThan(roleAt);
    });

    it('and the audit entry comes after the approval', () => {
        const approvedAt = approve.indexOf('status: "approved",\n            reviewedAt');
        const auditAt = approve.indexOf('action: "seller_approved"');

        expect(auditAt).toBeGreaterThan(approvedAt);
    });

    it('the writes it retries are idempotent', () => {
        // Why a retry is safe: a merge and an arrayUnion.
        expect(approve).toContain('{ merge: true }');
        expect(approve).toContain('FieldValue.arrayUnion("seller")');
    });

    it('still does the work it exists to do', () => {
        // Vacuity guard: a route that refuses everything satisfies the
        // assertions above.
        expect(approve).toContain('COLLECTIONS.MARKETPLACE_SELLERS');
        expect(approve).toContain('sellerVerificationStatus: "approved"');
        expect(approve).toContain('sendSellerApprovalEmail');
    });
});

describe('recorded, not changed', () => {
    it('the seller upsert still resets rating and totalSales', () => {
        // `rating: 0, totalSales: 0` with { merge: true } zeroes both on every
        // approval. Left alone because neither is read from that document —
        // the dashboard sums totalSales from orders, and a seller page sums
        // rating from reviews — so this is a latent trap, not a live defect.
        expect(source(ROUTES.approveSeller)).toContain('rating: 0');

        const sellerDocReaders = execSync(
            `grep -rn 'MARKETPLACE_SELLERS' src --include='*.ts' || true`,
            { encoding: 'utf-8', cwd: process.cwd() }
        ).split('\n').filter(Boolean).filter((l) => !l.includes('__tests__'));

        // If a reader of the seller document starts pulling rating or
        // totalSales out of it, this stops being latent.
        for (const line of sellerDocReaders) {
            expect(line).not.toMatch(/\.rating|\.totalSales/);
        }
    });
});
