/**
 * @jest-environment node
 */

/**
 *   #357 THE FAKE-ID CHECK WAS INERT THREE TIMES OVER, AND ITS HEADER
 *        DESCRIBED AN ACTIVE BLOCKLIST.
 *
 *        lib/kyc-validators.ts opened by listing four families of placeholder
 *        it "blocks" — all-same-digit, sequential, repeating, common. Then:
 *
 *            export function isObviouslyFakeId(id: string): boolean {
 *                // [BYPASSED] Force return false ...
 *                return false;
 *            }
 *
 *        Three separate faults, any one of which was enough on its own:
 *
 *        (a) THE FUNCTION RETURNED false UNCONDITIONALLY. #245's shape — a
 *            control that reads as present and is none — in the file whose
 *            entire job is to be that control.
 *
 *        (b) THE PATTERNS WERE NEVER WRITTEN. ASCENDING and DESCENDING sat
 *            there as unused constants: the doubled digit strings a check
 *            would need, and no check. Un-bypassing (a) would have left
 *            nothing to run.
 *
 *        (c) NEITHER CALLER CALLED IT. actions/kyc.ts imported
 *            isObviouslyFakeId AND fakeIdErrorMessage; KYCForm.tsx imported
 *            isObviouslyFakeId. Not one of those names appeared anywhere below
 *            its own import line. So the wire was never run either — fixing
 *            (a) and (b) alone would still have changed nothing. That is #354's
 *            shape (a queue with no producer) and #337's (a button that did
 *            not perform the action), in the same file.
 *
 *        WHY IT IS STILL OFF, DELIBERATELY.
 *
 *        The owner's standing instruction is to keep QoreID out for now, and
 *        the bypass exists for exactly that: verifyNINAction and
 *        verifyBVNAction accept any 11 digits, so placeholder values have to
 *        keep working while testing. Switching this on today would break the
 *        owner's own flow.
 *
 *        So the three faults are fixed separately from the decision. The check
 *        is real and tested; the GATE is off unless KYC_REJECT_FAKE_IDS is
 *        "true"; and both callers now actually call the gate, so setting the
 *        flag reaches something. With the flag unset every one of these paths
 *        behaves exactly as it did before this commit — which is the point.
 *
 *        OWNER DECISION: set KYC_REJECT_FAKE_IDS=true when QoreID returns, or
 *        when placeholder identity numbers are no longer needed for testing.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';

const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

const MODULE = 'src/lib/kyc-validators.ts';
const SERVER = 'src/app/actions/kyc.ts';
const FORM = 'src/components/onboarding/KYCForm.tsx';

const originalFlag = process.env.KYC_REJECT_FAKE_IDS;

beforeEach(() => {
    delete process.env.KYC_REJECT_FAKE_IDS;
});

afterEach(() => {
    if (originalFlag === undefined) delete process.env.KYC_REJECT_FAKE_IDS;
    else process.env.KYC_REJECT_FAKE_IDS = originalFlag;
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#357 — the check itself is real now', () => {
    it('ALL-SAME-DIGIT IDS ARE RECOGNISED', async () => {
        // THE test. The header claimed these were blocked and none was.
        const { looksLikeFakeId } = await import('@/lib/kyc-validators');

        for (let d = 0; d <= 9; d++) {
            expect(looksLikeFakeId(String(d).repeat(11))).toBe(true);
        }
    });

    it('SEQUENTIAL RUNS ARE RECOGNISED, ASCENDING AND DESCENDING', async () => {
        const { looksLikeFakeId } = await import('@/lib/kyc-validators');

        for (const id of ['01234567890', '12345678901', '23456789012', '78901234567']) {
            expect(looksLikeFakeId(id)).toBe(true);
        }
        for (const id of ['98765432109', '87654321098', '10987654321']) {
            expect(looksLikeFakeId(id)).toBe(true);
        }
    });

    it('and a run that WRAPS is caught, which is why the constants are doubled', async () => {
        // 89012345678 crosses 9→0. A non-doubled string would miss it.
        const { looksLikeFakeId } = await import('@/lib/kyc-validators');

        expect(looksLikeFakeId('89012345678')).toBe(true);
        expect(looksLikeFakeId('21098765432')).toBe(true);
    });

    it('REPEATING BLOCKS ARE RECOGNISED — 2, 3, 4 and 5 digits long', async () => {
        const { looksLikeFakeId } = await import('@/lib/kyc-validators');

        expect(looksLikeFakeId('12121212121')).toBe(true);   // block of 2
        expect(looksLikeFakeId('12312312312')).toBe(true);   // block of 3
        expect(looksLikeFakeId('12341234123')).toBe(true);   // block of 4
        expect(looksLikeFakeId('12345123451')).toBe(true);   // block of 5
    });

    it('A REAL-LOOKING ID IS NOT REJECTED — the other side', async () => {
        // The half that matters most. A false positive here refuses a real
        // person their identity verification.
        const { looksLikeFakeId } = await import('@/lib/kyc-validators');

        for (const id of ['22348915073', '70316482905', '19384756201', '54098127634']) {
            expect(looksLikeFakeId(id)).toBe(false);
        }
    });

    it('and anything that is not 11 digits is not its business', async () => {
        // Length is the callers' complaint, made with their own message.
        const { looksLikeFakeId } = await import('@/lib/kyc-validators');

        for (const id of ['', '   ', '1234', '111111111111', 'abcdefghijk', '1234567890a']) {
            expect(looksLikeFakeId(id)).toBe(false);
        }
        expect(looksLikeFakeId(undefined as any)).toBe(false);
        expect(looksLikeFakeId(null as any)).toBe(false);
    });

    it('THE CONSTANTS ARE USED NOW, HAVING BEEN DECLARED AND NEVER READ', () => {
        const code = source(MODULE);
        const body = code.slice(code.indexOf('export function looksLikeFakeId'));

        expect(body).toContain('ASCENDING.includes(digits)');
        expect(body).toContain('DESCENDING.includes(digits)');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#357 — the GATE is off, on purpose, and says so', () => {
    it('WITH THE FLAG UNSET, NOTHING IS REJECTED — today\'s behaviour, unchanged', async () => {
        // The owner is testing with placeholder numbers. This must keep working.
        const { isObviouslyFakeId } = await import('@/lib/kyc-validators');

        for (const id of ['00000000000', '11111111111', '12345678901', '12121212121']) {
            expect(isObviouslyFakeId(id)).toBe(false);
        }
    });

    it('AND WITH IT SET, THE SAME IDS ARE REJECTED', async () => {
        // The switch reaches something, which the `return false;` did not.
        process.env.KYC_REJECT_FAKE_IDS = 'true';
        const { isObviouslyFakeId } = await import('@/lib/kyc-validators');

        for (const id of ['00000000000', '11111111111', '12345678901', '12121212121']) {
            expect(isObviouslyFakeId(id)).toBe(true);
        }
        expect(isObviouslyFakeId('22348915073')).toBe(false);   // and a real one still passes
    });

    it('only the exact string "true" switches it on', async () => {
        const { fakeIdRejectionEnabled } = await import('@/lib/kyc-validators');

        for (const value of ['false', '1', 'yes', 'TRUE', '']) {
            process.env.KYC_REJECT_FAKE_IDS = value;
            expect(fakeIdRejectionEnabled()).toBe(false);
        }
        process.env.KYC_REJECT_FAKE_IDS = 'true';
        expect(fakeIdRejectionEnabled()).toBe(true);
    });

    it('THE `[BYPASSED] return false` ONE-LINER IS GONE', () => {
        const raw = readFileSync(MODULE, 'utf-8');

        expect(raw).not.toMatch(/\[BYPASSED\] Force return false/);
        expect(source(MODULE)).not.toMatch(/export function isObviouslyFakeId\(id: string\): boolean \{\s*return false;\s*\}/);
    });

    it('and the header states the switch rather than hiding it', () => {
        // Strengthened after a mutant survived: asserting that the flag name
        // appears SOMEWHERE passed even with the sentence that explains the
        // gate deleted, because the name also appears in the owner-decision
        // line. Both halves are required now — what the gate returns, and when.
        const raw = readFileSync(MODULE, 'utf-8');

        expect(raw).toMatch(/EVERY PART OF THIS FILE WAS INERT/);
        expect(raw).toMatch(/the GATE\. Returns looksLikeFakeId\(id\) when[\s\S]{0,80}KYC_REJECT_FAKE_IDS === "true"/);
        expect(raw).toMatch(/OWNER DECISION: set KYC_REJECT_FAKE_IDS=true/);
    });

    it('RECORDED: the all-same-digit rule is redundant, and kept anyway', async () => {
        // Mutation testing showed deleting that line changes no answer — the
        // repeating-block loop catches all ten with a block of "dd". Pinned in
        // both directions so the redundancy stays a choice: if somebody removes
        // the BLOCK loop believing the same-digit line covers it, the first
        // assertion here fails.
        const { looksLikeFakeId } = await import('@/lib/kyc-validators');

        for (let d = 0; d <= 9; d++) {
            const id = String(d).repeat(11);
            // Caught by the block rule alone — this is what makes it redundant.
            expect(String(d).repeat(2).repeat(6).slice(0, 11)).toBe(id);
            expect(looksLikeFakeId(id)).toBe(true);
        }

        expect(readFileSync(MODULE, 'utf-8')).toMatch(/REDUNDANT, AND KEPT ON PURPOSE/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#357 — both callers actually call it now', () => {
    it('THE SERVER BVN PATH CALLS IT', () => {
        const code = source(SERVER);
        const bvn = code.slice(code.indexOf('async function _verifyBVNAction'),
                               code.indexOf('async function _verifyNINAction'));

        expect(bvn).toContain('isObviouslyFakeId(String(bvn).trim())');
        expect(bvn).toContain("fakeIdErrorMessage('BVN')");
    });

    it('THE SERVER NIN PATH CALLS IT', () => {
        const code = source(SERVER);
        const nin = code.slice(code.indexOf('async function _verifyNINAction'));

        expect(nin).toContain('isObviouslyFakeId(String(nin).trim())');
        expect(nin).toContain("fakeIdErrorMessage('NIN')");
    });

    it('and the browser form calls it on both, having imported it and not', () => {
        const code = source(FORM);

        expect(code.match(/isObviouslyFakeId\(/g) ?? []).toHaveLength(2);
        expect(code).toContain("fakeIdErrorMessage('BVN')");
        expect(code).toContain("fakeIdErrorMessage('NIN')");
    });

    it('THE IMPORTED-AND-NEVER-CALLED STATE CANNOT COME BACK', () => {
        // The finding in one measurement. An import of this module that never
        // calls anything is the exact shape all three callers were in.
        //
        // Reads the WHOLE import statement rather than the one line carrying
        // the module path. Both callers have since grown a multi-line import —
        // the voter's-card validators joined this module — and a line-based
        // scan finds `} from '@/lib/kyc-validators';`, which carries no names
        // at all. That tripped the vacuity guard below, correctly: the check
        // had stopped being able to see what was imported. It now cannot be
        // fooled by formatting.
        for (const file of [SERVER, FORM]) {
            const code = source(file);
            const statement = code.match(
                /import\s*\{([^}]*)\}\s*from\s*['"][^'"]*kyc-validators['"]\s*;/);

            expect(statement).not.toBeNull();                 // the import exists
            const names = [...statement![1].matchAll(/\b([A-Za-z_$][\w$]*)\b/g)].map((m) => m[1]);

            expect(names.length).toBeGreaterThan(0);          // vacuity guard
            const body = code.replace(statement![0], '');
            for (const name of names) {
                // Every name brought in must be USED — called, or read as the
                // constant it is. That is the whole property.
                expect(body.includes(name)).toBe(true);
            }
        }
    });

    it('and the length check still runs FIRST, so the message is the right one', () => {
        // A four-digit BVN must be told it is four digits, not that it looks
        // like a placeholder.
        const code = source(SERVER);
        const bvn = code.slice(code.indexOf('async function _verifyBVNAction'));

        expect(bvn.indexOf('A BVN must be 11 digits'))
            .toBeLessThan(bvn.indexOf('isObviouslyFakeId'));
    });

    it("VACUITY GUARD: the QoreID bypass itself is untouched", () => {
        // The owner asked for QoreID to stay out. It has. Both actions still
        // record isMatch: true for any 11 digits.
        const code = source(SERVER);

        expect(code).toContain("'kyc.bvnVerified': true");
        expect(code).toContain("'kyc.ninVerified': true");
        expect(code.match(/data: \{ isMatch: true \}/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    });
});
