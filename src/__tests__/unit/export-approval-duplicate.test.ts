/**
 * @jest-environment node
 */

/**
 * Two export approval endpoints, and the weaker one was reachable.
 *
 * Both act on EXPORT_APPLICATIONS and both grant export access:
 *
 *   approveExportOnboardingAction    admin/_exports.ts. What
 *                                    /admin/export/applications calls.
 *   approveExportApplicationAction   export/_ex_onboarding.ts. No page caller,
 *                                    but re-exported through the export barrel
 *                                    and reachable regardless — every export of
 *                                    a "use server" module is an HTTP endpoint.
 *
 * They disagreed on six things:
 *
 *   GUARD        canonical: hasAdminPermission(users:update) OR
 *                           export:approve_applications, then admin/super_admin
 *                legacy:    the literal session-token roles admin/super_admin,
 *                           so an admin holding export:approve_applications was
 *                           allowed by one and refused by the other.
 *
 *   FIELD NAMES  canonical writes reviewedBy/reviewedAt; the legacy one wrote
 *                approvedBy/approvedAt. Who approved an application, and when,
 *                was recorded under whichever pair the caller happened to reach.
 *
 *   isVerified   canonical sets it, with verifiedBy/verifiedAt. Legacy did not.
 *   PAYMENT      canonical sets serviceRegistrations.export.paymentStatus and
 *                approvedAt. Legacy set neither.
 *   CACHE        canonical invalidates the export service cache and the global
 *                admin stats. Legacy invalidated nothing, so an approval did not
 *                take effect until the cache expired.
 *   LOOKUP       canonical resolves the application by document id OR by its
 *                applicationId field. Legacy by document id alone.
 *
 * Same shape as the two academy approvals, and treated the same way: the legacy
 * export delegates rather than being deleted, so a caller still pointing at it
 * gets the behaviour the platform considers correct.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

const LEGACY = 'src/app/actions/export/_ex_onboarding.ts';
const CANONICAL = 'src/app/actions/admin/_exports.ts';
const BARREL = 'src/app/actions/export/index.ts';
const ADMIN_PAGE = 'src/app/admin/export/applications/page.tsx';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function code(rel: string): string {
    return source(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

/** The legacy approval's body, isolated. */
function legacyBody(): string {
    const src = code(LEGACY);
    const start = src.indexOf('export async function approveExportApplicationAction(');
    expect(start).toBeGreaterThan(-1);
    const after = src.slice(start + 10);
    const end = after.indexOf('\nexport async function ');
    return end > 0 ? after.slice(0, end) : after;
}

describe('the legacy approval', () => {
    it('delegates instead of reimplementing', () => {
        // THE test.
        const body = legacyBody();

        expect(body).toContain('await import("@/app/actions/admin/_exports")');
        expect(body).toContain('approveExportOnboardingAction(applicationId)');
    });

    it('and no longer carries its own guard, field names, batch or email', () => {
        const body = legacyBody();

        expect(body).not.toContain("roles?.includes('admin')");
        expect(body).not.toContain('approvedBy: session.user.id');
        expect(body).not.toContain("status: 'approved'");
        expect(body).not.toContain('resend.emails.send');
        expect(body).not.toContain('db.batch()');
    });

    it('still refusing an anonymous caller before it delegates', () => {
        const body = legacyBody();

        const guard = body.indexOf('await requireSession()');
        const delegate = body.indexOf('await import("@/app/actions/admin/_exports")');

        expect(guard).toBeGreaterThan(-1);
        expect(delegate).toBeGreaterThan(guard);
    });

    it('and reports the canonical implementation\'s refusal rather than swallowing it', () => {
        const body = legacyBody();

        expect(body).toContain('result.success');
        expect(body).toContain('result.error');
    });
});

describe('the canonical one still does everything the legacy skipped', () => {
    // Vacuity guard: delegating to a weaker implementation would be worse than
    // the divergence. Each of the six differences, named.
    const canonical = code(CANONICAL);

    it('writes reviewedBy and reviewedAt', () => {
        expect(canonical).toContain('reviewedBy: session.user.id');
        expect(canonical).toContain('reviewedAt: FieldValue.serverTimestamp()');
    });

    it('sets isVerified, with who and when', () => {
        expect(canonical).toContain('isVerified: true');
        expect(canonical).toContain('verifiedBy: session.user.id');
        expect(canonical).toContain('verifiedAt: FieldValue.serverTimestamp()');
    });

    it('records the export registration as paid and approved', () => {
        expect(canonical).toContain('"serviceRegistrations.export.paymentStatus": "completed"');
        expect(canonical).toContain('"serviceRegistrations.export.approvedAt"');
    });

    it('invalidates the caches an approval has to clear', () => {
        expect(canonical).toContain("invalidateServiceCache(userId, 'export')");
        expect(canonical).toContain('invalidateAdminGlobalStats()');
    });

    it('grants the role', () => {
        expect(canonical).toContain('FieldValue.arrayUnion("export_participant")');
    });

    it('and resolves the application by either identifier', () => {
        expect(canonical).toContain('.where("applicationId", "==", applicationId)');
    });

    it('behind the wider permission check', () => {
        expect(canonical).toContain('hasAdminPermission(session.user.roles, "users:update")');
        expect(canonical).toContain('hasAdminPermission(session.user.roles, "export:approve_applications")');
    });
});

describe('what is wired to what', () => {
    it('the admin page calls the canonical one', () => {
        expect(source(ADMIN_PAGE)).toContain('approveExportOnboardingAction(appId)');
    });

    it('and the legacy one is still barrel-exported, which is why it mattered', () => {
        // Not being called by a page does not make an export unreachable.
        expect(source(BARREL)).toContain('approveExportApplicationAction');
    });
});
