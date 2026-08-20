/**
 * @jest-environment node
 */

/**
 * Three smaller academy admin defects, each of the same shape: a decision made
 * against a value that had already changed, or against a second copy of a rule.
 *
 * 1. NO COURSE CREATION WAS EVER AUDIT-LOGGED AS ONE
 *
 *    _upsertAcademyCourseAction ended with
 *
 *        action: courseId === "new" ? "CREATE_COURSE" : "UPDATE_COURSE"
 *
 *    and the create branch above it does `courseId = newRef.id`. So by the time
 *    the question was put, courseId could never be "new". Every course creation
 *    was recorded as UPDATE_COURSE, and the audit log has never contained a
 *    CREATE_COURSE entry from this action.
 *
 * 2. ONE RECORDING OVERWROTE EVERY PAST WEEK
 *
 *    _endAcademyLiveSessionAction, when no session is live and a recordingUrl is
 *    supplied, fetched EVERY ended session of the course and the loop stamped
 *    the url onto all of them. /academy/live lists recordings as
 *    `status === "ended" && s.recordingUrl`, so a course with a weekly live
 *    class had every previous week point at the newest video.
 *
 * 3. TWO APPROVAL ENDPOINTS THAT DID NOT AGREE
 *
 *    academy/index.ts calls the _ac_admin_review.ts one "canonical" and excludes
 *    the _ac_applications.ts one from the barrel as "a legacy duplicate".
 *    Excluding it from the barrel does nothing: the file is "use server", so the
 *    export is a reachable HTTP endpoint regardless. The two disagreed on the
 *    guard, on the field names they wrote, on isVerified, on cache invalidation
 *    and on whether anything was audit-logged at all.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

const ADMIN_CATALOG = 'src/app/actions/academy/_ac_admin_catalog.ts';
const LIVE = 'src/app/actions/academy/_ac_live.ts';
const APPLICATIONS = 'src/app/actions/academy/_ac_applications.ts';
const REVIEW = 'src/app/actions/academy/_ac_admin_review.ts';
const BARREL = 'src/app/actions/academy/index.ts';
const LIVE_PAGE = 'src/app/academy/live/page.tsx';

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

describe('the course upsert audit entry', () => {
    it('decides which it is before courseId is reassigned', () => {
        // THE test.
        const src = code(ADMIN_CATALOG);

        expect(src).not.toContain('action: courseId === "new" ? "CREATE_COURSE" : "UPDATE_COURSE"');
        expect(src).toContain('const isNew = courseId === "new"');
        expect(src).toContain('action: isNew ? "CREATE_COURSE" : "UPDATE_COURSE"');
    });

    it('and the reassignment that broke it is still there', () => {
        // Vacuity guard: if the reassignment were gone, the old code would have
        // been fine and this test would be pinning nothing.
        const src = code(ADMIN_CATALOG);

        expect(src).toContain('courseId = newRef.id;');

        const decided = src.indexOf('const isNew = courseId === "new"');
        const reassigned = src.indexOf('courseId = newRef.id;');
        expect(decided).toBeGreaterThan(-1);
        expect(reassigned).toBeGreaterThan(decided);
    });

    it('while the entry still records the id the course actually got', () => {
        // resourceId must be the new document's id, not the string "new".
        const src = code(ADMIN_CATALOG);
        const audit = src.slice(src.indexOf('await logAuditAction('));

        expect(audit.slice(0, 300)).toContain('resourceId: courseId');
    });
});

describe('attaching a recording after the fact', () => {
    it('touches one session, not every ended one', () => {
        // THE test.
        const src = code(LIVE);

        expect(src).not.toContain('snapshot = await ref.where("courseId", "==", courseId).where("status", "==", "ended").get();');
        expect(src).toContain('.limit(1)');
    });

    it('and picks the most recent one rather than whatever came back first', () => {
        const src = code(LIVE);
        const fallback = src.slice(src.indexOf('if (snapshot.empty && recordingUrl)'));

        expect(fallback.slice(0, 500)).toContain('.orderBy("scheduledAt", "desc")');
    });

    it('which matters because the page lists recordings by that flag', () => {
        // Vacuity guard: without this reader the overwrite would be invisible.
        expect(source(LIVE_PAGE)).toContain('s.status === "ended" && s.recordingUrl');
    });

    it('and the live-session lookup itself is unchanged', () => {
        // The fallback is only for the no-live-session case; ending a session
        // that IS live must still end every live row for that course.
        const src = code(LIVE);

        expect(src).toContain('ref.where("courseId", "==", courseId).where("status", "==", "live").get()');
    });
});

describe('the two approval endpoints', () => {
    it('the legacy one delegates instead of reimplementing', () => {
        // THE test.
        const src = code(APPLICATIONS);
        const fn = src.slice(src.indexOf('async function _approveAcademyApplicationAction'));
        const body = fn.slice(0, fn.indexOf('\nexport const approveAcademyApplicationAction'));

        expect(body).toContain('await import("./_ac_admin_review")');
        expect(body).toContain('canonical(applicationId)');
    });

    it('and no longer carries its own guard, field names or email', () => {
        const src = code(APPLICATIONS);
        const fn = src.slice(src.indexOf('async function _approveAcademyApplicationAction'));
        const body = fn.slice(0, fn.indexOf('\nexport const approveAcademyApplicationAction'));

        // The divergent pieces, each named.
        expect(body).not.toContain("roles?.includes('admin')");
        expect(body).not.toContain('approvedBy: session.user.id');
        expect(body).not.toContain('approvedAt: FieldValue.serverTimestamp()');
        expect(body).not.toContain('resend.emails.send');
    });

    it('still refusing an anonymous caller before it delegates', () => {
        const src = code(APPLICATIONS);
        const fn = src.slice(src.indexOf('async function _approveAcademyApplicationAction'));
        const body = fn.slice(0, fn.indexOf('\nexport const approveAcademyApplicationAction'));

        const guard = body.indexOf('await requireSession()');
        const delegate = body.indexOf('await import("./_ac_admin_review")');
        expect(guard).toBeGreaterThan(-1);
        expect(delegate).toBeGreaterThan(guard);
    });

    it('and the canonical one still does everything the other skipped', () => {
        // Vacuity guard: delegating to a weaker implementation would be worse
        // than the divergence. These are the four things the legacy copy omitted.
        const src = code(REVIEW);
        const fn = src.slice(src.indexOf('async function _approveAcademyApplicationAction'));

        expect(fn).toContain('isVerified: true');
        expect(fn).toContain('invalidateServiceCache');
        expect(fn).toContain('createAdminAuditLog');
        expect(fn).toContain('reviewedBy: session.user.id');
    });

    it('and its guard is the wider one — academy_admin included', () => {
        const src = code(REVIEW);

        expect(src).toContain('hasAdminPermission(session.user.roles, "users:update")');
        expect(src).toContain('session.user.roles?.includes("academy_admin")');
    });

    it('the barrel still names the canonical one, and only it', () => {
        const src = source(BARREL);
        const fromReview = src.slice(src.indexOf('} from "./_ac_admin_review"') - 400);

        expect(fromReview).toContain('approveAcademyApplicationAction');

        // And the applications re-export still omits it.
        const fromApps = src.slice(src.indexOf('from "./_ac_applications"') - 300, src.indexOf('from "./_ac_applications"'));
        expect(fromApps).not.toContain('approveAcademyApplicationAction');
    });
});
