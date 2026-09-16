/**
 * @jest-environment node
 */

/**
 *   #810 THE ID CARD ROUTE HAD NO TEST THAT EVER RENDERED A CARD.
 *
 *   /api/id-card/pdf is covered by several suites and every one of them READS
 *   THE SOURCE — that the route calls the action, that the photo host is
 *   checked, that the body is not trusted. All true, all useful, and none of
 *   them would notice if the card stopped rendering at all.
 *
 *   That mattered the moment the watermark went in, because the failure it
 *   risks is not a wrong colour. The route hands a hand-built SVG STRING to
 *   librsvg; one malformed attribute and sharp throws, the catch turns it into
 *   "Failed to generate ID card", and every member's download breaks at once.
 *   No source-reading assertion can see that.
 *
 *   There is also no e2e for this route — the card is not in any spec under
 *   e2e/ — so before this file, nothing on the project executed it.
 *
 * ── WHAT THIS EXECUTES ──────────────────────────────────────────────────────
 *
 *   The real POST handler, with only the session and the membership lookup
 *   stubbed. Everything that actually produces the artefact is the genuine
 *   article: buildSVG, buildBackSVG, the embedded watermark, librsvg via
 *   sharp, and jsPDF assembling both sides.
 *
 *   The photo is deliberately absent so the test makes NO network call — the
 *   placeholder branch renders instead, which is also the branch a member
 *   without a passport photo gets.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     an unclosed tag in the front SVG                                 KILLED
 *     an unclosed tag in the back SVG                                  KILLED
 *     the second page never added (a one-sided card)                   KILLED
 *     reword this header                                   SURVIVED, intended
 *
 *     the watermark's clip-path pointed at a missing id             SURVIVED
 *                        → killed by two-credentials-one-family instead
 *
 *   The survivor is worth reading, because it is the white-box defect itself.
 *   librsvg does NOT error on a dangling `clip-path="url(#nope)"` — it draws
 *   the image UNCLIPPED, so the logo's solid white JPEG background paints a
 *   box across the card. The PDF still comes back 200, two pages, right size.
 *
 *   Nothing this suite can assert would see it: a valid PDF is exactly what
 *   the defect produces. It is caught next door, where the mark is rendered
 *   onto a swatch and the CORNERS of its bounding box are sampled — verified
 *   by applying this same mutation and watching those two tests fail.
 *
 *   Which is the honest division of labour: this suite proves the card still
 *   renders, that one proves what it renders.
 */

import { describe, it, expect } from '@jest/globals';

/*
 *   The GLOBAL jest, not the one from '@jest/globals'. An import of `jest` is
 *   NOT hoisted by babel-plugin-jest-hoist, so `jest.mock()` would run after
 *   the route had already been imported and would SILENTLY DO NOTHING. That
 *   has cost this audit a whole suite of tests that never ran.
 */
jest.mock('@/lib/session-guard', () => ({
    requireSession: jest.fn(async () => ({ session: { user: { id: 'member-1' } } })),
}));

jest.mock('@/app/actions/cooperative', () => ({
    getCooperativeMemberIdCardAction: jest.fn(async () => ({
        success: true,
        data: {
            fullName: 'Amina Ibrahim',
            memberNumber: 'ESE/COOP/2024/00871',
            membershipTier: 'Gold Member',
            gender: 'female',
            stateOfOrigin: 'Kaduna',
            joinedAt: '2024-02-11T00:00:00.000Z',
            validUntil: '2027-02-11T00:00:00.000Z',
            //   No photo: keeps this test off the network entirely.
            passportPhotoUrl: null,
        },
    })),
}));

import { POST } from '@/app/api/id-card/pdf/route';

const request = () => new Request('https://www.easysalesexport.com/api/id-card/pdf', {
    method: 'POST',
    body: JSON.stringify({}),
    headers: { 'content-type': 'application/json' },
}) as never;

// ─────────────────────────────────────────────────────────────────────────────
describe('#810 — the membership card renders end to end', () => {
    it('RETURNS A REAL PDF, not a 500 from a malformed SVG', async () => {
        const res = await POST(request());

        /*
         *   The status is checked FIRST and the body is read on failure,
         *   because the route catches everything and answers 500 with a JSON
         *   message. Asserting on the buffer alone would report "not a PDF"
         *   and hide the reason sharp actually gave.
         */
        if (res.status !== 200) {
            const body = await res.text();
            throw new Error(`expected a rendered card, got ${res.status}: ${body}`);
        }

        expect(res.headers.get('content-type')).toBe('application/pdf');

        const bytes = Buffer.from(await res.arrayBuffer());
        //   A PDF, by its own magic number rather than by the header we set.
        expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
        //   Two rendered 900×567 PNGs. Anything tiny means a page came out blank.
        expect(bytes.length).toBeGreaterThan(50_000);
    }, 30_000);

    it('AND IT IS A TWO-SIDED CARD', async () => {
        /*
         *   The back is where the terms and the issue dates live. It is built
         *   by a second SVG and a second sharp pass, either of which can fail
         *   on its own, so "a PDF came back" is not enough.
         */
        const res = await POST(request());
        expect(res.status).toBe(200);

        const pdf = Buffer.from(await res.arrayBuffer()).toString('latin1');
        const pages = (pdf.match(/\/Type\s*\/Page[^s]/g) ?? []).length;

        expect({ pages }).toEqual({ pages: 2 });
    }, 30_000);
});
