/**
 * @jest-environment node
 */

/**
 * Internal links that point at routes which do not exist.
 *
 * HOW THIS STARTED
 * ----------------
 * _submitQuoteRequestAction notified a seller with a link to
 * `/marketplace/seller/quotes/{id}`. That route did not exist, nor its parent,
 * nor `/marketplace/buyer/quotes`, which the same function's revalidatePath
 * named. Found by reading one function.
 *
 * So I wrote a scanner, pointed it at the marketplace, and it found eighteen
 * more — every one of them `/escrow/{escrowId}`.
 *
 * `src/app/escrow/[id]/` existed as a directory, with `chat/` and `dispute/`
 * children that both assume a parent, and had no page.tsx. Every escrow
 * lifecycle notification — created, funded, release requested, released,
 * refunded, disputed, dispute resolved — links there with linkText "View
 * Escrow", for both buyer and seller. Every notification telling somebody their
 * money had moved led to a 404.
 *
 * A dead internal link is invisible to the type checker, to the linter, and to
 * every test that does not click it. That is the whole reason this exists.
 *
 * THE SCANNER'S OWN FIRST MISTAKE
 * ------------------------------
 * Its first run reported thirty links, four of which were inside commented-out
 * `_fanOut(adminIds, {...})` blocks — three `/admin/marketplace/orders/{id}` and
 * one `/admin/marketplace/village-market/{id}`. Nothing emits those, so they were
 * not defects. Comments are stripped now and the honest count is twenty-six. A
 * scanner that reports dead links in dead code inflates its findings and gets
 * switched off.
 *
 * WHY MARKETPLACE IS GATED AND THE REST IS PINNED
 * -----------------------------------------------
 * The marketplace and escrow surfaces have been audited, and their honest count
 * is now ZERO — so that is a gate. The remaining twenty-six sit in modules still
 * on the audit list (academy, cooperative, export) plus three that are not
 * marketplace's business. They are pinned rather than fixed here: each needs a
 * decision about whether to build the route or change the link, and making
 * twenty-six of those decisions inside a marketplace pass would be the wrong
 * place to make them.
 *
 * Pinned means the list cannot GROW. Anything new fails.
 */

import { describe, it, expect } from '@jest/globals';
import { join } from 'path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import {
    collectRoutes,
    isKnownRoute,
    scanFileForDeadLinks,
    scanForDeadLinks,
} from '@/lib/testing/route-link-scan';

const SRC = join(process.cwd(), 'src');
const APP = join(SRC, 'app');

/** A throwaway app tree, so the scanner's rules are tested rather than observed. */
function withFakeApp(routes: string[], body: (dir: string) => void) {
    const dir = mkdtempSync(join(tmpdir(), 'routescan-'));
    try {
        for (const r of routes) {
            const full = join(dir, 'app', ...r.split('/').filter(Boolean));
            mkdirSync(full, { recursive: true });
            writeFileSync(join(full, 'page.tsx'), 'export default function P() { return null; }');
        }
        body(dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

describe('route matching', () => {
    it('resolves a literal path', () => {
        withFakeApp(['marketplace/buyer/quotes'], (dir) => {
            const routes = collectRoutes(join(dir, 'app'));
            expect(isKnownRoute('/marketplace/buyer/quotes', routes)).toBe(true);
            expect(isKnownRoute('/marketplace/buyer/invoices', routes)).toBe(false);
        });
    });

    it('a dynamic segment matches one segment, not two', () => {
        // THE escrow case: /escrow/[id]/chat existing does NOT make /escrow/[id]
        // a route. That distinction is the entire defect.
        withFakeApp(['escrow/[id]/chat'], (dir) => {
            const routes = collectRoutes(join(dir, 'app'));

            expect(isKnownRoute('/escrow/abc/chat', routes)).toBe(true);
            expect(isKnownRoute('/escrow/abc', routes)).toBe(false);
            expect(isKnownRoute('/escrow/abc/chat/extra', routes)).toBe(false);
        });
    });

    it('a route group is not a URL segment', () => {
        withFakeApp(['export/(app)/opportunities'], (dir) => {
            const routes = collectRoutes(join(dir, 'app'));
            expect(isKnownRoute('/export/opportunities', routes)).toBe(true);
        });
    });

    it('a catch-all absorbs the tail', () => {
        withFakeApp(['docs/[...slug]'], (dir) => {
            const routes = collectRoutes(join(dir, 'app'));
            expect(isKnownRoute('/docs/a', routes)).toBe(true);
            expect(isKnownRoute('/docs/a/b/c', routes)).toBe(true);
        });
    });

    it('query strings and fragments are ignored', () => {
        withFakeApp(['orders'], (dir) => {
            const routes = collectRoutes(join(dir, 'app'));
            expect(isKnownRoute('/orders?tab=open', routes)).toBe(true);
            expect(isKnownRoute('/orders#top', routes)).toBe(true);
        });
    });
});

describe('what the scanner reads', () => {
    function scanSnippet(code: string, routes: string[]): string[] {
        const dir = mkdtempSync(join(tmpdir(), 'linkscan-'));
        try {
            for (const r of routes) {
                const full = join(dir, 'app', ...r.split('/').filter(Boolean));
                mkdirSync(full, { recursive: true });
                writeFileSync(join(full, 'page.tsx'), 'export default function P(){return null}');
            }
            const file = join(dir, 'sample.tsx');
            writeFileSync(file, code);
            return scanFileForDeadLinks(file, dir, collectRoutes(join(dir, 'app'))).map((d) => d.href);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }

    it('finds a Link href', () => {
        expect(scanSnippet('<Link href="/nowhere">x</Link>', ['somewhere'])).toEqual(['/nowhere']);
    });

    it('finds a router.push and a notification link field', () => {
        expect(scanSnippet('router.push("/nowhere")', [])).toEqual(['/nowhere']);
        expect(scanSnippet('const n = { link: "/nowhere" }', [])).toEqual(['/nowhere']);
    });

    it('finds a revalidatePath, which is how the RFQ defect showed itself', () => {
        expect(scanSnippet('revalidatePath("/marketplace/buyer/quotes")', [])).toEqual(['/marketplace/buyer/quotes']);
    });

    it('treats a template hole as one dynamic segment', () => {
        expect(scanSnippet('router.push(`/escrow/${id}`)', ['escrow/[id]'])).toEqual([]);
        expect(scanSnippet('router.push(`/escrow/${id}`)', ['escrow'])).toEqual(['/escrow/[dyn]']);
    });

    it('ignores links inside comments', () => {
        // Its first run reported four of these as defects. Nothing emits them.
        expect(scanSnippet('// router.push("/nowhere")', [])).toEqual([]);
        expect(scanSnippet('/* link: "/nowhere" */', [])).toEqual([]);
        expect(scanSnippet('const x = 1; // <Link href="/nowhere">', [])).toEqual([]);
    });

    it('ignores a file path, an external URL and a bare slash', () => {
        // Vacuity guards. A scanner that flagged these would be noise.
        expect(scanSnippet('<img src="/logo.png" />', [])).toEqual([]);
        expect(scanSnippet('<a href="//example.com/x">y</a>', [])).toEqual([]);
        expect(scanSnippet('<Link href="/">home</Link>', [])).toEqual([]);
    });

    it('and does not guess at a link built from a variable', () => {
        // Guessing produces false positives, which is how a scanner gets disabled.
        expect(scanSnippet('router.push(target)', [])).toEqual([]);
    });
});

describe('the marketplace and escrow surfaces', () => {
    it('have no dead internal links', () => {
        // A GATE, not a pin. These have been audited and the honest count is zero.
        const dead = scanForDeadLinks(
            [
                join(SRC, 'app/marketplace'),
                join(SRC, 'app/escrow'),
                join(SRC, 'app/admin/marketplace'),
                join(SRC, 'app/actions/marketplace'),
                join(SRC, 'components/marketplace'),
                join(SRC, 'components/modals'),
                join(SRC, 'lib/marketplace-notifications.ts'),
            ].filter(Boolean),
            SRC,
            APP,
        );

        if (dead.length > 0) {
            throw new Error(
                `\n\n⚠️  ${dead.length} internal link(s) point at routes that do not exist:\n\n` +
                dead.map((d) => `  ${d.file}:${d.line}\n      ${d.href}`).join('\n') +
                `\n\nA dead link is invisible to tsc, to the linter, and to any test\n` +
                `that does not click it. Either create the route or change the link.\n`
            );
        }
        expect(dead).toEqual([]);
    });

    it('and /escrow/[id] specifically resolves — eighteen notifications need it', () => {
        // Named explicitly. The gate above would also pass if every escrow
        // notification were deleted, which is not the fix.
        const routes = collectRoutes(APP);

        expect(isKnownRoute('/escrow/some-escrow-id', routes)).toBe(true);
        expect(isKnownRoute('/escrow/some-escrow-id/chat', routes)).toBe(true);
        expect(isKnownRoute('/escrow/some-escrow-id/dispute', routes)).toBe(true);
    });

    it('and so do the two quote lists', () => {
        const routes = collectRoutes(APP);

        expect(isKnownRoute('/marketplace/buyer/quotes', routes)).toBe(true);
        expect(isKnownRoute('/marketplace/seller/quotes', routes)).toBe(true);
    });
});

/**
 * The rest of the tree, pinned by count per route.
 *
 * These sit in modules still on the audit list. Each needs a decision — build
 * the route, or change the link — and twenty-six of those decisions do not
 * belong in a marketplace pass.
 *
 * Removing an entry when it is fixed is the point. Adding one requires saying so
 * here, which is the review conversation this property needs.
 */
const KNOWN_DEAD: Record<string, number> = {};

/**
 * EMPTY. Every dead internal link in the tree is fixed, so this is now a gate
 * over the WHOLE application rather than a ratchet over a known remainder.
 *
 * The last six went as follows:
 *
 *   /vendor/products/new        2x  ) all four went with the /vendor surface
 *   /vendor/orders/[dyn]        1x  ) itself, which was removed rather than
 *   /vendor/products/[dyn]      1x  ) finished — see vendor-surface-removed.
 *   /farm-nation/properties/[dyn] 1x  the "view my property" link on the member
 *                                     dashboard. /properties is the LIST and
 *                                     has no [id] segment; the detail page is
 *                                     /property/[id], singular. Relinked.
 *   /help/api-docs              1x  a "resource" card advertising API
 *                                     documentation that does not exist, on a
 *                                     platform with no public API. The card was
 *                                     removed rather than pointed at "#" like
 *                                     its three siblings, because an inert card
 *                                     that looks clickable is the defect this
 *                                     audit removed elsewhere.
 *
 * Adding an entry back requires saying why here, which is the review
 * conversation this property needs.
 */

/**
 * The two admin entries are gone, fixed in the admin pass. They were:
 *
 *   /admin/wallets/withdrawals  1x  the "Process Withdrawal" link on every
 *                                   wallet-withdrawal notification sent to
 *                                   admins. There is no /admin/wallets segment
 *                                   at all, so every one 404'd. It points at
 *                                   /admin/marketplace/withdrawals, the page
 *                                   that calls processWalletWithdrawalAction —
 *                                   the very action the notification announces.
 *                                   (/admin/withdrawals exists but redirects to
 *                                   the WAVE list, a different withdrawal.)
 *   /admin/users/[dyn]          1x  the "Verify" button on every system-health
 *                                   issue row. /admin/users has no [id]
 *                                   segment. It now links to the users list
 *                                   seeded by ?search=, carrying the row's
 *                                   EMAIL — searchUserIdsByQuery matches email
 *                                   exactly and does not match a document id,
 *                                   so linking by issue.id would have found
 *                                   nothing even once the route resolved.
 */

/**
 * The cooperative entries are gone, fixed in the cooperative pass. They were:
 *
 *   /dashboard/cooperatives      3x  every one a revalidatePath. The cooperative
 *                                    dashboard is /cooperatives/dashboard — the
 *                                    (member) segment is a route group and does
 *                                    not appear in the URL — and revalidatePath
 *                                    on a path with no route is a silent no-op.
 *                                    So contributing, registering and
 *                                    withdrawing each invalidated nothing, and a
 *                                    member could keep seeing a cached balance
 *                                    after their money moved.
 *   /loans/[dyn]                 2x  the "View Loan" link on every Funds
 *                                    Disbursed and Repayment Recorded
 *                                    notification. /loans exists with apply,
 *                                    approve and success beneath it and no [id]
 *                                    segment, so every one of those led to a
 *                                    404. They point at /cooperatives/my-loans,
 *                                    which is where the platform actually shows
 *                                    a borrower their loans.
 *   /admin/cooperative/members   1x  a revalidatePath with the collection name
 *                                    in the singular. The route is
 *                                    /admin/cooperatives/members, so the admin
 *                                    member list kept serving a stale cache
 *                                    after an approval.
 */

/**
 * The export entries are gone too, fixed in the export pass. They were:
 *
 *   /dashboard/export             3x  every one a revalidatePath. The export
 *                                     dashboard is /export/dashboard — the
 *                                     (app) segment is a route group and does
 *                                     not appear in the URL — and revalidatePath
 *                                     on a path with no route is a silent no-op.
 *   /admin/export/orders/[dyn]    1x  the link on every "New Export Order
 *                                     Received" admin notification. There is no
 *                                     [id] segment under that route, only the
 *                                     list page, so every one of those
 *                                     notifications led to a 404.
 */

/**
 * The academy entries are gone, fixed in the academy pass. They were:
 *
 *   /dashboard/academy                    3x  every one a revalidatePath. The
 *                                             academy dashboard is at
 *                                             /academy/dashboard, and
 *                                             revalidatePath on a path with no
 *                                             route is a silent no-op — so
 *                                             enrolling invalidated nothing and
 *                                             a learner could keep seeing a
 *                                             cached dashboard without their
 *                                             new course on it.
 *   /academy/courses/[dyn]                2x  also revalidatePath. The course
 *                                             page is /academy/{id}; the only
 *                                             route under /academy/courses is
 *                                             .../quiz.
 *   /academy/courses/[dyn]/quiz/results   1x  a router.push after a graded quiz
 *                                             submission, straight to a 404 —
 *                                             taking the learner's score with
 *                                             it. The response already carries
 *                                             the score and the verdict.
 *   /courses/[dyn]/certificate            1x  the certificate notification's
 *                                             link. There is no /courses route
 *                                             segment anywhere in the app.
 */

describe('the rest of the tree', () => {
    const dead = scanForDeadLinks([join(SRC, 'app'), join(SRC, 'components'), join(SRC, 'lib')], SRC, APP);

    it('has introduced no new dead link', () => {
        const actual: Record<string, number> = {};
        for (const d of dead) actual[d.href] = (actual[d.href] ?? 0) + 1;

        const added = Object.keys(actual).filter((h) => !(h in KNOWN_DEAD));
        const grown = Object.keys(actual).filter((h) => h in KNOWN_DEAD && actual[h] > KNOWN_DEAD[h]);

        if (added.length || grown.length) {
            throw new Error(
                `\n\n⚠️  New dead internal link(s):\n\n` +
                added.map((h) => `  NEW   ${h} (${actual[h]}x)\n` +
                    dead.filter((d) => d.href === h).map((d) => `          ${d.file}:${d.line}`).join('\n')).join('\n') +
                grown.map((h) => `  MORE  ${h} (${KNOWN_DEAD[h]} → ${actual[h]})`).join('\n') +
                `\n\nEither create the route or change the link. If it is genuinely\n` +
                `expected, add it to KNOWN_DEAD in this test with a reason.\n`
            );
        }

        expect({ added, grown }).toEqual({ added: [], grown: [] });
    });

    it('and the scanner can still find one, so [] means clean', () => {
        // THE vacuity guard, and it had to change shape.
        //
        // It used to be a floor — "at least N dead links are still known" —
        // which worked only while a remainder existed. The remainder is now
        // zero, and a scanner that silently returned [] for every input would
        // pass every assertion above while proving nothing.
        //
        // So instead: run the SAME function over a throwaway tree containing one
        // link that is deliberately dead. If it finds that, an empty result on
        // the real tree means the tree is clean rather than the scanner broken.
        const dir = mkdtempSync(join(tmpdir(), 'deadlink-control-'));
        try {
            mkdirSync(join(dir, 'app', 'real'), { recursive: true });
            writeFileSync(join(dir, 'app', 'real', 'page.tsx'), 'export default function P() { return null; }');
            mkdirSync(join(dir, 'components'), { recursive: true });
            writeFileSync(
                join(dir, 'components', 'Thing.tsx'),
                'export const A = () => <a href="/definitely-not-a-route">x</a>;\n',
            );

            const found = scanForDeadLinks([join(dir, 'components')], dir, join(dir, 'app'));

            expect(found.map((d) => d.href)).toContain('/definitely-not-a-route');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('the real tree being clean, which is now a gate over all of it', () => {
        // Was a ratchet with six known entries. It is a gate now.
        if (dead.length > 0) {
            throw new Error(
                `\n\n⚠️  ${dead.length} dead internal link(s):\n\n` +
                dead.map((d) => `  ${d.file}:${d.line}\n      ${d.href}`).join('\n') + '\n',
            );
        }
        expect(dead).toEqual([]);
    });

    it('the wallet withdrawal notification links to the page that processes it', () => {
        // Not merely "not dead": /admin/withdrawals also resolves, and it
        // redirects to the WAVE list — a different withdrawal entirely. The
        // link has to reach the page that calls the action the notification
        // announces.
        const wallet = readFileSync(join(process.cwd(), 'src/app/actions/wallet.ts'), 'utf-8');

        expect(wallet).toContain('link: `/admin/marketplace/withdrawals`');
        // The old path survives in the comment explaining the fix, so pin the
        // link itself rather than the bare string.
        expect(wallet).not.toContain('link: `/admin/wallets/withdrawals`');

        const page = readFileSync(
            join(process.cwd(), 'src/app/admin/marketplace/withdrawals/page.tsx'), 'utf-8');
        expect(page).toContain('processWalletWithdrawalAction');
    });

    it('and the system-health Verify button carries an email the search can match', () => {
        // /admin/users has no [id] route, and searchUserIdsByQuery matches
        // email exactly while not matching a document id at all — so issue.id
        // would have found nothing even once the route resolved.
        const health = readFileSync(
            join(process.cwd(), 'src/app/admin/system-health/page.tsx'), 'utf-8');

        expect(health).toContain('href={`/admin/users?search=${encodeURIComponent(issue.email)}`}');
        expect(health).not.toContain('/admin/users/${issue.id}');

        // And the list honours it, or the link lands on an unfiltered table.
        const users = readFileSync(join(process.cwd(), 'src/app/admin/users/page.tsx'), 'utf-8');
        expect(users).toContain('new URLSearchParams(window.location.search).get("search")');
        expect(users).toContain('if (initial) setSearch(initial);');

        // Vacuity guard on the email claim.
        const helper = readFileSync(join(process.cwd(), 'src/lib/admin-search-helper.ts'), 'utf-8');
        expect(helper).toContain('.where("email", "==", q)');
    });

    it('and the quiz-save redirect with literal spaces is gone', () => {
        // `router.push(`/ admin / academy / courses / ${id} `)` pushed
        // "/%20admin%20/%20academy%20/..." — a URL with no route behind it.
        expect(dead.map((d) => d.href).filter((h) => h.includes(' admin '))).toEqual([]);
    });
});
