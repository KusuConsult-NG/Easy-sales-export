/**
 * @jest-environment node
 */

/**
 *   #369 THREE ORPHANED SCHEMA MODULES, AND TWO OF THEM CONTRADICTED THE LIVE
 *        RULE THEY DUPLICATE.
 *
 *        Continuing the zero-coverage sweep that produced #367. Three more
 *        files have no importer at all:
 *
 *          src/lib/validations/escrow.ts
 *          src/lib/validations/cooperative.ts
 *          src/lib/types/db-schemas.ts
 *
 *        Being unused is not itself the finding. What they SAY is.
 *
 *        (1) THE ESCROW STATUS LIST HAD A NINTH VALUE THE APPLICATION NEVER
 *            WRITES. validations/escrow.ts hand-wrote nine statuses, including
 *            "completed". ESCROW_STATUSES in lib/escrow-status.ts — the union
 *            the application writes, and the one ESCROW_FREEZABLE_STATUSES,
 *            ESCROW_RELEASABLE_FROM and ESCROW_REFUNDABLE_FROM are all derived
 *            from — has eight and no "completed".
 *
 *            "completed" is a WALLET TRANSACTION status: _escrow_lifecycle.ts
 *            and _escrow_actions.ts write `status: "completed"` on wallet and
 *            ledger rows, never on an escrow. A schema calling itself the
 *            escrow status validator would therefore have admitted a value that
 *            makes an escrow invisible to every one of those sets — releasable
 *            from nothing, freezable from nothing, refundable from nothing.
 *
 *            escrow-status.ts exists precisely to stop this; its header says
 *            "so two callers cannot drift apart again". The enum is DERIVED
 *            from it now.
 *
 *            A CORRECTION TO MY OWN FIRST WRITE-UP, which said escrow-status.ts
 *            never mentions "completed". It does, twice and deliberately:
 *            normaliseEscrowStatus MAPS "completed" to "released" because the
 *            value does occur in stored data, and the file's own notes record
 *            that a transition table naming `completed` as a target was dead
 *            code for exactly this reason. So the live module COERCES the
 *            legacy value; the orphaned schema would have stored it as a status
 *            in its own right. That is worse than merely wrong.
 *
 *        (2) A "TYPE-SAFE PARSER" WHOSE REFUSAL PATH RETURNED THE UNVALIDATED
 *            INPUT. db-schemas.ts's parseUserDoc built defaults on a failed
 *            safeParse and then ended `...(raw as object)`, spreading the raw
 *            input back over them — so every field the schema had just refused,
 *            including whichever one failed, came back, typed as validated.
 *
 *            Same family as #245, #112 and #365: a control whose refusal leads
 *            somewhere other than a refusal. It throws now, which is what its
 *            own non-object branch already did.
 *
 *        WHAT IS RECORDED AND NOT CHANGED
 *        --------------------------------
 *        escrowReleaseSchema requires `deliveryConfirmed === true` before a
 *        release, while ESCROW_RELEASABLE_FROM permits release from "funded"
 *        and "in_transit" — which is what the admin release and the
 *        dispute-resolution release both do. Adopting the schema as written
 *        would break both. Which is the intended policy is a product question.
 *
 *        db-schemas.ts's membershipStatus omits "under_review", which the live
 *        union in lib/types/firestore.ts includes and the cooperative
 *        application flow writes. NOT derived, because firestore.ts states it
 *        as a TypeScript union with no runtime constant — adding the value by
 *        hand would leave two hand-written lists agreeing by luck.
 *
 *        OWNER DECISION: adopt these schemas at their boundaries — which needs
 *        the release rule settled and the cooperative statuses promoted to a
 *        runtime constant the way ESCROW_STATUSES and ORDER_STATUSES already
 *        are — or retire the three files.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, relative, dirname, resolve } from 'path';
import { escrowStatusUpdateSchema, escrowReleaseSchema } from '@/lib/validations/escrow';
import { ESCROW_STATUSES, ESCROW_RELEASABLE_FROM, normaliseEscrowStatus } from '@/lib/escrow-status';
import { parseUserDoc, UserDocumentSchema } from '@/lib/types/db-schemas';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'));

function walk(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) {
            if (e.name === '__tests__') continue;
            walk(rel, out);
        } else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.')) out.push(rel);
    }
    return out;
}

const SRC = walk('src');

function resolveSpec(fromFile: string, spec: string): string | null {
    let base: string;
    if (spec.startsWith('@/')) base = join(ROOT, 'src', spec.slice(2));
    else if (spec.startsWith('.')) base = resolve(ROOT, dirname(fromFile), spec);
    else return null;
    for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
        if (existsSync(c) && statSync(c).isFile()) return relative(ROOT, c);
    }
    return null;
}

/** Files that import a module, resolved properly rather than by basename. */
function importersOf(target: string): string[] {
    const out: string[] = [];
    for (const f of SRC) {
        if (f === target) continue;
        for (const m of code(f).matchAll(/(?:from\s*|import\s*\(\s*)["']([^"']+)["']/g)) {
            if (resolveSpec(f, m[1]) === target) { out.push(f); break; }
        }
    }
    return out;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#369 — the escrow schema no longer admits a status the app never writes', () => {
    it('ITS STATUS LIST IS DERIVED FROM ESCROW_STATUSES', () => {
        const accepted = ESCROW_STATUSES.filter(
            (s) => escrowStatusUpdateSchema.safeParse({ transactionId: 't', status: s }).success);

        expect([...accepted].sort()).toEqual([...ESCROW_STATUSES].sort());
    });

    it('and "completed" — the wallet-transaction status — is refused', () => {
        expect(escrowStatusUpdateSchema.safeParse({ transactionId: 't', status: 'completed' }).success)
            .toBe(false);
        expect([...ESCROW_STATUSES]).not.toContain('completed');
    });

    it('the live module treats "completed" as a LEGACY value to coerce, not a valid one', () => {
        // A correction to my own first draft of this test, which asserted that
        // escrow-status.ts never mentions "completed". It does — twice, and
        // deliberately. normaliseEscrowStatus MAPS it, because the value does
        // occur in stored data, and the file's own #2 note explains that a
        // transition table naming `completed` as a target was dead code.
        //
        // That makes the orphan's enum worse than merely wrong: the live module
        // coerces the legacy value to `released`, and the schema would have
        // stored it as a status in its own right.
        expect(normaliseEscrowStatus('completed')).toBe('released');
        expect([...ESCROW_STATUSES]).not.toContain('completed');

        // And where "completed" IS written, it is on a wallet/ledger row.
        const lifecycle = code('src/app/actions/marketplace/_escrow_lifecycle.ts');

        expect(lifecycle).toContain('type: "funding"');
        expect(lifecycle).toContain('status: "completed"');
    });

    it('the derivation is not a hand-copy — it names the constant', () => {
        const src = code('src/lib/validations/escrow.ts');

        expect(src).toContain('z.enum(ESCROW_STATUSES)');
        expect(src).toContain("from '@/lib/escrow-status'");
    });

    it('RECORDED: its release rule is stricter than the live one', () => {
        // escrowReleaseSchema demands deliveryConfirmed === true.
        expect(escrowReleaseSchema.safeParse({ transactionId: 't', deliveryConfirmed: false }).success)
            .toBe(false);
        // The live rule releases from funded and in_transit, before delivery.
        expect([...ESCROW_RELEASABLE_FROM]).toContain('funded');
        expect([...ESCROW_RELEASABLE_FROM]).toContain('in_transit');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#369 — the type-safe parser refuses instead of returning the input', () => {
    it('a valid document parses', () => {
        const doc = parseUserDoc({ id: 'u1', email: 'a@b.co', roles: ['general_user'] });

        expect(doc.id).toBe('u1');
        expect(doc.onboardingCompleted).toBe(false);
    });

    it('A DOCUMENT THE SCHEMA REFUSES IS NOT HANDED BACK', () => {
        // id is z.string(). A numeric id fails, and the old failure path
        // returned it anyway via `...(raw as object)`.
        const bad = { id: 12345, email: 'a@b.co', roles: 'not-an-array' };

        expect(UserDocumentSchema.safeParse(bad).success).toBe(false);
        expect(() => parseUserDoc(bad)).toThrow(TypeError);
        expect(() => parseUserDoc(bad)).toThrow(/does not match UserDocumentSchema/);
    });

    it('and the failure names the field, so a caller can act on it', () => {
        expect(() => parseUserDoc({ id: 12345 })).toThrow(/id/);
    });

    it('a non-object still throws, which the failure path now matches', () => {
        expect(() => parseUserDoc(null)).toThrow(/non-object/);
        expect(() => parseUserDoc('a string')).toThrow(/non-object/);
    });

    it('the spread that reinstated the refused input is gone', () => {
        expect(code('src/lib/types/db-schemas.ts')).not.toContain('...(raw as object)');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#369 — RECORDED: the cooperative membership drift', () => {
    it('db-schemas omits a status the live union has and the flow writes', () => {
        const live = code('src/lib/types/firestore.ts');

        expect(live).toContain('membershipStatus?: "pending" | "approved" | "active" | "rejected" | "under_review" | "suspended"');
        expect(code('src/lib/types/db-schemas.ts')).not.toContain("'under_review'");
    });

    it('and there is no runtime constant to derive it from, which is why it stands', () => {
        // ESCROW_STATUSES and ORDER_STATUSES exist at run time; the cooperative
        // membership statuses do not. Stated so the asymmetry with the escrow
        // fix above is a reason rather than an inconsistency.
        expect(code('src/lib/escrow-status.ts')).toContain('export const ESCROW_STATUSES');
        expect(code('src/lib/order-status.ts')).toContain('export const ORDER_STATUSES');
        expect(code('src/lib/types/firestore.ts')).not.toContain('export const MEMBERSHIP_STATUSES');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#369 — all three are orphans, measured', () => {
    for (const file of [
        'src/lib/validations/escrow.ts',
        'src/lib/validations/cooperative.ts',
        'src/lib/types/db-schemas.ts',
    ]) {
        it(`${file} has no importer`, () => {
            expect(importersOf(file)).toEqual([]);
        });
    }

    it('and each says so, so "kept for X" is not read as "used for X"', () => {
        for (const file of [
            'src/lib/validations/escrow.ts',
            'src/lib/validations/cooperative.ts',
            'src/lib/types/db-schemas.ts',
        ]) {
            const raw = readFileSync(join(ROOT, file), 'utf-8');

            expect({ file, labelled: raw.includes('#369') }).toEqual({ file, labelled: true });
        }
    });

    it('the importer sweep reports importers where they exist', () => {
        // Vacuity guard: an empty answer must not come from a broken sweep.
        expect(importersOf('src/lib/escrow-status.ts').length).toBeGreaterThan(3);
        // 6 since #443: _mp_catalog.ts and _mp_buyer_dashboard.ts stopped
        // importing ProductSchema/OrderSchema when their parse-or-raw-document
        // fallbacks were replaced by serializeProduct/serializeOrder, and
        // lib/firestore-serialize.ts picked both schemas up in their place.
        expect(importersOf('src/lib/validations/marketplace.ts').length).toBe(6);
    });

    it('and it is measured on code, not on prose', () => {
        // The #369 notes name the sibling modules. A raw-text sweep would count
        // those mentions as imports — the tombstone trap, ten times now.
        const raw = readFileSync(join(ROOT, 'src/lib/types/db-schemas.ts'), 'utf-8');

        expect(raw).toContain('lib/canonical/schemas.ts');
        expect(code('src/lib/types/db-schemas.ts')).not.toContain('lib/canonical/schemas.ts');
    });
});
