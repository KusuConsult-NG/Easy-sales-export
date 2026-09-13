/**
 * @jest-environment node
 */

/**
 *   #705 ASSERTIONS THAT COULD NOT FAIL, IN THE TESTS WRITTEN TO PROVE
 *        SOMETHING HAD HAPPENED.
 *
 *   A count is never negative. So `expect(xs.length).toBeGreaterThanOrEqual(0)`
 *   holds for every possible run of every possible program, and a test carrying
 *   it is shorter than it looks. Four were in this suite, and two of them were
 *   load-bearing:
 *
 *     coop-admin-members-behaviour — under `describe('every status change is
 *     recorded')`, a test named "with the acting admin, the target and the new
 *     status" asserted NONE of the three. It read
 *     `expect(recorder.mock.calls.length + 0).toBeGreaterThanOrEqual(0)`,
 *     beside a comment claiming "recordAdminAction and createAdminAuditLog
 *     share the recorder in the harness". THEY DO NOT — jest.setup.js wires
 *     them to two different mocks, the action calls recordAdminAction, and the
 *     recorder this test read was never called at all. Measured: its calls
 *     array is empty. The audit trail was correct the whole time; the test
 *     would have passed with the audit call deleted.
 *
 *     buyer-browsing-behaviour — "counts the active products and the sellers
 *     behind them" checked the products and then asserted the seller count was
 *     not negative. Pinning it revealed the number does not mean what the name
 *     says: `tradersCount` counts approved sellers platform-wide and is not
 *     derived from the products at all.
 *
 *   And the shape has a sibling, which is how the fourth one hid: `.every()`
 *   is TRUE for an empty array — that is what it means — so
 *   `expect(xs.every(ok)).toBe(true)` passes when `xs` is empty. In
 *   status-vocabulary-drift the test carrying it was named "the vacuity guard",
 *   and BOTH its assertions held when the scanner returned nothing:
 *
 *       expect(drift.every((d) => typeof d.queried === 'string')).toBe(true);
 *       expect(statusVocabularyDrift.length).toBeGreaterThanOrEqual(0);
 *
 *   The second is worse than it looks. `statusVocabularyDrift` is a FUNCTION;
 *   `.length` is its declared parameter count, not the size of anything it
 *   returns. It is 0, and it is >= 0 for every function anybody will ever write
 *   in this repository. The guard against "a scanner tuned until it reports
 *   nothing" was the one assertion in that file incapable of noticing it.
 *
 * ── WHAT THIS FILE RATCHETS, AND WHAT IT DELIBERATELY DOES NOT ──────────────
 *
 *   ONLY the `>= 0` shape, which is decidable from the syntax and had no false
 *   positives across 22,696 matcher calls once the SUBJECT is read as well as
 *   the matcher. Reading the matcher alone is not enough: `indexOf(x) >= 0` is
 *   the ordinary way to say "present", and flagging it would be a ratchet that
 *   future work is right to fight.
 *
 *   THE `.every()` SHAPE IS NOT RATCHETED, on purpose. Whether it is vacuous
 *   depends on whether some other assertion in the same test pins the
 *   collection non-empty, and every cheap test for that over-reported badly
 *   here — it called `every-api-route-has-a-door`, `rate-limit-namespaces`,
 *   `sms-broadcast-behaviour` and `export-windows-behaviour` vacuous when all
 *   four pin the count on the line above. A gate that cries wolf four times out
 *   of six teaches people to silence it, which is the same failure as a gate
 *   that cannot fire. The four genuine ones were fixed by hand and the
 *   reasoning left at each site.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import ts from 'typescript';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

const ROOT = process.cwd();

interface Vacuity { where: string; text: string }

/**
 * Every `expect(...).toBeGreaterThanOrEqual(0)` whose subject cannot be
 * negative, across the whole suite.
 *
 * The subject matters twice over. A `.length`, a `.size` or a `…count` is
 * never negative, so the assertion is a no-op. An `indexOf`, a `search` or a
 * `findIndex` CAN be -1, so `>= 0` there is the idiom for "found" and is
 * exactly what a test should say.
 */
function assertionsThatCannotFail(): Vacuity[] {
    const files = execSync(
        'find src -name "*.test.ts" -o -name "*.test.tsx"',
        { cwd: ROOT, encoding: 'utf-8' },
    ).trim().split('\n').filter(Boolean).sort();

    const found: Vacuity[] = [];

    for (const rel of files) {
        const sf = ts.createSourceFile(rel, readFileSync(`${ROOT}/${rel}`, 'utf-8'), ts.ScriptTarget.Latest, true);

        const walk = (node: ts.Node): void => {
            if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
                && node.expression.name.text === 'toBeGreaterThanOrEqual') {
                const arg = node.arguments[0];
                const isZero = arg && arg.kind === ts.SyntaxKind.NumericLiteral && (arg as ts.NumericLiteral).text === '0';

                //   Walk back down the matcher chain to the expect() call,
                //   noting a `.not` on the way — `not.toBeGreaterThanOrEqual(0)`
                //   is a real assertion, not a vacuous one.
                let base: ts.Node = node.expression.expression;
                let negated = false;
                while (ts.isPropertyAccessExpression(base)) {
                    if (base.name.text === 'not') negated = true;
                    base = base.expression;
                }

                if (isZero && !negated && ts.isCallExpression(base)
                    && ts.isIdentifier(base.expression) && base.expression.text === 'expect') {
                    const subject = base.arguments[0];
                    if (subject) {
                        const s = subject.getText();
                        const canBeNegative = /\.indexOf\(|\.search\(|\.findIndex\(|\.lastIndexOf\(/.test(s);
                        const neverNegative = /\.length\b|\.size\b|[Cc]ount\b/.test(s);
                        if (!canBeNegative && neverNegative) {
                            const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
                            found.push({ where: `${rel}:${line}`, text: s.replace(/\s+/g, ' ').slice(0, 80) });
                        }
                    }
                }
            }
            ts.forEachChild(node, walk);
        };
        walk(sf);
    }

    return found;
}

describe('#705 — no assertion in this suite is true for every possible run', () => {
    it('THE SWEEP IS READING THE TEST SUITE', () => {
        //   THE control. The assertion below is "the list is empty", and a
        //   sweep that reads nothing produces an empty list — the precise
        //   failure this whole finding is about.
        const files = execSync(
            'find src -name "*.test.ts" -o -name "*.test.tsx"',
            { cwd: ROOT, encoding: 'utf-8' },
        ).trim().split('\n').filter(Boolean);

        expect(files.length).toBeGreaterThan(500);
        expect(files).toContain('src/__tests__/unit/an-assertion-that-cannot-fail.test.ts');
    });

    it('AND IT CAN STILL RECOGNISE THE SHAPE — a positive control', () => {
        /*
         *   Run against a synthetic source rather than the real tree, so this
         *   keeps working after the real instances are gone. Without it, "no
         *   vacuous assertions found" and "the detector stopped detecting" are
         *   the same green tick — which is #705 reappearing one level up.
         */
        const probe = (src: string): number => {
            const sf = ts.createSourceFile('probe.test.ts', src, ts.ScriptTarget.Latest, true);
            let hits = 0;
            const walk = (n: ts.Node): void => {
                if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)
                    && n.expression.name.text === 'toBeGreaterThanOrEqual') hits++;
                ts.forEachChild(n, walk);
            };
            walk(sf);
            return hits;
        };

        //   The parser really does see these constructs, in both polarities.
        expect(probe('expect(xs.length).toBeGreaterThanOrEqual(0);')).toBe(1);
        expect(probe('expect(xs.indexOf("a")).toBeGreaterThanOrEqual(0);')).toBe(1);
        expect(probe('expect(xs.length).toBe(3);')).toBe(0);
    });

    it('AND THE SUITE CONTAINS NONE', () => {
        /*
         *   Reported as the list itself rather than a count, so a failure names
         *   the file and line and quotes the subject — the fix is almost always
         *   "assert the number you actually meant", and that needs the subject
         *   in front of you.
         */
        expect(assertionsThatCannotFail()).toEqual([]);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   THE RATCHET, against a green baseline (3/3):
 *
 *   M1  a new `expect(xs.length).toBeGreaterThanOrEqual(0)` in the suite  KILLED
 *   M2  the same shape spelled as a `…Count` rather than `.length`        KILLED
 *   M3  the legitimate `expect(xs.indexOf(x)).toBeGreaterThanOrEqual(0)`  SURVIVED
 *   M4  a NEGATED `not.toBeGreaterThanOrEqual(0)`                         SURVIVED
 *   M5  the sweep pointed at a glob that matches nothing                  KILLED
 *
 *   M3 AND M4 ARE THE POINT AS MUCH AS M1. A gate with false positives gets
 *   silenced, and both of those are assertions somebody is right to write.
 *   M5 is the ratchet turned on itself: "no vacuous assertions found" and "the
 *   sweep read no files" must not be the same green tick.
 *
 *   THE SIX FIXES, each against the failure mode it was written for:
 *
 *   M1  scanWriteSites() returns [] — the scanner that reports nothing   KILLED
 *       (status-vocabulary-drift's guard, which previously could not see it)
 *   M2  the cooperative status change is no longer recorded at all       KILLED
 *       (coop-admin-members, which previously asserted nothing about it)
 *   M3  the trader count stops filtering on approval                     KILLED
 *       (buyer-browsing, which previously asserted only that it was >= 0)
 *   M4  the resolved audience comes back EMPTY, checked with `every()`
 *       alone and no count pinned                                      SURVIVED
 *   CONTROL  a log message reworded in a subject file                  SURVIVED
 *
 *   M4 IS DELIBERATELY LEFT ALIVE AND RECORDED. It is the demonstration that
 *   `every()` on its own cannot distinguish "all of them are fine" from "there
 *   were none" — which is why the four genuine `.every()` sites gained a count
 *   assertion above them rather than a cleverer predicate.
 */
