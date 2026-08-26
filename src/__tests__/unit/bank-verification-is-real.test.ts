/**
 * @jest-environment node
 */

/**
 *   #284 THE MARKETPLACE SELLER'S BANK ACCOUNT WAS NEVER VERIFIED, AND THE
 *        ACCOUNT NAME RECORDED FOR THEM WAS THE STRING
 *        "SIMULATED ACCOUNT NAME".
 *
 *        components/shared/BankAccountVerification.tsx, the component
 *        /marketplace/onboarding's bank step renders, did this:
 *
 *            // SIMULATED VERIFICATION (Requested for demo/testing)
 *            await new Promise(resolve => setTimeout(resolve, 1000));
 *            const simulatedName = "SIMULATED ACCOUNT NAME";
 *            setVerificationStatus("success");
 *            onVerify?.(true, simulatedName);
 *            onVerified?.({ bankName, accountNumber, accountName: simulatedName });
 *
 *        Any ten digits and any bank passed. It even loaded the REAL bank list
 *        from Paystack first, so the screen looked entirely genuine, and then
 *        resolved the name locally without asking anybody.
 *
 *        WHERE THAT STRING GOES. BankAccountStep passes onVerified straight
 *        into the onboarding payload and gates its Continue button on
 *        `data?.accountName` — which the stub always supplied, so the step
 *        could never fail. The value lands on the seller verification record
 *        and from there on the payout queue an admin approves against. #92,
 *        #133 and #142 are all about that queue; this is what fills it.
 *
 *        THE REAL ENDPOINT ALREADY EXISTED.
 *        /api/kyc/verify-bank-account resolves through Paystack's bank/resolve,
 *        is session-guarded and rate-limited, and was hardened in #243/#244 —
 *        including failing CLOSED with a 503 when the Paystack key is absent,
 *        rather than waving the account through. Neither component called it.
 *
 *        AND BOTH COMPONENTS HAD THE STUB — WHICH I GOT WRONG FIRST TIME.
 *
 *        components/onboarding/BankAccountVerification.tsx, the one the EXPORT
 *        onboarding renders, verifies a BVN through /api/kyc/verify-bvn. I saw
 *        that, concluded it was the sound half of the pair, and wrote this file
 *        saying so. The ratchet at the bottom then found the identical
 *        simulation in it — the BVN check is real and the ACCOUNT NAME
 *        resolution beside it was not.
 *
 *        Its version is slightly worse: `accountName || "SIMULATED ACCOUNT
 *        NAME"` accepted whatever the applicant had TYPED as the resolved
 *        name, so an export member could name the account anything and have it
 *        recorded as verified.
 *
 *        So this is not "two implementations, one of them real" after all. It
 *        is one demo shortcut copied into both, and the only reason to look at
 *        the pair was that the duplicate NAME made them findable.
 *
 * HOW IT WAS FOUND
 * ----------------
 * By coverage. Sixty-one source files sit at 0% statement coverage and almost
 * all of them are components — the browser layer is the least audited surface
 * in this codebase. Two of those files had the same name in different folders,
 * which is the signal the duplicate-implementation sweeps have been keying on
 * all along.
 *
 * WHAT IS NOT FIXED HERE, AND IS THE OWNER'S
 * ------------------------------------------
 * Any seller already onboarded through this step has "SIMULATED ACCOUNT NAME"
 * stored as their account name and an unverified account number behind it. The
 * code is corrected from now on; the existing rows are data, and deciding
 * whether to re-verify them, freeze their payouts, or ask those sellers to
 * confirm their details is a business call. Pinned at the bottom of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readdirSync, statSync, readFileSync } from 'fs';
import { join } from 'path';

const SHARED = 'src/components/shared/BankAccountVerification.tsx';
const STEP = 'src/app/marketplace/onboarding/steps/BankAccountStep.tsx';
const ENDPOINT = 'src/app/api/kyc/verify-bank-account/route.ts';
const EXPORT_COMPONENT = 'src/components/onboarding/BankAccountVerification.tsx';

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(full)) out.push(full);
    }
    return out;
}

function raw(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function codeOnly(rel: string): string {
    return raw(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#284 — the marketplace bank step asks Paystack', () => {
    const src = codeOnly(SHARED);

    it('CALLS THE REAL VERIFICATION ENDPOINT', () => {
        expect(src).toContain('/api/kyc/verify-bank-account');
    });

    it('AND NO LONGER MANUFACTURES AN ACCOUNT NAME', () => {
        // The defect in one assertion. The string was not a placeholder in a
        // fixture — it was written into the seller's record.
        expect(src).not.toContain('SIMULATED ACCOUNT NAME');
        expect(src).not.toMatch(/simulatedName/);
    });

    it('sends the bank CODE, which is what the endpoint resolves on', () => {
        // The select stores bank NAMES, so the code has to be looked up from
        // the list. Getting this wrong would make every verification fail —
        // which is at least honest, but not the intent.
        expect(src).toMatch(/banks\.find\([\s\S]*?\)\?\.code/);
        expect(src).toMatch(/body:\s*JSON\.stringify\(\{\s*accountNumber,\s*bankCode\s*\}\)/);
    });

    it('REFUSES WHEN THE RESPONSE IS NOT A CONFIRMED RESOLUTION', () => {
        // Fail closed. The endpoint returns 503 when Paystack is not
        // configured (#243/#244), and a component that treated that as
        // success would reinstate the defect through a different door.
        expect(src).toMatch(/!response\.ok\s*\|\|\s*!data\?\.success\s*\|\|\s*!data\?\.accountName/);
    });

    it('and reports the failure to the person instead of silently continuing', () => {
        expect(src).toContain('setVerifyError');
        expect(codeOnly(SHARED)).toMatch(/verifyError \|\|/);
    });

    it('the endpoint it calls is the session-guarded one, not an open route', () => {
        // Vacuity guard on the other side: pointing the component at an
        // unauthenticated resolver would make this test pass and the system
        // worse.
        const ep = codeOnly(ENDPOINT);

        expect(ep).toContain('requireSession');
        expect(ep).toContain('withRateLimit');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#284 — the export onboarding component, the copy I first cleared', () => {
    const src = codeOnly(EXPORT_COMPONENT);

    it('CALLS THE REAL ENDPOINT TOO', () => {
        expect(src).toContain('/api/kyc/verify-bank-account');
    });

    it('AND NO LONGER ACCEPTS THE TYPED NAME AS THE RESOLVED ONE', () => {
        // `accountName || "SIMULATED ACCOUNT NAME"` — whatever the applicant
        // had entered became the verified account name.
        expect(src).not.toContain('SIMULATED ACCOUNT NAME');

        // Precise to the defect. The first version of this assertion was
        // `/accountName \|\| "/`, which also matched the useState initialiser
        // `initialData?.accountName || ""` — a legitimate line that has nothing
        // to do with verification. Broad patterns find their own false
        // positives, which is the same lesson #282's ratchet taught.
        expect(src).not.toMatch(/newAccountName\s*=\s*accountName/);
    });

    it('refuses a response that is not a confirmed resolution', () => {
        expect(src).toMatch(/!response\.ok\s*\|\|\s*!data\?\.success\s*\|\|\s*!data\?\.accountName/);
    });

    it('and its BVN check, which was always real, is still there', () => {
        // Vacuity guard: this component did verify something. Replacing the
        // account-name path must not have removed the part that worked.
        expect(src).toContain('/api/kyc/verify-bvn');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#284 — the step still cannot continue without a resolved name', () => {
    it('BankAccountStep gates Continue on accountName', () => {
        // Unchanged, and worth pinning: the gate was always right. What was
        // wrong is that the stub always satisfied it. Now only a real
        // resolution does.
        expect(codeOnly(STEP)).toMatch(/disabled=\{!data\?\.accountName/);
    });

    it('and it is still this component the step renders', () => {
        expect(codeOnly(STEP)).toContain('@/components/shared/BankAccountVerification');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#284 — nothing else in the app simulates a verification', () => {
    /**
     * Derived, because the defect was a demo shortcut left in production and
     * there is no reason to think it was the only one. A comment saying
     * "simulated" beside a success path is the signature.
     */
    const files = walk(join(process.cwd(), 'src'))
        .map((f) => f.slice(process.cwd().length + 1))
        .filter((f) => !f.includes('__tests__'));

    it('finds the app files, so this is not vacuous', () => {
        expect(files.length).toBeGreaterThan(200);
    });

    it('NO FILE FAKES A VERIFICATION OR RESOLUTION RESULT', () => {
        const offenders: string[] = [];

        for (const f of files) {
            raw(f).split('\n').forEach((line, i) => {
                if (!/simulat/i.test(line)) return;
                // This file's own write-up quotes the old code verbatim.
                if (f.endsWith('bank-verification-is-real.test.ts')) return;

                // lib/logistics.ts is a DECLARED placeholder: there is no
                // carrier integration, and it says so in its own header rather
                // than presenting invented tracking as a verification result.
                // A missing feature that admits it is not this defect — this
                // defect is a check that claims to have happened. Exempted
                // explicitly rather than by loosening the pattern, so if it
                // ever starts feeding a decision the exemption is visible.
                if (f === 'src/lib/logistics.ts') return;
                // The record of the defect, in the component that had it.
                if (/#284/.test(raw(f).slice(0, raw(f).indexOf(line)).slice(-1200))) return;
                offenders.push(`${f}:${i + 1}  ${line.trim().slice(0, 80)}`);
            });
        }

        // Was: shared/BankAccountVerification.tsx, "SIMULATED VERIFICATION
        // (Requested for demo/testing)".
        expect(offenders).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#284 — the rows already written, pinned as OPEN', () => {
    /**
     * Every seller onboarded through this step before the fix has
     * "SIMULATED ACCOUNT NAME" recorded as their account name, over an account
     * number nobody resolved. The code is corrected; the data is not, because
     * re-verifying, freezing payouts or asking those sellers to confirm are
     * business decisions rather than an audit's.
     *
     * There is no local database to measure the count against, so this pins the
     * QUESTION rather than a number. Delete it when the owner has decided.
     */
    it('is a decision for the owner, not something this fix reached', () => {
        // Deliberately trivial. It exists to carry the note above into the
        // suite so the follow-up is not lost with the chat it was reported in.
        expect(raw(SHARED)).toContain('#284');
    });
});
