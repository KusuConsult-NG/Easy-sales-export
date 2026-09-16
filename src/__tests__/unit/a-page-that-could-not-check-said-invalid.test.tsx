/**
 * @jest-environment jsdom
 */

/**
 *   #796 THE VERIFICATION PAGE TOLD AN EMPLOYER A REAL CERTIFICATE WAS FAKE.
 *
 *   /academy/verify/[certificateId] is the page a THIRD PARTY lands on from a
 *   printed credential — the one screen whose entire job is to answer "is this
 *   person telling the truth". Its server half resolves the certificate before
 *   the page is sent. Only a FAILED server read seeds null, and then the
 *   browser asks the API route instead.
 *
 *   So the browser fallback runs PRECISELY WHEN SOMETHING HAS ALREADY GONE
 *   WRONG. And it read one field:
 *
 *       const data = await response.json();
 *       if (data.success) { … } else { setError(data.message || "…") }
 *
 *   `response.ok` and `response.status` were never looked at. The route answers
 *   404 for "not found or invalid" and 500 for "verification failed" — its own
 *   header says so — and both arrive as `success: false`. Both rendered:
 *
 *       ✗  Certificate Not Found
 *          This certificate ID does not exist in our records.
 *
 *   A red cross and an accusation of forgery, printed for an employer, because
 *   a server had a bad minute. The graduate is not present to argue.
 *
 * ── THE RULE WAS ALREADY WRITTEN DOWN. TWICE. ───────────────────────────────
 *
 *   page.tsx, in its own header:
 *
 *       "A resolved 'not found' is seeded as an answer. Only a FAILED read
 *        seeds null … — a page that could not check must not say 'invalid'."
 *
 *   and the seed type, in the client itself:
 *
 *       "`null` means the server could not resolve it — not that the
 *        certificate is invalid. Those are different answers and THE CLIENT
 *        TELLS THEM APART, which is why the whole result is passed rather than
 *        a boolean."
 *
 *   The client did not tell them apart. A comment asserting the behaviour, the
 *   server half implementing it, the browser half not — this audit's most
 *   repeated finding, in its strongest form yet: the rule is not missing, it is
 *   stated and half-applied.
 *
 *   #588 named the same collapse for lists ("a refusal and an empty result
 *   collapsed into one branch") and #793 for forms. Here the collapsed pair is
 *   "we could not check" and "this is fake", and the cost lands on a member's
 *   reputation in front of somebody else.
 *
 * ── EXECUTED, NOT GREPPED ───────────────────────────────────────────────────
 *
 *   Every assertion below RENDERS the component against a stubbed fetch and
 *   reads the words on the screen. #741's trap — an assertion satisfied by the
 *   wrong occurrence — has been met nine times in this audit and every one was
 *   a test matching source text. There is no source text matching here.
 *
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *     the 404 branch removed, so not-found becomes "could not check"   KILLED
 *     `response.status === 404` widened to `>= 400`                    KILLED
 *     the network catch sets error instead of unavailable              KILLED
 *     the unavailable panel reinstated with the accusation             KILLED
 *     the reassurance replaced by "does not exist in our records"      KILLED
 *     the unavailable panel loses its retry                            KILLED
 *     a real 404 reported as "could not check" (the inverse)           KILLED
 *     reword a comment / unmutated baseline               SURVIVED, both intended
 *
 *     `response.ok` unchecked again — THE ORIGINAL DEFECT           SURVIVED
 *                                             → then, two tests:   KILLED
 *     a 200 with no certificate treated as a verdict               SURVIVED
 *                                             → then, two tests:   KILLED
 *
 *   BOTH SURVIVORS ARE RECORDED BECAUSE THE FIRST ONE IS DAMNING. Deleting the
 *   `!response.ok` guard — restoring the exact defect this finding is about —
 *   left the suite GREEN. Every case I had written reached "could not check"
 *   by the other road, through the success check further down, so nothing
 *   asserted that the STATUS LINE is read at all.
 *
 *   The case that separates them is the one that should have been written
 *   first: a 500 carrying a success body must not put a green tick and
 *   somebody's name on this page. The second survivor is its mirror — a 200
 *   claiming success with no certificate — which reached the accusation
 *   through `setVerification(undefined)`.
 *
 *   A suite that passes for the wrong reason is the same trap as an assertion
 *   satisfied by the wrong occurrence, and this is the tenth time this audit
 *   has met it. The sweep is why it was caught; reading the tests was not.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import CertificateVerificationClient from '@/app/academy/verify/[certificateId]/CertificateVerificationClient';

/** The sentence the old screen printed for BOTH answers. */
const ACCUSATION = /does not exist in our records|Certificate Not Found/i;
/** The sentence that must appear when nothing was successfully looked up. */
const HONEST = /could not check/i;

function stubFetch(impl: () => Promise<unknown>) {
    (global as any).fetch = jest.fn(impl as any);
}

/** A response object with only the parts the component touches. */
function res(status: number, body: unknown, { badJson = false } = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => {
            if (badJson) throw new SyntaxError('Unexpected token < in JSON at position 0');
            return body;
        },
    };
}

const CERT = {
    id: 'cert-1',
    userName: 'Amina Ibrahim',
    courseTitle: 'Export Documentation',
    completionDate: new Date('2026-01-15T00:00:00.000Z'),
    grade: 82,
    isValid: true,
};

//   `initial={null}` is the ONLY state that reaches the browser fetch, and it
//   is the state a failed server read produces. Passing anything else would
//   test a path this finding is not about.
const renderFallback = () =>
    render(<CertificateVerificationClient certificateId="cert-1" initial={null} />);

let originalFetch: unknown;
beforeEach(() => { originalFetch = (global as any).fetch; });
afterEach(() => { (global as any).fetch = originalFetch; jest.restoreAllMocks(); });

// ─────────────────────────────────────────────────────────────────────────────
describe('#796 — a page that could not check must not say "invalid"', () => {
    it('A 500 DOES NOT ACCUSE ANYBODY', async () => {
        //   THE test. This is the exact response the route returns when the
        //   lookup throws, and the exact case the browser fallback exists for.
        stubFetch(async () => res(500, { success: false, message: 'Verification failed' }));
        renderFallback();

        await waitFor(() => expect(screen.getByText(HONEST)).toBeTruthy());
        expect(screen.queryAllByText(ACCUSATION)).toHaveLength(0);
    });

    it('and it says the sentence the holder needs said', async () => {
        stubFetch(async () => res(500, { success: false, message: 'Verification failed' }));
        renderFallback();

        await waitFor(() => expect(screen.getByText(HONEST)).toBeTruthy());
        expect(screen.getByText(/does not mean the certificate is invalid/i)).toBeTruthy();
    });

    it('and it offers a way to ask again, because the answer may differ', async () => {
        stubFetch(async () => res(500, { success: false, message: 'Verification failed' }));
        renderFallback();

        await waitFor(() => expect(screen.getByText(HONEST)).toBeTruthy());
        expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
    });

    it('A NETWORK FAILURE is the same answer — nothing was asked', async () => {
        stubFetch(async () => { throw new TypeError('Failed to fetch'); });
        renderFallback();

        await waitFor(() => expect(screen.getByText(HONEST)).toBeTruthy());
        expect(screen.queryAllByText(ACCUSATION)).toHaveLength(0);
    });

    it('A 200 WHOSE BODY WILL NOT PARSE is not a verdict either', async () => {
        //   An HTML error page served with a 200 by a proxy. The old code let
        //   this throw into the catch and come out as "not found".
        stubFetch(async () => res(200, null, { badJson: true }));
        renderFallback();

        await waitFor(() => expect(screen.getByText(HONEST)).toBeTruthy());
        expect(screen.queryAllByText(ACCUSATION)).toHaveLength(0);
    });

    it('A NON-OK RESPONSE NEVER VERIFIES, whatever its body claims', async () => {
        /*
         *   FOUND BY THE SWEEP. Removing `if (!response.ok)` entirely SURVIVED
         *   the first draft of this suite: every case I had written reached
         *   "could not check" by the other road, through the success check
         *   below. So the assertion that the status line is read at all was
         *   not being made — the original defect could have been restored and
         *   the suite would have stayed green.
         *
         *   This is the case that separates them, and it is the one that
         *   matters most: a 500 carrying a success body must NOT put a green
         *   tick and somebody's name on this page.
         */
        stubFetch(async () => res(500, { success: true, certificate: CERT }));
        renderFallback();

        await waitFor(() => expect(screen.getByText(HONEST)).toBeTruthy());
        expect(screen.queryAllByText('Amina Ibrahim')).toHaveLength(0);
    });

    it('A 200 THAT CLAIMS SUCCESS BUT CARRIES NO CERTIFICATE does not accuse', async () => {
        //   Also found by the sweep. `data.success` alone would setVerification
        //   (undefined), fall through to `!verification`, and print the
        //   accusation — the original defect reached by a different door.
        stubFetch(async () => res(200, { success: true }));
        renderFallback();

        await waitFor(() => expect(screen.getByText(HONEST)).toBeTruthy());
        expect(screen.queryAllByText(ACCUSATION)).toHaveLength(0);
    });

    it('A 200 THAT SAYS success:false is incoherent, not a verdict', async () => {
        //   The route never sends this — a refusal always carries 404 or 500.
        //   An answer the route cannot have given is not one to accuse on.
        stubFetch(async () => res(200, { success: false, message: 'Certificate not found' }));
        renderFallback();

        await waitFor(() => expect(screen.getByText(HONEST)).toBeTruthy());
        expect(screen.queryAllByText(ACCUSATION)).toHaveLength(0);
    });

    it('A 502 from a gateway is not a verdict either', async () => {
        stubFetch(async () => res(502, { error: 'Bad Gateway' }));
        renderFallback();

        await waitFor(() => expect(screen.getByText(HONEST)).toBeTruthy());
        expect(screen.queryAllByText(ACCUSATION)).toHaveLength(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#796 — and the real answers still arrive unchanged', () => {
    it('CONTROL: a 404 STILL says not found', async () => {
        /*
         *   Or this finding would have replaced "a real certificate called
         *   fake" with "a fake certificate called unverifiable", which is the
         *   same defect pointed the other way — and worse, because this page
         *   exists to catch exactly that.
         */
        stubFetch(async () => res(404, { success: false, message: 'Certificate not found or invalid' }));
        renderFallback();

        await waitFor(() => expect(screen.getByRole('heading', { name: /Certificate Not Found/i })).toBeTruthy());
        expect(screen.queryAllByText(HONEST)).toHaveLength(0);
    });

    it('CONTROL: a 404 keeps the route\'s own wording', async () => {
        stubFetch(async () => res(404, { success: false, message: 'Certificate not found or invalid' }));
        renderFallback();

        await waitFor(() => expect(screen.getByText(/not found or invalid/i)).toBeTruthy());
    });

    it('CONTROL: a 404 WITHOUT a JSON body is still a 404', async () => {
        stubFetch(async () => res(404, null, { badJson: true }));
        renderFallback();

        await waitFor(() => expect(screen.getByRole('heading', { name: /Certificate Not Found/i })).toBeTruthy());
        expect(screen.queryAllByText(HONEST)).toHaveLength(0);
    });

    it('CONTROL: a genuine certificate still verifies', async () => {
        stubFetch(async () => res(200, { success: true, certificate: CERT }));
        renderFallback();

        await waitFor(() => expect(screen.getByText('Amina Ibrahim')).toBeTruthy());
        expect(screen.queryAllByText(HONEST)).toHaveLength(0);
        expect(screen.queryAllByText(/does not exist in our records/i)).toHaveLength(0);
    });

    it('CONTROL: a server-seeded "not found" never reaches the browser at all', async () => {
        //   The seeded path is the common one and this finding must not touch
        //   it. If fetch is called here, the server's answer was discarded.
        stubFetch(async () => res(500, { success: false }));
        render(<CertificateVerificationClient certificateId="cert-1" initial={{ found: false }} />);

        await waitFor(() => expect(screen.getByRole('heading', { name: /Certificate Not Found/i })).toBeTruthy());
        expect((global as any).fetch).not.toHaveBeenCalled();
    });
});
