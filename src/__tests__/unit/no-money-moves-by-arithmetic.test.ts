/**
 * @jest-environment node
 */

/**
 *   #669 THE MONEY TABLES, AUDITED — AND THE ANSWER IS THAT THEY ARE SOUND.
 *
 *   The captured server log showed `wave_withdrawals`, `wallet_transactions`
 *   and `fixed_savings_plans` resolving to `document_collections` rather than to
 *   dedicated tables. The worry that follows is specific: the concurrency
 *   guarantees this platform's money rests on are SQL functions, and a function
 *   written for a dedicated table does not necessarily reach a JSONB one. If the
 *   guarantees stopped at the table boundary, every balance in those three
 *   collections would be moving without them.
 *
 *   They do not stop there. Four questions were asked and all four came back
 *   clean:
 *
 *   1. DO THE WITHDRAWAL TRANSITIONS CLAIM? Yes. Every branch of the WAVE
 *      withdrawal admin path goes through claimStatusTransition, with its own
 *      note recording what it replaced: "This was labelled 'ATOMIC STATE
 *      TRANSITION & LOCKING' […] Neither was true: every branch read the status,
 *      compared it, and wrote — inside runTransaction, which takes no lock."
 *
 *   2. DOES THE CAS REACH document_collections? Yes, and it is careful about it.
 *      Read out of the LIVE function rather than the migration: for that table
 *      it appends `AND collection_name = $5` to the conditional UPDATE, and it
 *      REFUSES a claim that arrives without one — `IF p_table =
 *      'document_collections' AND (p_collection IS NULL OR TRIM(p_collection) =
 *      '')`. That matters more than it looks: document ids in this codebase are
 *      often the PAYMENT REFERENCE, so the same id exists in `transactions` and
 *      in `processed_payments`. Without the filter a claim could advance the
 *      wrong row. It fails closed instead.
 *
 *   3. IS ANY MONEY FIELD WRITTEN FROM JAVASCRIPT ARITHMETIC? No — and that is
 *      the property this file exists to keep. See below.
 *
 *   4. WHAT ABOUT THE ONE PLACE A STATUS IS STILL DERIVED FROM A READ? Loan
 *      repayment lines, and it is deliberate and documented: `paidAmount` moves
 *      by increment and only the LABEL is best-effort. "Money first, labels
 *      best-effort: the reverse is what lost the payment."
 *
 * ── WHY A NO-FINDING IS WORTH A FILE ────────────────────────────────────────
 *
 *   Because the measurement is only true today. The sweep below is the one that
 *   produced answer 3, and it is kept rather than run once and reported: a
 *   balance written as `current + delta` is the defect this whole layer of SQL
 *   functions was built to prevent, and it takes one line to reintroduce.
 *
 *   THE SWEEP WAS VALIDATED BEFORE ITS ANSWER WAS BELIEVED. Two probes were
 *   added to a real module and the sweep run against the tree: `balance: current
 *   + delta` was found, `balance: FieldValue.increment(delta)` was not. Both
 *   probes are in this file now as fixtures, so the instrument is checked on
 *   every run rather than on the day it was written.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(join(ROOT, dir))) {
        const rel = `${dir}/${e}`;
        if (statSync(join(ROOT, rel)).isDirectory()) {
            if (e !== '__tests__') walk(rel, out);
        } else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) {
            out.push(rel);
        }
    }
    return out;
}

/** Field names that hold money. */
const MONEY_FIELD = /(balance|Balance|paidAmount|amountPaid|totalPaid|walletBalance|lockedBalance|savingsBalance|earnings|Earnings)\s*:/;

/** A value computed in JavaScript from something read earlier. */
const ARITHMETIC = /[^=!<>]=?\s*[^,\n]*\b\w+\s*[+-]\s*\w/;

/**
 * Lines that write a money field from arithmetic rather than atomically.
 *
 * Exported shape rather than a count, so a failure names the file and line —
 * and so the instrument itself can be asked questions with known answers.
 */
function arithmeticMoneyWrites(source: string, label = '<input>'): string[] {
    return source.split('\n').flatMap((line, i) => {
        const code = line.replace(/\/\/.*$/, '');
        const field = MONEY_FIELD.exec(code);
        if (!field) return [];

        /*
         *   THE MONEY FIELD'S OWN VALUE, not everything after the line's first
         *   colon. A mutation run caught this: an injected
         *   `(ref: any, current: number) => ref.update({ balance: current + 1 })`
         *   SURVIVED, because the slice started at the colon in `ref: any` and
         *   the type-position guard below then matched `current: number` and
         *   threw the whole line away. The sweep was reading the wrong half of
         *   the line and excluding on the strength of it.
         */
        const value = code.slice((field.index ?? 0) + field[0].length);

        //   The atomic forms. FieldValue.increment is resolved in SQL, so two
        //   callers cannot lose each other's movement — including when the
        //   amount handed to it is itself arithmetic.
        if (/FieldValue\.increment|increment\(/.test(value)) return [];
        if (!ARITHMETIC.test(value)) return [];
        if (/^\s*(\/\/|\*|const\s+\w+\s*=\s*\{)/.test(code)) return [];
        //   A type position, not a write: `balance: number`.
        if (/^\s*(number|string|boolean)\b/.test(value)) return [];
        return [`${label}:${i + 1}  ${code.trim().slice(0, 80)}`];
    });
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#669 — the instrument, before its answer is believed', () => {
    /*
     *   THE PROBES THAT VALIDATED THE SWEEP, kept as fixtures. They were added
     *   to a real module and the sweep run against the tree; that checked the
     *   instrument on the day it was written and never again. Here they are
     *   checked on every run.
     */
    it('IT FINDS A BALANCE WRITTEN FROM A PREVIOUS READ', () => {
        const bad = [
            'await ref.update({',
            '    balance: current + delta,',
            '});',
        ].join('\n');

        expect(arithmeticMoneyWrites(bad)).toHaveLength(1);
    });

    it('AND DOES NOT FLAG THE ATOMIC FORM, EVEN WHEN THE AMOUNT IS ARITHMETIC', () => {
        /*
         *   The negative control. A sweep that flagged increments would report
         *   every correct money path in the codebase and be switched off.
         *
         *   THE AMOUNT IS ARITHMETIC ON PURPOSE. A mutation run showed the
         *   increment guard was dead against the simpler fixture — the value
         *   held no `+`, so removing the guard changed nothing and the mutant
         *   survived. `increment(base + bonus)` is the shape that makes the
         *   guard load-bearing, and it is a shape this codebase writes.
         */
        const good = [
            'await ref.update({',
            '    balance: FieldValue.increment(base + bonus),',
            '});',
        ].join('\n');

        expect(arithmeticMoneyWrites(good)).toEqual([]);
    });

    it('AND FINDS ONE HIDDEN BEHIND A TYPE ANNOTATION', () => {
        //   The exact line that survived the first mutation run.
        const sneaky = 'async function f(ref: any, current: number, d: number) { await ref.update({ balance: current + d }); }';

        expect(arithmeticMoneyWrites(sneaky)).toHaveLength(1);
    });

    it('AND FINDS ONE BESIDE A FIELD THAT IS INCREMENTED CORRECTLY', () => {
        /*
         *   THE case that makes reading the money field's OWN value matter, and
         *   a mutation run is what produced it. An update that increments one
         *   field and writes another by hand is the realistic shape of this
         *   defect — half the object is right, which is why it survives review.
         *
         *   Slicing from the line's first colon sees `increment(` earlier in
         *   the object and excludes the whole line: the correct half hides the
         *   broken one.
         */
        const mixed = 'await ref.update({ fee: FieldValue.increment(1), balance: current + d });';

        expect(arithmeticMoneyWrites(mixed)).toHaveLength(1);
    });

    it('AND IGNORES A FIGURE COMPUTED FOR THE SCREEN', () => {
        /*
         *   The two hits the sweep returns against the tree are both of this
         *   kind — a number worked out to render, not written anywhere. Kept
         *   distinguishable so the real list stays empty and meaningful.
         */
        const display = 'const nextPaymentAmount: number = due - paid;';

        expect(arithmeticMoneyWrites(display)).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#669 — and no money field in the application is written that way', () => {
    it('NOT ONE, ACROSS EVERY ACTION, LIBRARY AND SERVICE', () => {
        /*
         *   THE measurement. Every balance movement in this codebase goes
         *   through FieldValue.increment — resolved by apply_increments in SQL —
         *   or through one of the wallet functions. A `current + delta` write is
         *   what those exist to prevent, and it takes one line to reintroduce.
         *
         *   Screens are excluded, not app logic: a .tsx under app/ that computes
         *   a figure to render is not moving money, and the two such lines in
         *   the tree would make this list permanently non-empty and therefore
         *   permanently ignored.
         */
        const offenders = [...walk('src/app'), ...walk('src/lib'), ...walk('src/services')]
            .filter((f) => !f.endsWith('.tsx'))
            .flatMap((f) => arithmeticMoneyWrites(read(f), f));

        expect({ offenders }).toEqual({ offenders: [] });
    });

    it('AND THE SWEEP ACTUALLY READ SOMETHING', () => {
        //   A control on the line above: a walk that returned nothing would
        //   report a clean tree for ever.
        const files = [...walk('src/app'), ...walk('src/lib'), ...walk('src/services')];

        expect(files.length).toBeGreaterThan(500);
        expect(files.some((f) => f === 'src/lib/wallet-ledger.ts')).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#669 — and the claim reaches the JSONB table it has to', () => {
    it('THE ADAPTER PASSES THE COLLECTION WHEN THE TABLE IS THE GENERIC ONE', () => {
        /*
         *   Document ids here are often the PAYMENT REFERENCE, so the same id
         *   exists in `transactions` and in `processed_payments`. A claim
         *   against document_collections that did not name the collection could
         *   advance the wrong row.
         */
        const adapter = read('src/lib/status-transition.ts');

        expect(adapter).toContain('p_collection: table === "document_collections" ? collection : null');
    });

    it('AND THE MIGRATION BOTH FILTERS ON IT AND REFUSES WITHOUT IT', () => {
        /*
         *   Read from the migration rather than inferred from the adapter — the
         *   two are different statements of one contract, and the SQL is the one
         *   that decides. It appends the filter for that table and fails closed
         *   when the collection is missing, rather than matching on id alone.
         */
        const sql = read('supabase/migrations/025_status_transition_dedicated_tables.sql');

        expect(sql).toContain("AND collection_name = $5");
        expect(sql).toMatch(/p_table = 'document_collections' AND \(p_collection IS NULL/);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: a balance is written as `current + delta`           KILLED
 *     the sweep stops recognising arithmetic                          KILLED
 *     the sweep starts flagging FieldValue.increment                  KILLED
 *     the sweep reads from the line's first colon again                KILLED
 *     the walk returns nothing                                        KILLED
 *     the adapter stops passing the collection                        KILLED
 *     the migration stops filtering on collection_name                KILLED
 *     the migration stops refusing a claim with no collection         KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                              SURVIVED ✓
 *
 * ── WHAT WAS MEASURED, AND WHERE ────────────────────────────────────────────
 *
 *   The claim-reaches-JSONB answer was read out of the LIVE function on a real
 *   PostgreSQL — `SELECT prosrc FROM pg_proc WHERE proname =
 *   'claim_status_transition_in'` — not only out of the migration file, because
 *   what a database does is decided by what is installed in it.
 *
 *   The arithmetic sweep was run against the tree and returned two hits, both
 *   `.tsx` figures computed for display. It was then validated with the two
 *   probes now kept as fixtures above.
 */
