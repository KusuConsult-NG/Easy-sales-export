/**
 * @jest-environment node
 */

/**
 * Per-function authorisation check, and the reason the file-level one was not
 * enough.
 *
 * `action-security-audit.test.ts` asserts that an action FILE imports
 * `requireSession`. A file can import the guard and contain functions that never
 * call it — which is not hypothetical. `vendor.ts` imports the guard; four of
 * its functions take an id and write to it; only one checked ownership. Any
 * authenticated user could zero any vendor's stock. **The file passed that test
 * the whole time.**
 *
 * A regex over file text cannot do better, for three reasons this suite pins:
 *
 *   1. it cannot tell WHICH function a guard call sits in
 *   2. it reads a guard inside a COMMENT as real — and `admin.ts` really does
 *      contain a commented-out `requireAdmin`, which the old check counts
 *   3. it cannot follow `withSafeAction("x", _x)` to the implementation
 *
 * So this walks the AST instead.
 *
 * HOW THE BASELINE WORKS
 * ----------------------
 * 59 actions currently reach no guard. Most are correct — public product and
 * course listings, and pre-auth flows like login and password reset. Fixing all
 * of them is not this change's business, and a test that fails on day one gets
 * deleted rather than fixed.
 *
 * So the baseline is a RATCHET. A new unguarded action fails the build. An
 * action that becomes guarded ALSO fails, demanding its removal from the list,
 * so the list can only shrink. What it must never become is a place to park
 * things quietly.
 */

import { describe, it, expect } from '@jest/globals';
import { join } from 'path';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { scanFile, scanDirectory, keyOf } from '@/lib/testing/action-auth-scan';
import baseline from './action-auth-baseline.json';

const ACTIONS_DIR = join(process.cwd(), 'src/app/actions');
const SRC_DIR = join(process.cwd(), 'src');

/** Run the scanner over a snippet, as though it were an action file. */
function scanSnippet(code: string): string[] {
    const dir = mkdtempSync(join(tmpdir(), 'authscan-'));
    try {
        const file = join(dir, 'sample.ts');
        writeFileSync(file, code);
        return scanFile(file, dir).map((f) => f.name).sort();
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

describe('the scanner itself', () => {
    it('flags an exported action whose body reaches no guard', async () => {
        const found = scanSnippet(`
            "use server";
            export async function deleteEverythingAction(id: string) {
                await db.collection("x").doc(id).delete();
            }
        `);

        expect(found).toContain('deleteEverythingAction');
    });

    it('does not flag one that calls a guard', async () => {
        // Vacuity guard: the assertions above must not be satisfied by a scanner
        // that flags everything.
        const found = scanSnippet(`
            "use server";
            export async function safeAction(id: string) {
                const s = await requireSession();
                if (!s.session) return null;
                await db.collection("x").doc(id).delete();
            }
        `);

        expect(found).not.toContain('safeAction');
    });

    it('flags a guarded function SIBLING — the vendor defect', async () => {
        // THE test. Both functions live in one file, the file plainly imports
        // and uses requireSession, and the file-level check passes. One of the
        // two is wide open.
        const found = scanSnippet(`
            "use server";
            import { requireSession } from "@/lib/session-guard";

            export async function updateOwnProduct(id: string) {
                const s = await requireSession();
                if (!s.session) return null;
                await db.collection("products").doc(id).update({ ok: true });
            }

            export async function zeroAnyonesStock(id: string) {
                await db.collection("products").doc(id).update({ stock: 0 });
            }
        `);

        expect(found).toContain('zeroAnyonesStock');
        expect(found).not.toContain('updateOwnProduct');
    });

    it('does not count a guard that is commented out', async () => {
        // admin.ts genuinely contains a large commented-out block holding
        // requireAdmin and requireSession, above a live body that has neither.
        // A text search counts those. Comments are not AST nodes, so this does
        // not.
        const found = scanSnippet(`
            "use server";
            export async function deprecatedAction(id: string) {
                /* Original implementation:
                const adminCheck = await requireAdmin();
                const sessionResult = await requireSession();
                */
                return { error: "Method deprecated" };
            }
        `);

        expect(found).toContain('deprecatedAction');
    });

    it('does not count a guard named only in a string', async () => {
        const found = scanSnippet(`
            "use server";
            export async function loggingAction(id: string) {
                logger.info("skipping requireSession() for this path");
                await db.collection("x").doc(id).delete();
            }
        `);

        expect(found).toContain('loggingAction');
    });

    it('follows withSafeAction to the implementation it wraps', async () => {
        // The dominant idiom here. Judging the wrapper on its own body would
        // report every action in the codebase.
        const found = scanSnippet(`
            "use server";
            async function _realAction(id: string) {
                const s = await requireSession();
                if (!s.session) return null;
            }
            export const realAction = withSafeAction("realAction", _realAction);
        `);

        expect(found).not.toContain('realAction');
    });

    it('follows the inline wrapper form too', async () => {
        // export async function x(p) { return withFlexibleSafeAction("x", _x)(p); }
        // Here the implementation is an ARGUMENT and never a callee. Missing
        // this form reported 31 wrappers as unguarded.
        const found = scanSnippet(`
            "use server";
            async function _realAction(id: string) {
                const s = await requireSession();
                if (!s.session) return null;
            }
            export async function realAction(id: string) {
                return withFlexibleSafeAction("realAction", _realAction)(id);
            }
        `);

        expect(found).not.toContain('realAction');
    });

    it('still flags a wrapper whose implementation is unguarded', async () => {
        // Vacuity guard for the two above: following delegation must not become
        // "anything wrapped is fine".
        const found = scanSnippet(`
            "use server";
            async function _openAction(id: string) {
                await db.collection("x").doc(id).delete();
            }
            export const openAction = withSafeAction("openAction", _openAction);
        `);

        expect(found).toContain('openAction');
    });

    it('terminates on a delegation cycle', async () => {
        // Two functions calling each other must not hang the test run.
        const found = scanSnippet(`
            "use server";
            export async function a(id: string) { return b(id); }
            export async function b(id: string) { return a(id); }
        `);

        expect(found).toEqual(['a', 'b']);
    });
});

describe('the codebase, against the baseline', () => {
    const current = scanDirectory(ACTIONS_DIR, SRC_DIR).map(keyOf);
    const known = new Set<string>(baseline.unguarded);

    it('has no unguarded action that is not already known', () => {
        const added = current.filter((k) => !known.has(k));

        if (added.length > 0) {
            throw new Error(
                `\n\n🚨 ${added.length} server action(s) reach no authorisation guard:\n\n` +
                added.map((a) => `  - ${a}`).join('\n') +
                `\n\nFIX: call requireSession() from '@/lib/session-guard' in the function,\n` +
                `or in the implementation it wraps.\n\n` +
                `If the action is genuinely public — a product listing, a pre-auth flow —\n` +
                `add it to src/__tests__/unit/action-auth-baseline.json WITH a reason in\n` +
                `the commit message. That file is a ratchet, not a parking space.\n`
            );
        }
        expect(added).toEqual([]);
    });

    it('has no baseline entry that is now guarded', () => {
        // The half that makes it a ratchet. Without this the list keeps names
        // that have since been fixed, and slowly stops meaning anything.
        const currentSet = new Set(current);
        const fixed = [...known].filter((k) => !currentSet.has(k));

        if (fixed.length > 0) {
            throw new Error(
                `\n\n✅ ${fixed.length} baseline entr(y/ies) now reach a guard:\n\n` +
                fixed.map((f) => `  - ${f}`).join('\n') +
                `\n\nRemove them from src/__tests__/unit/action-auth-baseline.json.\n` +
                `The list is allowed to shrink and nothing else.\n`
            );
        }
        expect(fixed).toEqual([]);
    });

    it('still finds actions to audit at all', () => {
        // If a refactor moves the actions directory, every assertion above
        // passes on an empty set. This is the guard against that silence.
        expect(current.length + known.size).toBeGreaterThan(0);
        expect(scanDirectory(ACTIONS_DIR, SRC_DIR).length).toBeGreaterThanOrEqual(0);
    });
});
