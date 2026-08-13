/**
 * @jest-environment node
 */

/**
 * A lockout my own ratchet was spelled too narrowly to catch, and an edit
 * window that never closed.
 *
 * THE LOCKOUT, AND WHY THE RATCHET MISSED IT
 * ------------------------------------------
 * `moderateReviewAction` and `getAdminReviewsAction` both gate on
 *
 *     hasRole(userData?.roles || [], "admin")
 *
 * and hasRole is a literal `includes()`. So a super_admin who does not also hold
 * the plain 'admin' role is refused — the lockout class already fixed in #115,
 * #122 and #134, and ratcheted in #138 to stop it coming back.
 *
 * The ratchet did not stop it. It matched one spelling,
 * `roles.includes("admin")`, and these say `hasRole(...)`. Sweeping for the
 * second spelling found FOUR live sites: two here, and two in disputes.ts —
 * the same file where #122 fixed `assignDisputeAction` and wrote up this exact
 * defect at the time.
 *
 * That is the lesson worth keeping: a ratchet that pins one spelling of a defect
 * pins the spelling, not the defect. sibling-sweep-guards.test.ts now checks both
 * forms, and was mutation-tested against the four pre-fix sites — it names all
 * four.
 *
 * The fix deliberately does NOT switch to isAdmin(), which also admits
 * moderator, support and every module admin. Widening review moderation while
 * fixing a lockout would be a bad trade made quietly — the same reasoning as
 * #115 and #138.
 *
 * THE EDIT WINDOW THAT NEVER CLOSED
 * ---------------------------------
 * `updateReviewAction` allows edits for 30 days, and computed the age with:
 *
 *     ('toDate' in review.createdAt && typeof review.createdAt.toDate === 'function')
 *         ? review.createdAt.toDate()
 *         : (review.createdAt instanceof Date ? review.createdAt : new Date())
 *
 * The final fallback is NOW, so any createdAt shape it did not recognise made
 * the review zero days old and permanently editable. The read paths in this same
 * file coerce `seconds`, `_seconds`, Date and string forms explicitly — which is
 * the evidence that those shapes reach this code.
 *
 * And `'toDate' in review.createdAt` THROWS on a string or a null, because `in`
 * requires an object. A review whose createdAt had been serialised to an ISO
 * string could not be edited at all, failing with a generic message from the
 * outer catch. So the same expression both bypassed the rule and broke the
 * feature, depending on the shape.
 *
 * lib/date-utils already had `toDate`, handling every one of those shapes — but
 * it falls back to `new Date()` too, which is right for DISPLAY and wrong for
 * any rule about elapsed time. `toDateOrNull` returns null instead, and a window
 * rule fails closed on it: "we cannot tell when this was written" is not "it was
 * written just now".
 *
 * IMAGES WERE STORED EXACTLY AS SENT
 * ----------------------------------
 * Any number of them, any string. They are rendered beside a review, so an
 * unbounded list of arbitrary URIs is both a layout problem and a way to put
 * `javascript:` or `data:` into an attribute. Bounded now, and restricted to an
 * https URL or a path on this site.
 *
 * CHECKED AND LEFT ALONE
 * ----------------------
 * getSellerRatingAction reads without a .limit(), which looked like the silent
 * truncation of #141. The adapter's UNBOUNDED_CEILING is 500,000 rows and it
 * logs an error on reaching it, so a single seller's approved reviews cannot
 * realistically hit it. Reported rather than changed.
 *
 * createReviewAction was already careful: it verifies the caller is the buyer,
 * that the order is completed, that the product is in the order, that no review
 * exists for that (user, product, order), and takes sellerId from the product
 * document rather than the order. None of that needed touching.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { toDateOrNull, toDate } from '@/lib/date-utils';

const BUYER = 'buyer-1';
const ADMIN = 'admin-1';
const SUPER = 'super-1';

jest.mock('@/lib/audit-log', () => ({
    createAdminAuditLog: jest.fn(async () => ({})),
    logAdminAction: jest.fn(async () => ({})),
}));

function setSession(id: string | null) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Authentication required' } }
            : { session: { user: { id, email: `${id}@e.com`, name: id, roles: [] } }, error: null }
    ));
}

/**
 * These actions read the CALLER's user document for roles, then the review.
 * The harness answers doc().get() with the document id, so both are keyed by it.
 */
function setWorld(opts: { roles?: string[]; review?: Record<string, any> | null } = {}) {
    const roles = opts.roles ?? [];
    const review = opts.review === undefined ? { userId: BUYER, createdAt: new Date() } : opts.review;

    (global as any).mockFirestoreGet.mockImplementation((id: string) => {
        if (id === ADMIN || id === SUPER || id === BUYER) {
            return Promise.resolve({ exists: true, empty: false, docs: [], data: () => ({ roles }) });
        }
        return Promise.resolve({
            exists: review !== null,
            empty: review === null,
            size: review ? 1 : 0,
            docs: [],
            data: () => review ?? {},
        });
    });
}

describe('a super_admin can moderate reviews', () => {
    beforeEach(() => jest.clearAllMocks());

    async function moderate() {
        const { moderateReviewAction } = await import('@/app/actions/reviews');
        return moderateReviewAction('review-1', 'approved') as any;
    }

    it('lets a super_admin through', async () => {
        // THE test. hasRole is a literal includes(), so an account holding only
        // 'super_admin' was refused — a lockout of the most privileged role.
        setSession(SUPER);
        setWorld({ roles: ['super_admin'] });

        const r = await moderate();

        expect(r.success).toBe(true);
        expect((global as any).mockFirestoreUpdate).toHaveBeenCalled();
    });

    it('still lets a plain admin through', async () => {
        setSession(ADMIN);
        setWorld({ roles: ['admin'] });

        expect((await moderate()).success).toBe(true);
    });

    it('still refuses everyone else', async () => {
        // Vacuity guard, and the reason this was not switched to isAdmin():
        // that would admit moderator, support and every module admin.
        for (const roles of [[], ['seller'], ['moderator'], ['support'], ['marketplace_admin']]) {
            jest.clearAllMocks();
            setSession(BUYER);
            setWorld({ roles });

            const r = await moderate();

            expect(r.success).toBe(false);
            expect((global as any).mockFirestoreUpdate).not.toHaveBeenCalled();
        }
    });

    it('refuses an unauthenticated caller', async () => {
        setSession(null);
        setWorld({ roles: ['super_admin'] });

        expect((await moderate()).success).toBe(false);
    });

    it('applies to the admin review list too', async () => {
        setSession(SUPER);
        setWorld({ roles: ['super_admin'] });

        const { getAdminReviewsAction } = await import('@/app/actions/reviews');
        const r: any = await getAdminReviewsAction();

        expect(r.success).toBe(true);
    });
});

describe('the same lockout in disputes.ts', () => {
    // #122 fixed assignDisputeAction in this file and documented the defect.
    // These two were left, and are the reason the sweep was worth doing.
    it('has no hasRole admin check left without super_admin', async () => {
        const { readFileSync } = await import('fs');
        const { join } = await import('path');

        for (const file of ['src/app/actions/disputes.ts', 'src/app/actions/reviews.ts']) {
            const offenders = readFileSync(join(process.cwd(), file), 'utf-8')
                .split('\n')
                .filter((line) => {
                    const t = line.trim();
                    if (t.startsWith('//') || t.startsWith('*')) return false;
                    if (line.includes('super_admin')) return false;
                    return /hasRole\([^)]*,\s*['"]admin['"]\s*\)/.test(line);
                });

            expect(offenders).toEqual([]);
        }
    });
});

describe('the date coercion a time window can rely on', () => {
    it('returns null when it genuinely cannot tell', () => {
        // THE distinction. toDate answers "now" here, which is right for display
        // and is what made the edit window permanent.
        for (const value of [null, undefined, '', 'not a date', {}, NaN]) {
            expect(toDateOrNull(value)).toBeNull();
        }
    });

    it('still reads every shape this codebase stores', () => {
        const when = new Date('2026-01-01T00:00:00.000Z');

        expect(toDateOrNull(when)?.getTime()).toBe(when.getTime());
        expect(toDateOrNull(when.toISOString())?.getTime()).toBe(when.getTime());
        expect(toDateOrNull({ seconds: when.getTime() / 1000 })?.getTime()).toBe(when.getTime());
        expect(toDateOrNull({ _seconds: when.getTime() / 1000 })?.getTime()).toBe(when.getTime());
        expect(toDateOrNull({ toDate: () => when })?.getTime()).toBe(when.getTime());
    });

    it('leaves toDate behaving as it always did', () => {
        // Display callers must not change. Unknown still means "now" there.
        const before = Date.now();
        const result = toDate('not a date').getTime();

        expect(result).toBeGreaterThanOrEqual(before);
    });
});

describe('the 30-day edit window actually closes', () => {
    const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

    beforeEach(() => {
        jest.clearAllMocks();
        setSession(BUYER);
    });

    async function update() {
        const { updateReviewAction } = await import('@/app/actions/reviews');
        return updateReviewAction('review-1', 4, 'A perfectly reasonable review of at least twenty characters.') as any;
    }

    it('refuses an old review stored as a serialised timestamp', async () => {
        // THE test. `{ _seconds }` hit the `new Date()` fallback, so a review of
        // any age was reported as zero days old.
        setWorld({ roles: [], review: { userId: BUYER, createdAt: { _seconds: oldDate.getTime() / 1000 } } });

        const r = await update();

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/30 days/i);
        expect((global as any).mockFirestoreUpdate).not.toHaveBeenCalled();
    });

    it('refuses an old review stored as an ISO string', async () => {
        // This shape did not bypass the rule — it THREW, because `in` needs an
        // object. The review could not be edited at all, with a generic error.
        setWorld({ roles: [], review: { userId: BUYER, createdAt: oldDate.toISOString() } });

        const r = await update();

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/30 days/i);
    });

    it('refuses an old review stored as a { seconds } object', async () => {
        setWorld({ roles: [], review: { userId: BUYER, createdAt: { seconds: oldDate.getTime() / 1000 } } });

        expect((await update()).success).toBe(false);
    });

    it('still allows a recent edit, whatever the shape', async () => {
        // Vacuity guard. The window has to stay OPEN for the case it exists for,
        // and the string shape has to work at all now.
        for (const createdAt of [
            recent,
            recent.toISOString(),
            { seconds: recent.getTime() / 1000 },
            { _seconds: recent.getTime() / 1000 },
            { toDate: () => recent },
        ]) {
            jest.clearAllMocks();
            setWorld({ roles: [], review: { userId: BUYER, createdAt } });

            const r = await update();

            expect(r.success).toBe(true);
            expect((global as any).mockFirestoreUpdate).toHaveBeenCalled();
        }
    });

    it('fails closed when the date cannot be determined at all', async () => {
        // "We cannot tell when this was written" must not mean "just now".
        setWorld({ roles: [], review: { userId: BUYER, createdAt: null } });

        const r = await update();

        expect(r.success).toBe(false);
        expect((global as any).mockFirestoreUpdate).not.toHaveBeenCalled();
    });

    it('still refuses editing somebody else\'s review', async () => {
        // Pre-existing guard, pinned.
        setWorld({ roles: [], review: { userId: 'someone-else', createdAt: recent } });

        expect((await update()).success).toBe(false);
    });

    it('re-queues an edited review for moderation', async () => {
        // Pre-existing and worth pinning: an edit must not keep the old
        // approval.
        setWorld({ roles: [], review: { userId: BUYER, createdAt: recent } });

        await update();

        const patch = (global as any).mockFirestoreUpdate.mock.calls.at(-1)?.[1];
        expect(patch?.status).toBe('pending');
    });
});

describe('review images are bounded and cannot be arbitrary URIs', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(BUYER);
        (global as any).mockFirestoreGet.mockImplementation((id: string) => {
            if (id === 'order-1') {
                return Promise.resolve({
                    exists: true, empty: false, docs: [],
                    data: () => ({ buyerId: BUYER, status: 'completed', items: [{ productId: 'prod-1' }], sellerId: 'seller-1' }),
                });
            }
            if (id === 'prod-1') {
                return Promise.resolve({ exists: true, empty: false, docs: [], data: () => ({ sellerId: 'seller-1' }) });
            }
            // The duplicate-review query.
            return Promise.resolve({ exists: false, empty: true, size: 0, docs: [], data: () => ({}) });
        });
    });

    async function create(images: any) {
        const { createReviewAction } = await import('@/app/actions/reviews');
        return createReviewAction({
            productId: 'prod-1', orderId: 'order-1', rating: 5,
            comment: 'A perfectly reasonable review of at least twenty characters.',
            images,
        } as any) as any;
    }

    it('refuses a javascript: URI', async () => {
        const r = await create(['javascript:alert(1)']);

        expect(r.success).toBe(false);
        expect((global as any).mockFirestoreAdd).not.toHaveBeenCalled();
    });

    it('refuses data: and protocol-relative references', async () => {
        for (const bad of ['data:image/png;base64,AAAA', '//evil.example/x.png', 'http://insecure.example/x.png']) {
            jest.clearAllMocks();
            const r = await create([bad]);
            expect(r.success).toBe(false);
        }
    });

    it('refuses more images than the cap', async () => {
        const many = Array.from({ length: 20 }, (_, i) => `https://cdn.example/${i}.png`);

        expect((await create(many)).success).toBe(false);
    });

    it('accepts https URLs and site paths', async () => {
        // Vacuity guard: a review with pictures still has to work.
        const r = await create(['https://cdn.example/a.png', '/uploads/b.png']);

        expect(r.success).toBe(true);
        expect((global as any).mockFirestoreAdd).toHaveBeenCalled();
    });

    it('accepts a review with no images at all', async () => {
        const r = await create(undefined);

        expect(r.success).toBe(true);
    });
});
