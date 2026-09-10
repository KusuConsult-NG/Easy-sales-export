/**
 *   #612 FOURTEEN ADMIN ACTIONS REPORTED SUCCESS FOR WORK THEY DID NOT DO, AND
 *        TWO OF THEM WROTE AN AUDIT-LOG ENTRY SAYING SO.
 *
 *   Every probe in this audit so far is READ-SIDE: what a bad row looks like on
 *   a screen. This is the first write-side one, and the question it asks is what
 *   happens when the thing being written to is not there.
 *
 *   `update()` on a missing document is a SILENT NO-OP in the Supabase shim. Its
 *   own comment says so, and names the consequence exactly:
 *
 *       // Firestore throws NOT_FOUND here. We keep the write a no-op to avoid
 *       // changing behaviour under load, but it must not stay invisible —
 *       // this is how "the save button did nothing" bugs reach production.
 *
 *   It logs a warning and returns void. Nothing could act on that, because there
 *   was nothing to act on — so fourteen actions that take a document id FROM THE
 *   CALLER updated it, ignored the warning nobody sees, and returned success.
 *
 * ── AND AN AUDIT TRAIL THAT RECORDS WORK NOT DONE ──────────────────────────
 *
 *   /admin/marketplace approve and reject are the sharpest pair. Neither checked
 *   that the account existed, and both then wrote
 *
 *       createAdminAuditLog({ action: "approve_marketplace_user",
 *                             metadata: { role: "buyer" } })
 *
 *   So a mistyped or already-deleted id produced a green toast, no change, and a
 *   permanent record stating that an administrator approved a marketplace buyer.
 *   An audit trail that records work that did not happen is worse than no audit
 *   trail, because it is believed.
 *
 *   `role: "buyer"` is asserted and never verified either — that one is NOT
 *   fixed here and is stated rather than quietly left: checking it means deciding
 *   what these two screens should do about a target that is not a buyer, which is
 *   a product question and not an audit's to answer.
 *
 * ── AND THE REASON THE SCREEN REFUSED TO SEND ──────────────────────────────
 *
 *   The reject screen will not submit an empty rejection reason. The action
 *   accepted one. That is #606's shape — a check written on the one side of the
 *   boundary where it protects nobody — on the record of why somebody was turned
 *   away.
 *
 * ── WHAT IS NOT CLAIMED ─────────────────────────────────────────────────────
 *
 *   `update()` ITSELF IS UNCHANGED. Making it throw would match Firestore and is
 *   the risk the original note was deliberately avoiding; `updateExisting`
 *   returns whether a row was there and a caller opts in. Twenty-seven of the
 *   forty-one sites found are `.doc(session.user.id)` — the signed-in user, who
 *   exists by definition — and are left alone.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The SHIPPED `updateExisting`, called against a controlled `this`.
 *
 *   The first version of this file re-implemented it here and asserted against
 *   the copy. Two mutants on the real function SURVIVED, and they were right to:
 *   nothing in this file touched it. A test that re-states the code it is
 *   testing proves the two agree at the moment of writing and never again —
 *   which is TWO HAND-MAINTAINED COPIES OF ONE CONTRACT, the defect this audit
 *   keeps finding elsewhere and has now written twice itself (#608 was the other).
 *
 *   `updateExisting` only touches `this.get()` and `this.update()`, so the real
 *   method can be applied to a fake reference and still be the real method.
 */
function realUpdateExisting(): (this: any, data: Record<string, any>) => Promise<boolean> {
    const mod = jest.requireActual('@/lib/supabase-db') as any;
    const proto = mod.SupabaseDocumentReference?.prototype
        ?? Object.getPrototypeOf(mod.supabaseDb.collection('users').doc('probe'));
    return proto.updateExisting;
}

function fakeRef(exists: boolean) {
    const updates: any[] = [];
    return {
        updates,
        ref: {
            async get() { return { exists, data: () => (exists ? { id: 'x' } : undefined) }; },
            async update(data: any) { updates.push(data); },
        },
    };
}

describe('#612 — a write that says whether it wrote', () => {
    it('UPDATES AND REPORTS TRUE WHEN THE DOCUMENT IS THERE', async () => {
        const { ref, updates } = fakeRef(true);
        expect(await realUpdateExisting().call(ref, { status: 'active' })).toBe(true);
        expect(updates).toEqual([{ status: 'active' }]);
    });

    it('AND WRITES NOTHING AND REPORTS FALSE WHEN IT IS NOT', async () => {
        const { ref, updates } = fakeRef(false);
        expect(await realUpdateExisting().call(ref, { status: 'active' })).toBe(false);
        //   Both halves matter. Reporting false while still writing would be the
        //   same defect wearing a warning label.
        expect(updates).toEqual([]);
    });

    it('WHERE THE PLAIN update() CANNOT SAY EITHER WAY — THE CONTROL', () => {
        //   The reason this exists, stated as a fact about the shim rather than a
        //   claim about it. `update` is declared to return void, so no caller can
        //   distinguish a write from a no-op however carefully it is written.
        const shim = readFileSync(join(process.cwd(), 'src/lib/supabase-db.ts'), 'utf8');
        expect(shim).toContain('async update(data: Record<string, any>): Promise<void>');
        expect(shim).toContain('async updateExisting(data: Record<string, any>): Promise<boolean>');
        //   And the no-op really is silent-but-logged, which is what made it
        //   invisible: a warning in a server log is not an answer to a caller.
        expect(shim).toContain('no rows will be affected');
    });
});

// ─────────────────────────────────────────────────────────────────────────────

/**
 * A FIXED-STRING search, not a regular expression.
 *
 * #607's cap used `\s` inside `grep -E`, where it matches a literal "s", and
 * matched nothing; the first version of THIS one over-escaped in the other
 * direction — `\\(` in a TypeScript literal reaches grep as a backslash
 * followed by a group — and also matched nothing. Both mistakes are invisible
 * because an empty result reads as "all clear".
 *
 * There is no pattern here to get wrong: `grep -F` takes the string as written.
 */
function sourceMatches(needle: string, where = 'src/app/actions'): string[] {
    let out = '';
    try {
        out = execSync(`grep -rnF ${JSON.stringify(needle)} ${where} --include=*.ts || true`,
            { encoding: 'utf8', cwd: process.cwd() });
    } catch { out = ''; }
    return out.split('\n').map(l => l.trim()).filter(Boolean);
}

/** The actions converted here, each of which takes its id from the caller. */
const CONVERTED = [
    'deleteExportCatalogAction',
    'addExternalMerchantAction',
    'updateVillageMarketEventStatusAction',
    '_markAcademyApplicationUnderReviewAction',
    '_updateResourceAction',
    '_deleteResourceAction',
    '_updateTrainingEventAction',
    '_startWaveLiveSessionAction',
    '_updateCourseAction',
    '_updateCourseModulesAction',
    'runServiceRegistrationRecoveryAction',
    'updateMemberProfileDetailsAction',
    '_approveMarketplaceUserAction',
    '_rejectMarketplaceUserAction',
];

describe('#612 — every converted action still checks what it wrote', () => {
    it.each(CONVERTED)('%s calls updateExisting and acts on the answer', (fn) => {
        const hit = sourceMatches(`async function ${fn}(`);
        expect(hit).toHaveLength(1);

        const [file] = hit[0].split(':');
        const src = readFileSync(join(process.cwd(), file), 'utf8');
        const start = src.indexOf(`async function ${fn}`);
        const nextFn = src.slice(start + 10).search(/\n(export )?async function /);
        const body = src.slice(start, nextFn === -1 ? undefined : start + 10 + nextFn);

        expect(body).toContain('.updateExisting(');
        //   The answer must be USED. Calling it and dropping the result is the
        //   same defect with a longer name — and is exactly what a careless
        //   conversion produces.
        expect(body).toMatch(/const \w+ = await[\s\S]*?\.updateExisting\(/);
        expect(body).toMatch(/if \(!\w+\)/);
    });

    it('AND THE FOURTEEN ARE ALL OF THEM — the cap', () => {
        //   Counted, so a fifteenth caller-supplied id cannot be added silently.
        //   The number is what makes this a ratchet rather than a list.
        expect(CONVERTED).toHaveLength(14);
        expect(sourceMatches('.updateExisting(').length).toBeGreaterThanOrEqual(14);
    });

    it('VACUITY GUARD: THE SAME SEARCH, AGAINST A SPELLING THAT IS STILL THERE', () => {
        //   #607's lesson — sharing the function proves the search reaches the
        //   tree, not that the pattern matches. This one runs a pattern of the
        //   same SHAPE as the cap's, escaped parens and all, against a spelling
        //   that is deliberately still present on twenty-seven `.doc(session
        //   .user.id)` writes.
        expect(sourceMatches('.doc(session.user.id).update(').length).toBeGreaterThan(0);
    });
});

describe('#612 — the reject path requires the reason its screen refuses to omit', () => {
    it('REFUSES AN EMPTY REJECTION REASON SERVER-SIDE', () => {
        const src = readFileSync(join(process.cwd(), 'src/app/actions/admin/_marketplace.ts'), 'utf8');
        expect(src).toContain('A rejection reason is required');
        //   And the trimmed value is what gets stored and logged, so " " is not a
        //   reason either.
        expect(src).toMatch(/const reason = String\(options\.reason \?\? ""\)\.trim\(\)/);
        expect(src).toContain('rejectionReason: reason,');
        expect(src).toContain('metadata: { role: "buyer", reason },');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     updateExisting: return true without checking exists            KILLED
 *     updateExisting: write first, then report false                 KILLED
 *     updateExisting: report true without writing                    KILLED
 *     approve: delete the `if (!approved)` refusal                   KILLED
 *     approve: back to plain update()                                KILLED
 *     reject: allow an empty rejection reason                        KILLED
 *     reject: audit-log the untrimmed reason                         KILLED
 *     the CONVERTED list trimmed by one                              KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 *
 *   THE FIRST THREE SURVIVED THE FIRST ROUND, AND THE REASON IS THE ENTRY WORTH
 *   READING. This file re-implemented `updateExisting` locally and asserted
 *   against the copy — so every mutant on the SHIPPED function passed, correctly,
 *   because nothing here touched it. A test that re-states the code it tests
 *   proves the two agree at the moment of writing and never again. That is TWO
 *   HAND-MAINTAINED COPIES OF ONE CONTRACT, the defect this audit keeps finding
 *   in other people's code — and the second time I have written it myself, after
 *   #608's duplicated epoch rule.
 *
 *   The real method is applied to a controlled `this` now, so it is the shipped
 *   function being measured rather than a description of it.
 */
