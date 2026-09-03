/**
 * @jest-environment node
 */

/**
 *   #360 SECURITY: THE REDACTION THAT RUNS ON EVERY SERVER ACTION'S ARGUMENTS
 *        MISSED TWO OF ITS OWN SEVEN FIELDS AND ALL OF THE PII.
 *
 *        withSafeAction wraps 81 action files. When one throws,
 *        captureObservabilityTrace JSON-stringifies the ARGUMENTS of the failing
 *        call and writes them to `error_observability_traces`. So those
 *        arguments include whatever the call was carrying — a BVN, a NIN, a
 *        bank account number, an MFA token. This was the only thing between
 *        them and a stored database row:
 *
 *            const sensitiveFields = ['password', 'confirmPassword', 'pin',
 *                                     'cvv', 'token', 'secret', 'authCode'];
 *            if (sensitiveFields.includes(key.toLowerCase())) ...
 *
 *        (a) TWO OF THE SEVEN COULD NEVER MATCH. The list holds
 *            `confirmPassword` and `authCode` in camelCase; the test
 *            lower-cases the key before comparing. `'confirmpassword'` is not
 *            `'confirmPassword'`, so neither ever matched. Both were written
 *            out in full, every time. A list that names a field and does not
 *            redact it is worse than a short list, because it reads as covered.
 *
 *        (b) IT NAMED NO PII AT ALL. lib/admin-pii.ts has defined the platform
 *            PII set since #151 and the credential set since #341 — fourteen
 *            keys including bvn, nin, accountNumber, bankDetails, nextOfKin,
 *            documents, totpSecret, mfaRecoveryCodes, passwordHash. Not one
 *            appeared in this list. verifyBVNAction, verifyNINAction and
 *            saveKYCProfileAction are all wrapped in withSafeAction, so a throw
 *            inside any of them stored the raw identity number.
 *
 *        (c) AND NOTHING READS THE COLLECTION. `error_observability_traces`
 *            appears exactly once in this repository: the write, at
 *            lib/logger-server.ts:20. No screen, no script, no migration, and
 *            no erasure path names it. It was accumulating identity documents
 *            nobody would ever read, that a right-to-erasure request would not
 *            reach.
 *
 *        That is #305's shape — a hand-written PII list beside a shared
 *        definition that already had the answer — with the twist that this copy
 *        was WRITING rather than reading, so the exposure was durable.
 *
 *        FIXED by delegating to redactPii in lib/admin-pii.ts: one definition,
 *        case-blind, and redacting rather than deleting so a trace still shows
 *        which arguments were passed.
 *
 *        OWNER DECISION: `error_observability_traces` has no reader. Build a
 *        screen for it, give it a retention sweep, or stop writing it.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { stripComments } from '@/lib/testing/strip-comments';
import { redactPii, PII_KEYS, SECRET_KEYS, TRACE_ONLY_SECRET_KEYS } from '@/lib/admin-pii';

const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

const SAFE = 'src/lib/safe-action.ts';
const PIILIB = 'src/lib/admin-pii.ts';

/** The old list, kept here so the finding can be measured rather than asserted. */
const OLD_LIST = ['password', 'confirmPassword', 'pin', 'cvv', 'token', 'secret', 'authCode'];
const oldRedactMatches = (key: string) => OLD_LIST.includes(key.toLowerCase());

// ─────────────────────────────────────────────────────────────────────────────
describe('#360 — the case bug, measured rather than described', () => {
    it('THE OLD TEST COULD NEVER MATCH confirmPassword OR authCode', () => {
        // THE finding. Two of its own seven entries were dead on arrival.
        expect(oldRedactMatches('confirmPassword')).toBe(false);
        expect(oldRedactMatches('authCode')).toBe(false);

        // While the five all-lowercase ones did work, which is why it looked fine.
        for (const key of ['password', 'pin', 'cvv', 'token', 'secret']) {
            expect(oldRedactMatches(key)).toBe(true);
        }
    });

    it('AND BOTH ARE REDACTED NOW', async () => {
        const out = redactPii({ confirmPassword: 'hunter2', authCode: '482913' });

        expect(out).toEqual({ confirmPassword: '[REDACTED]', authCode: '[REDACTED]' });
    });

    it('matching is case-blind in every direction', () => {
        expect(redactPii({ BVN: '22348915073' })).toEqual({ BVN: '[REDACTED]' });
        expect(redactPii({ Nin: 'x' })).toEqual({ Nin: '[REDACTED]' });
        expect(redactPii({ AccountNumber: '0123456789' })).toEqual({ AccountNumber: '[REDACTED]' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#360 — the identity fields a failing KYC call carries', () => {
    it('A BVN IS NOT WRITTEN TO THE TRACE', async () => {
        // verifyBVNAction is wrapped in withSafeAction. Before this, a throw
        // inside it stored the raw number.
        const out = redactPii({ bvn: '22348915073', firstName: 'Ada', lastName: 'Obi' });

        expect(out.bvn).toBe('[REDACTED]');
        expect(out.firstName).toBe('Ada');            // the useful part survives
    });

    it('NOR IS A NIN', () => {
        expect(redactPii({ nin: '70316482905' }).nin).toBe('[REDACTED]');
    });

    it('NOR A BANK ACCOUNT, AT ANY DEPTH', () => {
        // The arguments of a withdrawal or onboarding action are nested.
        const out: any = redactPii({
            step: 3,
            payload: { bankDetails: { accountNumber: '0123456789', bankName: 'GTB' } },
        });

        expect(out.step).toBe(3);
        expect(out.payload.bankDetails).toBe('[REDACTED]');
    });

    it('NOR A SECOND FACTOR', () => {
        const out: any = redactPii({ totpSecret: 'JBSWY3', mfaRecoveryCodes: ['a', 'b'] });

        expect(out.totpSecret).toBe('[REDACTED]');
        expect(out.mfaRecoveryCodes).toBe('[REDACTED]');
    });

    it('NOR AN OTP, AN API KEY OR A REFRESH TOKEN', () => {
        const out: any = redactPii({ otp: '123456', apiKey: 'sk_live_x', refreshToken: 'rt_x' });

        expect(Object.values(out)).toEqual(['[REDACTED]', '[REDACTED]', '[REDACTED]']);
    });

    it('AND THE OLD LIST CAUGHT NONE OF THEM — the cost, measured', () => {
        for (const key of ['bvn', 'nin', 'accountNumber', 'bankDetails', 'nextOfKin',
                           'documents', 'totpSecret', 'mfaRecoveryCodes', 'passwordHash',
                           'otp', 'apiKey', 'refreshToken']) {
            expect(oldRedactMatches(key)).toBe(false);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#360 — it redacts, and it does not destroy the trace', () => {
    it('THE KEY SURVIVES — a debugger needs to know the argument was passed', () => {
        // stripPii DELETES; a trace must not, or "was a BVN supplied?" becomes
        // unanswerable from the record of the failure.
        const out = redactPii({ bvn: '2234' });

        expect(Object.keys(out)).toEqual(['bvn']);
        expect(out.bvn).toBe('[REDACTED]');
    });

    it('non-sensitive arguments come through untouched', () => {
        const args: any = [{ orderId: 'o-1', quantity: 4, tierType: 'bulk' }];

        expect(redactPii(args)).toEqual(args);
    });

    it('arrays of arguments are walked element by element', () => {
        // captureObservabilityTrace passes the whole `args` array.
        const out: any = redactPii([{ bvn: 'x' }, { nin: 'y' }, 'plain']);

        expect(out).toEqual([{ bvn: '[REDACTED]' }, { nin: '[REDACTED]' }, 'plain']);
    });

    it('primitives, dates, null and undefined pass through', () => {
        const d = new Date(0);

        expect(redactPii(null)).toBeNull();
        expect(redactPii(undefined)).toBeUndefined();
        expect(redactPii(42)).toBe(42);
        expect(redactPii('bvn')).toBe('bvn');        // a VALUE named like a key is not a key
        expect(redactPii(d)).toBe(d);
    });

    it('and a deeply nested credential is still reached', () => {
        const out: any = redactPii({ a: { b: { c: { password: 'p', keep: 1 } } } });

        expect(out.a.b.c).toEqual({ password: '[REDACTED]', keep: 1 });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#360 — one definition, not two', () => {
    it('safe-action NO LONGER HAND-WRITES A LIST', () => {
        const code = source(SAFE);

        expect(code).not.toMatch(/const sensitiveFields = \[/);
        expect(code).toContain('return redactPii(data);');
        expect(code).toContain('from "@/lib/admin-pii"');
    });

    it('and the trace still runs the redaction over the arguments', () => {
        // Vacuity guard: unifying the list must not have unhooked it.
        expect(source(SAFE)).toContain('JSON.stringify(redactSensitiveData(args))');
    });

    it('THE SHARED SET COVERS EVERY FIELD THE OLD LIST NAMED', () => {
        // The union must be a superset, or unifying would have LOST coverage.
        for (const key of OLD_LIST) {
            expect(redactPii({ [key]: 'x' })[key]).toBe('[REDACTED]');
        }
    });

    it('the trace-only words are separate from SECRET_KEYS, on purpose', () => {
        // `token` and `secret` are generic enough to name something innocuous
        // in an admin payload. Widening SECRET_KEYS would change eight live
        // call sites for no gain; over-redacting a debugging artefact costs
        // nothing. Pinned so the two sets do not silently merge.
        expect(SECRET_KEYS).not.toContain('token');
        expect(TRACE_ONLY_SECRET_KEYS).toContain('token');
        expect(readFileSync(PIILIB, 'utf-8')).toMatch(/would change eight live\s*\n \* call sites/);
    });

    it('and stripPii/stripSecrets are unchanged, so the admin gates still behave', () => {
        // The eight admin call sites depend on these. Adding redactPii must not
        // have moved them.
        expect(PII_KEYS).toContain('bvn');
        expect(SECRET_KEYS).toEqual(['totpSecret', 'mfaRecoveryCodes', 'password', 'passwordHash']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#360 — the collection nobody reads', () => {
    it('error_observability_traces IS WRITTEN AND NEVER READ', () => {
        // The third half of the finding. If a reader ever appears, this fails
        // and the owner decision in the header is answered.
        //
        // Measured on COMMENT-STRIPPED source. The first version of this
        // assertion grepped raw files and found four hits — one write and three
        // mentions in the #360 write-up I had just added to safe-action.ts. The
        // same tombstone trap as #350, #354, #355 and #359, caught here by the
        // assertion itself.
        const files: string[] = execSync(
            "grep -rl 'error_observability_traces' --include='*.ts' --include='*.tsx' "
            + "--include='*.sql' src scripts supabase 2>/dev/null | grep -v __tests__ || true",
            { encoding: 'utf-8' },
        ).split('\n').filter(Boolean);

        const inCode = files.filter((f) => source(f).includes('error_observability_traces'));

        expect(inCode).toEqual(['src/lib/logger-server.ts']);

        // And that one reference is the WRITE, not a read.
        const writer = source('src/lib/logger-server.ts');
        expect(writer).toContain('db.collection("error_observability_traces").doc()');
        expect(writer).not.toMatch(/error_observability_traces"\)\s*\.\s*(get|where|orderBy)/);
    });

    it('and the write-up says so, with the decision it implies', () => {
        const raw = readFileSync(SAFE, 'utf-8');

        expect(raw).toMatch(/AND NOTHING READS THE COLLECTION/);
        expect(raw).toMatch(/OWNER DECISION: `error_observability_traces` has no reader/);
    });

    it('THE ACTIONS THAT CARRY IDENTITY REALLY ARE WRAPPED — the blast radius', () => {
        // The claim the severity rests on. If kyc.ts ever stops routing through
        // withSafeAction this is no longer the path, and the write-up changes.
        const kyc = source('src/app/actions/kyc.ts');

        expect(kyc).toContain('withSafeAction("verifyBVNAction"');
        expect(kyc).toContain('withSafeAction("verifyNINAction"');
        expect(kyc).toContain('withSafeAction("saveKYCProfileAction"');

        const wrapped: string = execSync(
            "grep -rln 'withSafeAction\\|withFlexibleSafeAction' --include='*.ts' src/app/actions || true",
            { encoding: 'utf-8' },
        );
        expect(wrapped.split('\n').filter(Boolean).length).toBeGreaterThanOrEqual(70);
    });
});
