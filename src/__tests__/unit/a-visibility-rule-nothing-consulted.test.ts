/**
 *   #624 THE RULE FOR WHAT A BUYER MAY SEE WAS CONSULTED BY NOTHING.
 *
 *   lib/product-status declares PRODUCT_VISIBLE_STATUSES — "statuses a buyer can
 *   see a product in" — and an `isVisibleProductStatus` helper beside it.
 *
 *   The helper had ZERO callers. Every buyer-facing read hand-wrote
 *   `where("status", "==", "active")` instead: fifteen copies across four files,
 *   two of them API routes reachable from the internet. So the single place that
 *   states the rule decided nothing, and editing it changed nothing.
 *
 *   That is the third time this exact shape has been found in this audit:
 *
 *     #618  canAccessAdminRoute enforced strict module isolation and was
 *           consulted only to decide which sidebar LINKS to draw.
 *     #623  finance:refund was declared, held by super_admin alone, and gated
 *           no door anywhere.
 *     #624  this.
 *
 *   A declaration that nothing reads is worse than no declaration: it is what
 *   somebody consults when they want to know the rule, and it answers with
 *   authority while governing nothing.
 *
 * ── NOTHING A BUYER SEES CHANGES ────────────────────────────────────────────
 *
 *   PRODUCT_VISIBLE_STATUSES is still exactly ["active"], so all fifteen queries
 *   select what they selected before. This commit does not alter the catalogue;
 *   it makes the line that describes the catalogue the line that decides it.
 *
 * ── WHY out_of_stock IS STILL NOT IN THE LIST ───────────────────────────────
 *
 *   product-status has long recorded that a product marked out_of_stock would
 *   vanish from the marketplace entirely rather than show as unavailable, and
 *   left it because "deciding how an out-of-stock listing should present is a
 *   product question".
 *
 *   It is decided: it should be visible and unbuyable. But adding it to this
 *   list TODAY — now that the list is real — would make it visible and BUYABLE,
 *   because no card and no checkout says "out of stock" yet. A listing a buyer
 *   can pay for and nobody can fulfil is a worse defect than one that is hidden,
 *   and it moves money. Nothing writes the status today, so the trap stays
 *   latent and harmless; what this commit buys is that finishing it is a
 *   one-line change here plus the presentation, rather than another fifteen-site
 *   sweep.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { PRODUCT_VISIBLE_STATUSES, isVisibleProductStatus } from '@/lib/product-status';

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(full) && !full.includes('__tests__')) out.push(full);
    }
    return out;
}

/** Every source file under the trees that read products for a buyer. */
const SOURCES = ['src/app/actions', 'src/app/api', 'src/lib']
    .flatMap(t => walk(join(ROOT, t)))
    .map(f => relative(ROOT, f));

/** Comment-stripped, so prose about a query is never mistaken for one. */
function code(rel: string): string {
    return readFileSync(join(ROOT, rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
}

/**
 * Does this file select PRODUCTS by a hand-written status?
 *
 * Scoped to the PRODUCTS collection on purpose. `where("status", "==",
 * "active")` appears on four other collections — export slots, course
 * enrolments, flash-sale rows — where "active" is that collection's own state
 * and has nothing to do with what a marketplace buyer may see. A ratchet that
 * swept those up would be demanding a change with no meaning and would be
 * switched off by whoever hit it next.
 *
 * ONE PRODUCTS QUERY IS DELIBERATELY EXEMPT, and it is named rather than
 * pattern-matched away: admin-content.ts counts active products beside pending
 * ones for the moderation dashboard. That is a tally OF A STATUS, not a question
 * about visibility, and it must keep counting "active" even if the visible set
 * later grows.
 */
const TALLY_NOT_VISIBILITY = 'src/app/actions/admin-content.ts';

function productVisibilityHandWritten(src: string): boolean {
    const HAND_WRITTEN = 'where("status", "==", "active")';
    let from = 0;
    for (;;) {
        const at = src.indexOf(HAND_WRITTEN, from);
        if (at === -1) return false;
        //   The collection is named on the same statement, just before the
        //   filter — a window rather than the whole file, so an unrelated
        //   mention of PRODUCTS elsewhere cannot implicate a query.
        if (src.slice(Math.max(0, at - 220), at).includes('COLLECTIONS.PRODUCTS')) return true;
        from = at + HAND_WRITTEN.length;
    }
}

describe('#624 — the visibility rule now decides what is selected', () => {
    it('NO BUYER-FACING QUERY HAND-WRITES THE STATUS ANY MORE', () => {
        /*
         *   THE RATCHET, and it is on the SHAPE rather than on a count. A count
         *   tells whoever breaks it nothing; the file list tells them where to
         *   look. Reported as paths.
         */
        const offenders = SOURCES
            .filter(f => f !== TALLY_NOT_VISIBILITY)
            .filter(f => productVisibilityHandWritten(code(f)));

        expect(offenders).toEqual([]);

        //   And the exemption is REAL — it still matches, so it is an exclusion
        //   of something, not a name kept after the code moved on. #598's rule.
        expect(productVisibilityHandWritten(code(TALLY_NOT_VISIBILITY))).toBe(true);
    });

    it('AND THE QUERIES ASK THE CONSTANT, in all four files that read products', () => {
        //   The other half: "nobody hand-writes it" would also be satisfied by
        //   deleting the queries. They have to be asking the rule.
        const asking = SOURCES.filter(f =>
            code(f).includes('where("status", "in", [...PRODUCT_VISIBLE_STATUSES])'));

        expect(asking.sort()).toEqual([
            'src/app/actions/marketplace/_buyer.ts',
            'src/app/actions/marketplace/_mp_catalog.ts',
            'src/app/api/marketplace/products/route.ts',
            'src/app/api/marketplace/sellers/[sellerId]/route.ts',
        ]);
    });

    it('AND THE SCANNER CAN FAIL — a positive control on both readers', () => {
        //   Without this, `code()` returning nothing useful would satisfy both
        //   assertions above while measuring nothing at all.
        expect(SOURCES.length).toBeGreaterThan(100);
        expect(code('src/lib/product-status.ts')).toContain('PRODUCT_VISIBLE_STATUSES');
        //   And comments really are stripped: the constant's own documentation
        //   quotes the old hand-written query, which must not count as one.
        expect(readFileSync(join(ROOT, 'src/lib/product-status.ts'), 'utf8'))
            .toContain('where("status", "==", "active")');
        expect(code('src/lib/product-status.ts'))
            .not.toContain('where("status", "==", "active")');

        //   And the proximity window really does discriminate: the same literal
        //   against another collection is not a product visibility read.
        expect(productVisibilityHandWritten(
            'db.collection(COLLECTIONS.EXPORT_SLOTS).where("status", "==", "active")')).toBe(false);
        expect(productVisibilityHandWritten(
            'db.collection(COLLECTIONS.PRODUCTS).where("status", "==", "active")')).toBe(true);
    });
});

describe('#624 — and the catalogue is unchanged by it', () => {
    it('THE LIST IS STILL EXACTLY ["active"]', () => {
        //   The claim that makes this safe to ship: no buyer sees anything today
        //   that they did not see yesterday.
        expect([...PRODUCT_VISIBLE_STATUSES]).toEqual(['active']);
    });

    it('AND out_of_stock IS DELIBERATELY NOT IN IT', () => {
        /*
         *   Pinned WITH its reason, because this is the line somebody will edit
         *   when they come to finish the feature — and adding the status here
         *   alone would make an unfulfillable listing purchasable. The
         *   presentation has to land in the same change.
         */
        expect([...PRODUCT_VISIBLE_STATUSES]).not.toContain('out_of_stock');
        expect(readFileSync(join(ROOT, 'src/lib/product-status.ts'), 'utf8'))
            .toContain('refuse the purchase');
    });

    it('AND THE HELPER BESIDE IT AGREES WITH THE LIST', () => {
        //   isVisibleProductStatus is the reason this was found: it had no
        //   callers at all. It stays, and it stays correct.
        expect(isVisibleProductStatus('active')).toBe(true);
        for (const hidden of ['draft', 'pending', 'rejected', 'suspended', 'out_of_stock', 'deleted']) {
            expect(isVisibleProductStatus(hidden)).toBe(false);
        }
        //   And it does not answer true for something that is not a status.
        expect(isVisibleProductStatus(undefined)).toBe(false);
        expect(isVisibleProductStatus('ACTIVE')).toBe(false);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT ITSELF: a buyer query hand-writes the status again  KILLED
 *     the visible list silently gains out_of_stock                   KILLED
 *     the visible list is emptied (catalogue disappears)             KILLED
 *     isVisibleProductStatus stops consulting the list               KILLED
 *     the proximity window matches any collection                    KILLED
 *     the exempted file stops needing its exemption                  KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 *
 *   THE SECOND AND THIRD ARE THE ONES THAT MATTER, and they fail in opposite
 *   directions. Adding out_of_stock makes an unfulfillable listing purchasable;
 *   emptying the list takes the entire marketplace off the air. Both now go
 *   through one line, which is the point of the change — and one line that can
 *   do either is a line that has to be guarded from both sides.
 *
 *   ONE MUTANT SURVIVED FIRST AND IT WAS A BAD MUTANT — mine. It replaced the
 *   exemption check with `expect(true).toBe(true)`, which deletes an assertion
 *   from this file rather than changing any code, and such a mutant always
 *   survives. That is the sixth time that lesson has come up in this audit.
 *   Rewritten as a real change — admin-content.ts no longer hand-writing the
 *   status, which is what would make its exemption dead — it dies.
 */
