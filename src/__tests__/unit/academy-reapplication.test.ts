/**
 * @jest-environment node
 */

/**
 * "Re-apply after making necessary improvements" — which the code forbade.
 *
 * THE DEFECT
 * ----------
 * _rejectAcademyApplicationAction sets the application to "rejected" and emails
 * the applicant a list headed "What You Can Do" whose last item is
 *
 *     Re-apply after making necessary improvements
 *
 * Nothing stopped a rejected applicant from reaching the submit action: its
 * first guard blocks only `pending` and `under_review`, its second only
 * `approved`. They reached the dedup guard, which was
 *
 *     .where("personalInfo.phone", "==", phone).limit(1)
 *     if (!phoneSnap.empty) throw "An Academy application with this phone
 *                                  number already exists."
 *
 * — and the row it found was their OWN rejected application. So the platform
 * invited them to reapply, then refused permanently, with wording that reads
 * like somebody else had taken their phone number.
 *
 * WAVE already had the right rule (_wv_applications.ts): another account's
 * application is always a conflict; the caller's own is a conflict only while
 * it is still live.
 *
 * AND THE MATCH WAS LITERAL
 * -------------------------
 * The form stored the email exactly as typed. Three lookups query
 * `personalInfo.email == userData.email.toLowerCase()`, and user emails are
 * lowercased at registration (actions/auth.ts):
 *
 *   checkAcademyStatusAction            _ac_enrollment.ts
 *   checkAcademyPaymentStatusAction     _payment.ts
 *   module-access-check Layer 2.7       — which GRANTS academy module access
 *
 * An applicant who typed one capital letter was invisible to all three, and
 * could submit a second application by varying the case.
 *
 * AND THE SCAN WAS ONE ROW
 * ------------------------
 * `.limit(1)` meant whichever row the database returned first decided. With one
 * of the caller's own rows beside somebody else's, the answer depended on row
 * order.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { normalisePhone } from '@/lib/phone';

const SUBMIT = 'src/app/actions/academy/_ac_applications.ts';
const REJECT = 'src/app/actions/academy/_ac_admin_review.ts';

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

/** The submit action's body, isolated from the rest of the file. */
function submitBody(): string {
    const src = code(SUBMIT);
    const start = src.indexOf('async function _submitAcademyApplicationAction');
    const end = src.indexOf('export const submitAcademyApplicationAction');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return src.slice(start, end);
}

describe('the invitation the rejection email sends', () => {
    it('really does tell the applicant to re-apply', () => {
        // Without this the rest of the suite is arguing with nobody.
        expect(source(REJECT)).toContain('Re-apply after making necessary improvements');
    });

    it('and nothing before the dedup guard stops a rejected applicant', () => {
        // The two earlier guards name only pending/under_review and approved,
        // so "rejected" reaches the dedup check.
        const body = submitBody();

        expect(body).toContain("existingStatus === 'pending' || existingStatus === 'under_review'");
        expect(body).toContain("existingStatus === 'approved'");
        expect(body).not.toContain("existingStatus === 'rejected'");
    });
});

describe('the dedup guard', () => {
    it('no longer refuses on any match at all', () => {
        // THE test. Both halves used to be `if (!snap.empty) throw`.
        const body = submitBody();

        expect(body).not.toContain('An Academy application with this phone number already exists.');
        expect(body).not.toContain('An Academy application with this email already exists.');
    });

    it('refuses another account\'s application whatever its status', () => {
        const body = submitBody();

        expect(body).toContain('doc.data().userId !== session.user.id');
        expect(body).toContain('already exists under a different account');
    });

    it('and refuses the caller\'s own only while it is still live', () => {
        const body = submitBody();

        // rejected and revision_required are finished; anything else is open.
        expect(body).toContain("status !== \"rejected\" && status !== \"revision_required\"");
        expect(body).toContain('is currently ${status');
    });

    it('checks the foreign owner across ALL rows before clearing any of them', () => {
        // Two separate passes, not one loop that returns on the first row: with
        // the caller's own row first, a single pass would clear the check and
        // never see the foreign one.
        const body = submitBody();
        const guard = body.slice(body.indexOf('const conflict ='));

        const foreignPass = guard.indexOf('!== session.user.id');
        const statusPass = guard.indexOf('status !== "rejected"');

        expect(foreignPass).toBeGreaterThan(-1);
        expect(statusPass).toBeGreaterThan(foreignPass);
    });

    it('and scans more than one row', () => {
        const body = submitBody();

        expect(body).toContain('DUPLICATE_SCAN_LIMIT');
        expect(body).not.toContain('.where("personalInfo.phone", "==", phone).limit(1)');
        expect(code(SUBMIT)).toMatch(/const DUPLICATE_SCAN_LIMIT = \d+/);
    });
});

describe('the identity it matches on', () => {
    it('stores the email lowercased, which is what the readers look for', () => {
        const body = submitBody();

        expect(body).toContain('.trim().toLowerCase()');
        expect(body).toContain('email: normalisedEmail,');
    });

    it('and writes it AFTER the spread, so the typed casing does not win', () => {
        const body = submitBody();
        const write = body.slice(body.indexOf('t.set(appRef, {'));
        const spread = write.indexOf('...applicationData,');
        const override = write.indexOf('email: normalisedEmail,');

        expect(spread).toBeGreaterThan(-1);
        expect(override).toBeGreaterThan(spread);
    });

    it.each([
        ['src/app/actions/academy/_ac_enrollment.ts', 'checkAcademyStatusAction'],
        ['src/app/actions/academy/_payment.ts', 'checkAcademyPaymentStatusAction'],
    ])('%s (%s) is the reader that needed it', (rel: string) => {
        // Each of these queries the lowercased form. The write above is what
        // makes them able to find the row at all.
        expect(code(rel)).toContain('.where("personalInfo.email", "==", userData.email.toLowerCase())');
    });

    it('and module-access-check Layer 2.7 — the academy access grant — still does', () => {
        /**
         * Checked as a PROPERTY rather than as that literal.
         *
         * Layer 2.7's lookup moved into unclaimedApplicationForEmail, the one
         * function all four email fallbacks now share, so the address field and
         * the lowercasing are no longer on the same line. Both still have to
         * hold, and asserting the literal would have made a refactor look like
         * a regression — which is exactly what it did before this was rewritten.
         */
        const body = code('src/lib/module-access-check.ts');

        // The field this layer matches on is still personalInfo.email.
        expect(body).toContain('COLLECTIONS.ACADEMY_APPLICATIONS, userData.email, "Academy"');
        expect(body).toContain('["personalInfo.email"]');

        // And the shared lookup lowercases before it queries.
        const helper = body.slice(body.indexOf('async function unclaimedApplicationForEmail'));
        const normalise = helper.indexOf('.toLowerCase().trim()');
        const query = helper.indexOf('.where(field, "==", normalised)');
        expect(normalise).toBeGreaterThan(-1);
        expect(query).toBeGreaterThan(normalise);
    });

    it('matches the phone in both the typed and the E.164 form', () => {
        // Rows already exist in each, so querying one form alone misses the
        // other — 08012345678 and +2348012345678 are the same person.
        const body = submitBody();

        expect(body).toContain('normalisePhone(phone)');
        expect(body).toContain('"personalInfo.phone", "in", phoneForms');

        expect(normalisePhone('08012345678')).toBe('+2348012345678');
        expect(normalisePhone('+2348012345678')).toBe('+2348012345678');
    });

    it('and does not send a null into that query when the phone is unparseable', () => {
        // normalisePhone returns null for what it cannot read; a null in the
        // `in` list would match rows whose phone is absent.
        const body = submitBody();

        expect(body).toContain('.filter(Boolean)');
        expect(normalisePhone('not a phone')).toBeNull();
    });
});
