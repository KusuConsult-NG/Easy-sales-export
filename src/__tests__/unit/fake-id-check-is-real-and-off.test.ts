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
describe('#485 — the GATE is ON, because it is the only check left', () => {
    /**
     *   #485 THESE ASSERTIONS PINNED THE GATE SHUT.
     *
     *        They were right when written: the gate was off because the owner
     *        needed placeholder identity numbers to keep working while the
     *        external identity provider was out of service, and the top one
     *        said so — "the owner is testing with placeholder numbers, this must
     *        keep working."
     *
     *        The provider is now parked permanently, which makes this pattern
     *        test the ONLY check any identity number in this platform receives.
     *        An only check must not be opt-in, so the flag was reversed — and
     *        these three assertions, unchanged, would have held it opt-in
     *        forever. Tenth time in this audit that a green test has been the
     *        thing keeping a defect in place.
     */
    it('WITH NOTHING CONFIGURED, PLACEHOLDERS ARE REJECTED', async () => {
        //   THE test. A deployment that sets no environment variable gets the
        //   check, which is the direction a KYC control fails.
        const { isObviouslyFakeId } = await import('@/lib/kyc-validators');

        for (const id of ['00000000000', '11111111111', '12345678901', '12121212121']) {
            expect({ id, rejected: isObviouslyFakeId(id) }).toEqual({ id, rejected: true });
        }
    });

    it('AND A REAL-LOOKING NUMBER IS STILL ACCEPTED', async () => {
        //   The half that stops the gate from being satisfied by a function
        //   that refuses everything, which would halt enrolment entirely.
        const { isObviouslyFakeId } = await import('@/lib/kyc-validators');

        for (const id of ['22348915073', '70316482905', '19384756201']) {
            expect({ id, rejected: isObviouslyFakeId(id) }).toEqual({ id, rejected: false });
        }
    });

    it('AND IT CAN STILL BE TURNED OFF FOR A TESTING WINDOW — but only explicitly', async () => {
        //   The switch is kept and reversed rather than removed: the owner's
        //   original need was real, and a deliberate "false" still serves it.
        const { fakeIdRejectionEnabled, isObviouslyFakeId } = await import('@/lib/kyc-validators');

        process.env.KYC_REJECT_FAKE_IDS = 'false';
        expect(fakeIdRejectionEnabled()).toBe(false);
        expect(isObviouslyFakeId('11111111111')).toBe(false);
    });

    it('and no other value turns it off — not "0", not "no", not empty', async () => {
        //   A typo in a deployment variable must not silently disable the
        //   platform's only identity check.
        const { fakeIdRejectionEnabled } = await import('@/lib/kyc-validators');

        for (const value of ['0', 'no', 'FALSE', 'off', '', 'true']) {
            process.env.KYC_REJECT_FAKE_IDS = value;
            expect({ value, on: fakeIdRejectionEnabled() }).toEqual({ value, on: true });
        }
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

        //   #485 — the two patterns below named the OLD gate, so they held the
        //   old wording as well as the old behaviour. What the header owes a
        //   reader is the direction the gate fails and why, which is what this
        //   asserts.
        expect(raw).toMatch(/EVERY PART OF THIS FILE WAS INERT/);
        expect(raw).toMatch(/AND THE GATE IS NOW ON/);
        expect(raw).toMatch(/an only check must not be opt-in/);
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
        for (const file of [SERVER, FORM]) {
            const code = source(file);
            const importLine = code.split('\n').find((l) => l.includes('kyc-validators'))!;
            const names = [...importLine.matchAll(/\b(isObviouslyFakeId|fakeIdErrorMessage|looksLikeFakeId)\b/g)]
                .map((m) => m[1]);

            expect(names.length).toBeGreaterThan(0);          // vacuity guard
            for (const name of names) {
                const uses = code.split('\n')
                    .filter((l) => !l.includes('kyc-validators'))
                    .filter((l) => l.includes(`${name}(`));
                expect(uses.length).toBeGreaterThan(0);
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
