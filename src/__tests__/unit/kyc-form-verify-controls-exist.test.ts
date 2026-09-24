/**
 * @jest-environment node
 */

/**
 *   #349 THE KYC FORM'S VERIFICATION WAS BUILT IN THREE HALVES AND NONE OF
 *        THEM WAS RENDERED — SO THE ONLY WAY PAST THE GATE WAS #285's DEFECT,
 *        STILL LIVE FOUR LINES ABOVE #285's OWN FIX.
 *
 *        FOUR THINGS, AND THEY ONLY MAKE SENSE TOGETHER.
 *
 *        (1) THE DEFECT #285 REMOVED WAS STILL IN THE FILE.
 *
 *              const [formData, setFormData] = useState(() => {
 *                  const initial = { ...initialData };
 *                  if (initial.nin) initial.ninVerified = true;
 *                  if (initial.bvn) initial.bvnVerified = true;
 *                  return initial;
 *              });
 *
 *            The presence of a NUMBER asserted as a verification — precisely
 *            what #285 took out of handleChange. The badge states immediately
 *            below were corrected by #285 and read the FLAGS, so the screen
 *            said "not verified" while the DATA said verified. It is the data
 *            that onDataChange propagates and that KYCVerificationStep gates
 *            Continue on.
 *
 *            #285's ratchet could not see it: it filters on the last verify
 *            handler appearing before the other assignments, and a useState
 *            initialiser sits above every handler in the file.
 *
 *        (2) THE VERIFY BUTTON DID NOT EXIST. handleVerifyNIN,
 *            handleVerifyBVN, handleVerifyVotersCard and the VerifyBadge
 *            component were all unreachable. IdInput takes a `suffix` for
 *            exactly this — its own doc comment says "a Verify button or
 *            status badge" — and not one of the three call sites passed one.
 *            There was no <button> anywhere in the file.
 *
 *        (3) NOR DID THE CONFIRMATION CHECKBOX. handleVerifyNIN refuses while
 *            `ninConfirmed` is false, and #285's write-up calls that "a real
 *            gate" — but setNinConfirmed and setBvnConfirmed were never called
 *            from anywhere. Wiring only the button would have produced a
 *            control that refused every time.
 *
 *        SO THE FLOW ONLY WORKED THROUGH THE DEFECT. Removing (1) without
 *        building (2) and (3) would have bricked export onboarding: the step
 *        refuses to continue while a NIN is entered and unverified, and there
 *        would have been no way to verify one. That is why this is one finding
 *        and not three.
 *
 *        (4) AND THE STEP'S OWN onChange WAS DECLARED AND NEVER DESTRUCTURED,
 *            so KYC was the one export step whose data never reached the
 *            localStorage draft — the screen with both document uploads and
 *            the identity numbers, and the one a member is most likely to be
 *            interrupted on. `votersCard` was dropped a second time by the Zod
 *            schema, which lists nin/bvn/cacNumber and strips unknown keys.
 *
 *        OUT OF SCOPE, BY OWNER INSTRUCTION: verifyNINAction and
 *        verifyBVNAction currently return isMatch for any eleven digits — the
 *        QoreID integration the owner has asked to keep out for now. Wiring
 *        these controls does not change that and does not pretend to. It means
 *        the control EXISTS, so that restoring QoreID makes this flow real
 *        rather than leaving a button still to be built.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';

const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

const FORM = 'src/components/onboarding/KYCForm.tsx';
const STEP = 'src/app/export/onboarding/steps/KYCVerificationStep.tsx';
const SCHEMA = 'src/lib/types/export-actions.ts';
const ID_INPUT = 'src/components/ui/IdInput.tsx';

// ─────────────────────────────────────────────────────────────────────────────
describe('#349 — a saved NUMBER is no longer a saved verification', () => {
    const code = source(FORM);

    it('THE INITIALISER NO LONGER ASSERTS ninVerified FROM A NIN', () => {
        // THE test. This is #285's defect, in the one place #285 did not look.
        expect(code).not.toMatch(/initial\.ninVerified\s*=\s*true/);
        expect(code).not.toMatch(/initial\.bvnVerified\s*=\s*true/);
        expect(code).toContain('useState<Partial<KYCData>>(() => ({ ...initialData }))');
    });

    it('and the badges still read the FLAGS, as #285 left them', () => {
        // Vacuity guard: #285's half must survive this one.
        expect(code).toContain("initialData?.ninVerified ? 'verified' : 'idle'");
        expect(code).toContain("initialData?.bvnVerified ? 'verified' : 'idle'");
    });

    it('nothing else in the file infers a verification from a number', () => {
        // The ratchet #285's could not be, because it keyed on handler order.
        const offenders = code.split('\n').filter((l) =>
            /(nin|bvn|votersCard)Verified\s*=\s*(true|!!|Boolean\()/i.test(l)
            && !/= false/.test(l));

        // Only the three handlers may set these, and each does it inside its
        // own `isMatch` branch on an object literal, not by assignment.
        expect(offenders).toEqual([]);
    });

    it('and only the verify handlers set them true at all', () => {
        //   Three of these when the voter's card was on the form; two since
        //   lib/export-identity took it off. The ratchet above is what stops a
        //   new one appearing without this branch.
        for (const [handler, field] of [
            ['handleVerifyBVN', 'bvnVerified'],
            ['handleVerifyNIN', 'ninVerified'],
        ] as const) {
            const body = code.slice(code.indexOf(`async function ${handler}`));
            expect(body.slice(0, 1600)).toContain(`${field}: true`);
            expect(body.slice(0, 1600)).toContain('data?.isMatch');
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#349 — the verify controls are actually on the screen', () => {
    const code = source(FORM);

    it('EVERY VERIFY HANDLER IS REACHED FROM A CONTROL', () => {
        // THE second test. All three were unreachable. (The third, the
        // voter's card, has since been removed from this form altogether —
        // see lib/export-identity. Stated as "every handler in the file" so
        // the property survives a field leaving OR arriving.)
        const handlers = [...code.matchAll(/async function (handleVerify\w+)/g)].map((m) => m[1]);

        expect(handlers.length).toBeGreaterThan(0);
        for (const handler of handlers) {
            expect(code).toMatch(new RegExp(`onClick=\\{${handler}\\}`));
        }
        expect(handlers).toEqual(['handleVerifyBVN', 'handleVerifyNIN']);
    });

    it('through IdInput’s `suffix`, which exists for exactly this', () => {
        //   One per identity field on the form — three when the voter's card
        //   was here, two now.
        expect(code.match(/suffix=\{/g) ?? []).toHaveLength(2);
        expect(source(ID_INPUT)).toContain('suffix');
    });

    it('and the badge that was written for it finally renders', () => {
        expect(code).toMatch(/<VerifyBadge state=\{ninState\} \/>/);
        expect(code).toMatch(/<VerifyBadge state=\{bvnState\} \/>/);
    });

    it('THE CONFIRMATION CHECKBOXES EXIST, or the button refuses every time', () => {
        // handleVerifyNIN returns early on `!ninConfirmed`, and nothing set it.
        expect(code).toContain('onChange={(e) => setNinConfirmed(e.target.checked)}');
        expect(code).toContain('onChange={(e) => setBvnConfirmed(e.target.checked)}');
    });

    it('and the guards they satisfy are still there', () => {
        // Vacuity guard on the pair above.
        expect(code).toContain('if (!ninConfirmed) {');
        expect(code).toContain('if (!bvnConfirmed) {');
    });

    it('and every error state has somewhere to render', () => {
        //   setVotersCardError was written by its handler and shown by
        //   nothing, which is what this test caught. The field is gone (see
        //   lib/export-identity); the property is stated for whatever error
        //   states the file declares, so a new one cannot be written into the
        //   void the way that one was.
        const errors = [...code.matchAll(/const \[(\w+Error), set\w+Error\]/g)].map((m) => m[1]);

        expect(errors).toEqual(['bvnError', 'ninError']);
        for (const name of errors) {
            expect(code).toContain(`error={${name}}`);
        }
    });

    it('RECORDED, NOT FIXED: the verify actions are the QoreID stub', () => {
        // Held open by the owner ("keep this QoreID out for now"). Stated here
        // so nobody reads the wired button as proof of a real check.
        const kyc = source('src/app/actions/kyc.ts');

        expect(kyc).toMatch(/isMatch:\s*true/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#349 — the export step saves its draft like every other step', () => {
    const code = source(STEP);

    it('IT DESTRUCTURES AND CALLS onChange', () => {
        expect(code).toMatch(/onChange,\s*\n\}: KYCVerificationStepProps/);
        expect(code).toContain('onChange?.({ kyc: { kycData: next } })');
    });

    it('and the wizard really does pass it, so this was a dropped call', () => {
        const page = source('src/app/export/onboarding/ExportOnboardingClient.tsx');
        const stepJsx = page.slice(page.indexOf('<KYCVerificationStep'));

        expect(stepJsx.slice(0, 300)).toContain('onChange={handleStepChange}');
        expect(page).toContain('localStorage.setItem(`export_draft_');
    });

    it('the gate it protects is still exactly as strict', () => {
        //   Vacuity guard: the point of removing the initialiser defect is
        //   that THIS check can now fire. The inline
        //   `kycData.nin && !kycData.ninVerified` pair has since moved into
        //   lib/export-identity, which the step, the submit guard and the
        //   server schema share — and which requires the numbers to be THERE,
        //   not merely verified if somebody typed one. Stricter, not looser.
        expect(code).toContain('missingExportIdentity(kycData)');
        expect(code).toMatch(/missingIdentity\.length > 0[\s\S]{0,120}return;/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#349 — the schema carries what the form collects', () => {
    it('AND THE VOTER’S CARD IS NO LONGER EITHER', () => {
        //   THE ORIGINAL FINDING: Zod drops unknown keys, the form collected a
        //   Voter's Card, and nin/bvn/cacNumber were the only keys listed — so
        //   the number and its verification were dropped between the step and
        //   the record. It was fixed by DECLARING them.
        //
        //   The form no longer asks (lib/export-identity), so the right answer
        //   flipped: a key declared for a field nobody fills is dead weight
        //   that reads as a collected value. What the finding really says is
        //   that the schema and the form must agree, and this is that
        //   statement in the direction it now points.
        const schema = source(SCHEMA);
        const kycBlock = schema.slice(schema.indexOf('kycData: z.object({'));
        const form = source(FORM);

        expect(kycBlock).not.toContain('votersCard:');
        expect(kycBlock).not.toContain('votersCardVerified:');
        expect(form).not.toContain("Voter's Card Number");
    });

    it('and the verification flags the step gates on survive it too', () => {
        const schema = source(SCHEMA);
        const kycBlock = schema.slice(schema.indexOf('kycData: z.object({'));

        expect(kycBlock.slice(0, 700)).toContain('ninVerified:');
        expect(kycBlock.slice(0, 700)).toContain('bvnVerified:');
    });

    it('and the keys the form DOES fill are all still declared', () => {
        //   The vacuity guard on the assertion above: "not there" passes on an
        //   empty schema too. These are the fields #773 rescued from the same
        //   strip, and they must survive a removal aimed at a different one.
        const schema = source(SCHEMA);
        const kycBlock = schema.slice(schema.indexOf('kycData: z.object({'));

        for (const key of ['nin:', 'bvn:', 'ninVerified:', 'bvnVerified:', 'dateOfBirth:', 'idType:', 'idNumber:']) {
            expect(kycBlock).toContain(key);
        }
    });
});
