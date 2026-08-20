/**
 * @jest-environment node
 */

/**
 * Finding #82 — the certificate number carried the SERVER's year.
 *
 * academy-certificate.ts opens with "one, and the same everywhere", and the
 * defect it was written to fix was a number that differed between the page, the
 * PDF and the LinkedIn entry. The year was still `completedAt.getFullYear()`,
 * which is the year in the host's timezone: a completion stamped
 * 2025-12-31T23:00:00Z is 2025 on a UTC host and 2026 in Lagos.
 *
 * So the same completion could print two different identifiers depending on
 * where the process ran — a deployment region change would have been enough.
 * Now derived from the stored instant in UTC.
 *
 * Found by running the existing suite under TZ=Africa/Lagos while measuring
 * finding #81; academy-certificate-issuance.test.ts's own year assertion was
 * the only production-code failure in 4,546 tests.
 */

import { describe, it, expect } from '@jest/globals';
import { academyCertificateNumber } from '@/lib/academy-certificate';

describe('the certificate number under a non-UTC server timezone (finding #82)', () => {
    it('the process really is east of UTC', () => {
        expect(process.env.TZ).toBe('Africa/Lagos');
        expect(new Date('2025-12-31T23:00:00.000Z').getFullYear()).toBe(2026);
    });

    it('takes the year from the stored instant, not from the host', () => {
        // The local year here is 2026. Pre-fix this produced ACAD-2026-… on
        // this host and ACAD-2025-… on a UTC one, for the same completion.
        expect(academyCertificateNumber('u', 'c', new Date('2025-12-31T23:00:00.000Z')))
            .toContain('-2025-');
    });

    it('agrees with what a UTC host produces, for the whole number', () => {
        const completedAt = new Date('2025-12-31T23:30:00.000Z');
        // Hard-coded rather than recomputed, so this compares against the UTC
        // host's answer and not against whatever this host happens to say.
        expect(academyCertificateNumber('user-aaaaaa', 'course-zzzzzz', completedAt))
            .toBe('ACAD-2025-COURSE-USERAA');
    });

    it('is unaffected mid-year, so the fix is about the boundary only', () => {
        expect(academyCertificateNumber('u', 'c', new Date('2026-03-04T00:00:00.000Z')))
            .toContain('-2026-');
    });
});
