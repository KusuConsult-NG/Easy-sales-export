/**
 * @jest-environment node
 */

/**
 *   #908 A SCREEN THAT SAID "PAYMENT CONFIRMED" ON THE STRENGTH OF A QUERY
 *   STRING.
 *
 *   Found auditing the files no test had named. /marketplace/success read
 *   `?reference` and rendered, unconditionally:
 *
 *       ✓  Payment Successful!
 *          Your order has been placed and payment confirmed
 *          Transaction Reference    <whatever the URL said>
 *
 *   It called nothing and verified nothing.
 *
 * ── THE SEVERITY, MEASURED RATHER THAN ASSERTED ─────────────────────────────
 *
 *   NOTHING LINKS HERE. Every Paystack callback URL in the codebase is
 *   `{baseUrl}/{module}/payment/callback`, the marketplace's own included. This
 *   route was in route-manifest and nowhere else. So the defect is NOT "a buyer
 *   whose payment failed is told it succeeded" — no payment sends anyone here,
 *   and saying otherwise would be the more alarming and less true account.
 *
 *   WHAT IT IS: a page on this platform's own domain, in this platform's own
 *   branding, that tells anybody their payment is confirmed and prints back any
 *   reference they choose. A proof-of-payment screenshot to send a seller. #262
 *   already worked this class — a fabricated reference that reads as a real one.
 *
 * ── AND THE SWEEP SAYS IT WAS THE ONLY ONE ──────────────────────────────────
 *
 *   Eleven screens in src/app contain a payment-success sentence. Triaged one by
 *   one rather than counted:
 *
 *     the five module callbacks     verify — an action or a POST with the
 *                                  reference, and a refusal path
 *     five order and dashboard      render a STORED `payment_received` /
 *     screens                       `payment_confirmed` status off a row, which
 *                                  is a fact and not a claim
 *     marketplace/success          derived the sentence from the URL
 *
 *   That triage is the last test in this file, as a ratchet: a new screen that
 *   claims a payment succeeded must verify or read a row.
 */

import { describe, it, expect } from '@jest/globals';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const raw = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const code = (rel: string) => stripComments(raw(rel), { label: rel });

const RETIRED = 'src/app/marketplace/success/page.tsx';
const CALLBACK = 'src/app/marketplace/payment/callback/page.tsx';

describe('the screen that congratulated without checking', () => {
    it('NO LONGER CLAIMS ANYTHING', () => {
        const src = code(RETIRED);

        expect(src).not.toContain('Payment Successful');
        expect(src).not.toContain('payment confirmed');
        //   And it no longer prints the caller's own string back as the
        //   platform's transaction reference.
        expect(src).not.toContain('Transaction Reference');
    });

    it('AND SENDS THE PERSON TO THE SCREEN THAT VERIFIES', () => {
        const src = code(RETIRED);

        expect(src).toContain('redirect(');
        expect(src).toContain('/marketplace/payment/callback');
    });

    it('AND CARRIES THE REFERENCE, ENCODED', () => {
        /*
         *   A buyer who genuinely has one gets it verified rather than being
         *   asked to find it again. Encoded because it goes into a URL this
         *   page builds — and the value came from a query string.
         */
        const src = code(RETIRED);

        expect(src).toContain('encodeURIComponent(reference)');
        //   And a visit with no reference still lands somewhere sensible; the
        //   callback's own "No payment reference found" takes it from there.
        expect(src).toMatch(/reference\s*\n?\s*\?/);
    });

    it('AND THE SCREEN IT POINTS AT ACTUALLY VERIFIES (control)', () => {
        /*
         *   THE control. A redirect to a screen that congratulated just as
         *   freely would satisfy every assertion above and change nothing.
         */
        const callback = code(CALLBACK);

        expect(callback).toContain('verifyOrderPaymentAction(reference)');
        //   Three states, so a refusal is visible as a refusal.
        expect(callback).toContain('"verifying"');
        expect(callback).toContain('setStatus("error")');
        expect(callback).toContain('Payment verification failed');
    });

    it('AND NO PAYMENT WAS EVER SENT TO THE RETIRED ROUTE (the measurement)', () => {
        /*
         *   The claim the header rests on, asserted rather than asserted-about:
         *   every Paystack callback the platform hands out is a
         *   `{module}/payment/callback`. If somebody ever points a checkout at
         *   /marketplace/success, this fails and the header's account of the
         *   severity stops being true.
         */
        const initiator = code('src/app/actions/marketplace/_payment_orders.ts');

        expect(initiator).toContain('/marketplace/payment/callback');
        expect(initiator).not.toContain('/marketplace/success');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * THE RATCHET, AND WHY IT IS ABOUT THE SOURCE RATHER THAN THE SENTENCE.
 *
 *   The first version of this swept for the SENTENCE — any screen saying a
 *   payment succeeded — and then exempted the ones that verify or render a
 *   stored status. Two things went wrong with that, both caught here rather
 *   than reasoned about:
 *
 *     The pattern was case-sensitive, so it swept past the marketplace callback
 *     itself ("Order payment successful!"), which is the screen the others are
 *     supposed to look like. The control caught it.
 *
 *     Widened, it then flagged export/buyer/cart — whose line is "1. Payment
 *     confirmed automatically via Paystack" inside a "What happens next?" list.
 *     That is a description of the PROCESS, on a screen showing an order
 *     reference it just created. Exempting it would have meant a third
 *     hand-written escape hatch, and each one is somewhere a real instance can
 *     hide.
 *
 *   So the rule is the defect itself: a screen may not tell somebody a payment
 *   succeeded on the strength of something it read from the URL. That is what
 *   /marketplace/success did, it is the only thing wrong with it, and no
 *   legitimate screen needs it — the five module callbacks take the reference
 *   from the URL and then ASK THE SERVER about it.
 */
describe('no screen congratulates on the strength of a URL', () => {
    /** A sentence telling somebody money arrived. */
    const CLAIM = /payment success|payment confirmed|paid successfully|payment received/i;

    /** It took something out of the URL. */
    const READS_THE_URL = /searchParams\.get|useSearchParams|searchParams\s*[:}]/;

    /** It asked the server about it. */
    const VERIFIES = /verify[A-Za-z]*Action|verifyPaystack|JSON\.stringify\(\{ reference \}\)|redirect\(/;

    function screens(dir = join(ROOT, 'src/app'), out: string[] = []): string[] {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) screens(full, out);
            else if (/\.tsx$/.test(entry) && !/__tests__|\.test\./.test(full)) out.push(full);
        }
        return out;
    }

    const all = screens().map((f) => ({ rel: relative(ROOT, f), src: stripComments(readFileSync(f, 'utf8')) }));

    const unbacked = (files: typeof all) => files
        .filter(({ src }) => CLAIM.test(src) && READS_THE_URL.test(src) && !VERIFIES.test(src))
        .map(({ rel }) => rel);

    it('THE SWEEP IS READING THE SCREENS (control)', () => {
        //   THE control on a "nothing matches" assertion, which an empty or
        //   tiny list satisfies for free.
        expect(all.length).toBeGreaterThan(150);
        expect(all.filter(({ src }) => CLAIM.test(src)).length).toBeGreaterThanOrEqual(8);
        expect(all.filter(({ src }) => READS_THE_URL.test(src)).length).toBeGreaterThan(10);
    });

    it('AND NOTHING DOES IT', () => {
        //   THE ratchet. /marketplace/success was the only one.
        expect(unbacked(all)).toEqual([]);
    });

    it('AND THE SWEEP WOULD CATCH IT AGAIN — the canary on its own fault', () => {
        /*
         *   A ratchet that cannot fail is not one. This is the shape the retired
         *   page had, fed to the same predicate: the sentence, a read off the
         *   URL, and nothing asked of the server.
         */
        const asItWas = [{
            rel: 'fixture/old-success-page.tsx',
            src: `const reference = searchParams.get("reference");
                  return <div><h1>Payment Successful!</h1>
                  <p>Your order has been placed and payment confirmed</p>
                  <p>{reference}</p></div>;`,
        }];

        expect(unbacked(asItWas)).toEqual(['fixture/old-success-page.tsx']);
    });

    it('AND IT DOES NOT FLAG A SCREEN THAT VERIFIES, OR ONE DESCRIBING THE PROCESS', () => {
        /*
         *   The two false positives the earlier versions produced, pinned so the
         *   predicate is not quietly narrowed back onto them.
         *
         *   The callback reads the reference off the URL — that is how a Paystack
         *   callback works — and then asks the server. The cart's sentence is a
         *   numbered "what happens next" step beside an order reference it just
         *   created.
         */
        const byRel = (rel: string) => all.filter((f) => f.rel === rel);

        expect(byRel(CALLBACK).length).toBe(1);
        expect(unbacked(byRel(CALLBACK))).toEqual([]);
        expect(unbacked(byRel('src/app/export/buyer/cart/ExportCartClient.tsx'))).toEqual([]);
    });

    it('AND THE RETIRED SCREEN MAKES NO CLAIM AT ALL NOW', () => {
        //   Stronger than "it is backed": the sentence is gone.
        const retired = all.find((f) => f.rel === RETIRED)!;

        expect(retired).toBeDefined();
        expect(CLAIM.test(retired.src)).toBe(false);
    });
});
