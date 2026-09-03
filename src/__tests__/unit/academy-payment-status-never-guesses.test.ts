/**
 * @jest-environment node
 */

/**
 *   #316 "HAVE YOU PAID?" ANSWERED "NO" WHENEVER IT COULD NOT TELL.
 *
 *        checkAcademyPaymentStatusAction ended in this catch:
 *
 *            } catch (error) {
 *                logger.error("Check academy payment status error:", {...});
 *                return { error: null, success: true as const, data: "unpaid" };
 *            }
 *
 *        A database failure asserted a DEFINITIVE "this learner has not paid",
 *        with success:true and no error. #313's shape, one module over, on
 *        money — and it fails in the direction that harms the person who DID
 *        pay.
 *
 *        AND IT DEFEATED THE CALLER THAT WAS DOING THE RIGHT THING.
 *        academy/(learner)/layout.tsx guards its hard redirect like this:
 *
 *            // Only hard-redirect if the payment check definitively confirms
 *            // unpaid. If the action fails or returns an unexpected value,
 *            // allow access so the dashboard can handle the state itself
 *            if (payStatus.success && payStatus.data === "unpaid") { ... }
 *
 *        Somebody thought about exactly this and wrote the guard for it.
 *        success:true made it unreachable, so a transient read error threw a
 *        paid learner out of the academy and into /academy/application — which
 *        opens on the payment step and offers to charge them again.
 *
 *        That is now the third time in this audit that an endpoint reporting
 *        success on failure has silently disarmed a caller's correct check:
 *        #296 (a 403 read as "no orphaned users"), #313 (/profile's MFA guard),
 *        and this.
 *
 * THE PART THAT NEEDED CARE
 * -------------------------
 * Fixing the action ALONE would have made things worse. Three of the five call
 * sites in academy/application/page.tsx read `payStatus.data === "unpaid"`, and
 * `null === "unpaid"` is false — so an unreadable status would have fallen into
 * the ELSE branch and been treated as PAID, sending an unpaid learner to the
 * dashboard. The action and its callers had to move together, which is why the
 * page now routes every read through one `readPaymentStatus()` helper that
 * returns "paid" | "unpaid" | null and no site reads `.data` directly.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

const APPLICATION = 'src/app/academy/application/page.tsx';
const LAYOUT = 'src/app/academy/(learner)/layout.tsx';
const SETUP = 'src/app/academy/setup/page.tsx';
const DASHBOARD = 'src/app/academy/dashboard/page.tsx';

// ─────────────────────────────────────────────────────────────────────────────
describe('#316 — the action, executed against a failing database', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    async function callStatus(userGet: () => any, extra: Record<string, any> = {}) {
        jest.doMock('@/lib/supabase-db', () => ({
            supabaseDb: {
                collection: (name: string) => ({
                    doc: () => ({ get: userGet }),
                    where: function () { return this; },
                    limit: function () { return this; },
                    get: () => Promise.resolve(extra[name] ?? { empty: true, docs: [] }),
                }),
            },
        }));
        const mod = await import('@/app/actions/academy/_payment');
        return (await mod.checkAcademyPaymentStatusAction()) as any;
    }

    it('SAYS IT COULD NOT TELL, rather than "unpaid"', async () => {
        // THE test. The old body was { success: true, data: "unpaid" }.
        const res = await callStatus(() => {
            throw new Error('connection refused');
        });

        expect(res.success).toBe(false);
        expect(res.data).toBeNull();
        // Not "unpaid" under any key — there is nothing for a caller to misread.
        expect(JSON.stringify(res)).not.toContain('unpaid');
    });

    it('and still answers "paid" when the row says so', async () => {
        // Vacuity guard: an action that always failed would satisfy the above.
        const res = await callStatus(() => Promise.resolve({
            exists: true,
            data: () => ({ serviceRegistrations: { academy: { paymentStatus: 'completed' } } }),
        }));

        expect({ success: res.success, data: res.data }).toEqual({ success: true, data: 'paid' });
    });

    it('and "unpaid" when it genuinely is, which must stay a real answer', async () => {
        const res = await callStatus(() => Promise.resolve({ exists: true, data: () => ({}) }));

        expect({ success: res.success, data: res.data }).toEqual({ success: true, data: 'unpaid' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#316 — no caller reads `.data` without knowing the read worked', () => {
    it('THE APPLICATION PAGE ROUTES EVERY READ THROUGH ONE HELPER', () => {
        // Five call sites, all of which had their own way of being wrong.
        const src = code(APPLICATION);

        expect(src).toMatch(/const readPaymentStatus = async \(\): Promise<"paid" \| "unpaid" \| null>/);
        expect(src).toMatch(/if \(!res\.success\) return null;/);
        // Nothing reads the raw field any more.
        expect(src).not.toMatch(/payStatus\.data/);
        expect(src).not.toMatch(/checkAcademyPaymentStatusAction\(\);\s*\n\s*setPaymentStatus/);
    });

    it('and it does not push a possibly-paid learner onto the payment step', () => {
        const src = code(APPLICATION);

        expect(src).toMatch(/setPaymentCheckFailed\(true\)/);
        expect(src).toMatch(/We could not check your payment status/);
    });

    it('THE LAYOUT GUARD IT DEFEATED IS STILL THERE, and now means something', () => {
        // Not changed by this fix — it was already correct. Pinned because the
        // action's contract is the only reason it works.
        const src = code(LAYOUT);

        expect(src).toMatch(/payStatus\.success && payStatus\.data === "unpaid"/);
    });

    it('setup does not redirect on an unreadable status', () => {
        expect(code(SETUP)).toMatch(/else if \(!payStatus\.success\)/);
    });

    it('and the dashboard tells a failed read apart from an unpaid learner', () => {
        const src = code(DASHBOARD);

        expect(src).toMatch(/else if \(!payStatus\.success\)/);
        expect(src).toMatch(/Payment status unreadable on dashboard/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#316 — a broken session is not a learner known not to have paid', () => {
    it('an authenticated session with no user id refuses instead of answering', async () => {
        jest.resetModules();
        (globalThis as any).mockRequireSession.mockImplementationOnce(() =>
            Promise.resolve({ session: { user: {} }, error: null }));

        const mod = await import('@/app/actions/academy/_payment');
        const res = (await mod.checkAcademyPaymentStatusAction()) as any;

        expect({ success: res.success, data: res.data }).toEqual({ success: false, data: null });
    });
});
