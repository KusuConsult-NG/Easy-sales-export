/**
 * @jest-environment node
 */

/**
 *   #562 ALL OR NOTHING — THE RULE EVERY CONVERTED SERVER PAGE STATES AND NONE
 *        OF THEM HAD EVER BEEN TESTED ON.
 *
 *   Thirty-odd server halves written across batches 1–15 carry some version of
 *   this comment:
 *
 *       "All or nothing: a half-walked chain is a seed present while the rest
 *        still fetches, the failure the ledger warns about."
 *
 *   The rule is real. A client handed a seed stops fetching — that is what a
 *   seed IS — so seeding one of two lists and not the other leaves a screen
 *   that looks loaded and is half empty, with no spinner and no error to say
 *   so. It is strictly worse than not seeding at all, because the unseeded
 *   fallback would have fetched both.
 *
 *   It had never been checked. Mutation testing on #563's suite made that
 *   plain: changing /dashboard/certificates from `&&` to `||` — from
 *   all-or-nothing to any-or-nothing — changed no test. A surviving mutant
 *   tells you what your check is actually asking, and that one said the rule
 *   was a comment.
 *
 *   This exercises the server page itself: mock the two readers, fail one, and
 *   look at what reaches the client.
 *
 * ── WHY THIS PAGE, AND NOT ALL THIRTY ───────────────────────────────────────
 *
 *   Because a test per page would be thirty copies of one assertion, which is
 *   the shape this audit keeps finding as a defect. This is the page where the
 *   partial case is most visible — two independent lists, either of which can
 *   fail on its own — and the rule is the same everywhere it is written.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     `&&` changed to `||` in the completeness test    KILLED (2 tests)
 *     the academy read's failure ignored               KILLED (2)
 *     reword this header                               SURVIVED, as intended
 *
 * ── AND THE FIRST RUN FOUND A SECOND GUARD, NOT A BUG ───────────────────────
 *
 *   The `||` mutant SURVIVED at first, and the reason was not that the test was
 *   weak. The page carried the rule twice: a `complete` flag AND a second
 *   `&& uploaded && academy` in the JSX. Flipping the flag changed nothing
 *   because the other guard still held.
 *
 *   Two guards for one rule is a rule with no home — the same thing #558's
 *   surviving mutants said about the seller-products fetch. The page states it
 *   once now, and the mutant dies.
 */

import React from 'react';

const readers = {
    readUploadedCertificates: jest.fn(),
    readAcademyCertificates: jest.fn(),
};

jest.mock('@/lib/auth', () => ({ auth: jest.fn(async () => ({ user: { id: 'u1' } })) }));
jest.mock('@/lib/certificates-reader', () => ({
    readUploadedCertificates: (...a: any[]) => readers.readUploadedCertificates(...a),
    readAcademyCertificates: (...a: any[]) => readers.readAcademyCertificates(...a),
}));
//   The client is replaced by a marker so the page's OUTPUT can be inspected
//   without rendering anything.
jest.mock('@/app/dashboard/certificates/CertificatesClient', () => ({
    __esModule: true,
    default: () => null,
}));

const UPLOADED = [{ id: 'up1', fileName: 'NAFDAC.pdf' }];
const ACADEMY = { certificates: [{ id: 'ac1', courseName: 'Export Documentation' }], cursor: null, hasMore: false };

/** Render the async server component to an element and read the seed off it. */
async function seedFrom(): Promise<any> {
    const { default: CertificatesPage } = await import('@/app/dashboard/certificates/page');
    const element = await CertificatesPage();
    return (element as React.ReactElement<{ initial: unknown }>).props.initial;
}

beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#562 — a page seeds both lists or neither', () => {
    it('BOTH READS SUCCEED — the client is handed both lists', async () => {
        readers.readUploadedCertificates.mockResolvedValue(UPLOADED);
        readers.readAcademyCertificates.mockResolvedValue(ACADEMY);

        const seed = await seedFrom();

        expect(seed).toEqual({ uploaded: UPLOADED, academy: ACADEMY.certificates });
    });

    it('THE ACADEMY READ FAILS — the client is handed NOTHING, not half', async () => {
        //   THE CLAIM. With `||` instead of `&&`, this returns
        //   { uploaded, academy: undefined } and the screen renders an empty
        //   academy tab that looks like a learner with no certificates.
        readers.readUploadedCertificates.mockResolvedValue(UPLOADED);
        readers.readAcademyCertificates.mockRejectedValue(new Error('database unavailable'));

        expect(await seedFrom()).toBeNull();
    });

    it('THE UPLOADED READ FAILS — the same, in the other direction', async () => {
        readers.readUploadedCertificates.mockRejectedValue(new Error('database unavailable'));
        readers.readAcademyCertificates.mockResolvedValue(ACADEMY);

        expect(await seedFrom()).toBeNull();
    });

    it('BOTH FAIL — still nothing, and the client still falls back', async () => {
        readers.readUploadedCertificates.mockRejectedValue(new Error('down'));
        readers.readAcademyCertificates.mockRejectedValue(new Error('down'));

        expect(await seedFrom()).toBeNull();
    });

    it('AND A FAILED READ DOES NOT THROW THE PAGE', async () => {
        //   The other half of what the seed promises: it is an OPTIMISATION.
        //   Making a seed failure fatal would take a working screen and break
        //   it to save a round trip.
        readers.readUploadedCertificates.mockRejectedValue(new Error('down'));
        readers.readAcademyCertificates.mockRejectedValue(new Error('down'));

        await expect(seedFrom()).resolves.toBeNull();
    });
});
