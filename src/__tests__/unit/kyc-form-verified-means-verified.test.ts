/**
 * @jest-environment node
 */

/**
 *   #285 TYPING A BVN OR NIN MARKED IT VERIFIED, AND DISARMED THE GATE THAT
 *        CHECKED.
 *
 *        KYCForm's handleChange carries the comment "Reset verify state when
 *        the field changes". The voters-card branch does exactly that. The
 *        other two did the opposite:
 *
 *            if (field === 'bvn') {
 *                setBvnState(value ? 'verified' : 'idle');
 *                setBvnConfirmed(!!value);
 *                updated.bvnVerified = !!value;
 *            }
 *
 *        So entering eleven digits showed the green "Verified" badge, ticked
 *        the "I confirm my digits are correct" box on the member's behalf, and
 *        set `bvnVerified` on the data the step persists — with no call to
 *        verifyBVNAction at all.
 *
 *        ONE FUNCTION, THREE FIELDS, AND THE THIRD ONE WAS RIGHT. That is what
 *        makes this readable as a defect rather than a design: the voters card
 *        sitting three lines below resets to 'idle' and clears its flag, which
 *        is what the comment above all three says they all do.
 *
 *        AND IT DISARMED A REAL GATE.
 *        KYCVerificationStep refuses to continue while
 *
 *            kycData.bvn && kycData.bvn.trim() !== '' && !kycData.bvnVerified
 *
 *        That check was written correctly and could never fire, because the
 *        form handed it a flag that was true by construction. #274's shape —
 *        a control that is present and inert — in the identity form. The
 *        confirmation checkbox went the same way: `if (!bvnConfirmed)` in
 *        handleVerifyBVN exists to make the member confirm the digits, and
 *        auto-ticking it meant that guard could not refuse either.
 *
 *        RESUMING WAS WRONG TOO. The initial state read
 *        `initialData?.bvn ? 'verified' : 'idle'` — the presence of a NUMBER —
 *        so reopening the form showed "Verified" over any saved value. The
 *        voters-card line beside it always read `initialData?.votersCardVerified`,
 *        the flag. Same inconsistency, same two fields.
 *
 * WHAT THIS IS NOT
 * ----------------
 * Not a lockout. The three verify handlers already set their flag only after
 * the action returns `isMatch`, and they call onDataChange with it — checked
 * before changing anything, because #265 was this audit creating exactly that
 * problem. Type, press Verify, get checked, continue. What changes is that the
 * middle step can no longer be skipped.
 *
 * Found in the same sweep as #284: the component layer sits at 0% coverage, and
 * a form that says "Verified" is worth reading closely after finding one that
 * said it without asking anybody.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

const FORM = 'src/components/onboarding/KYCForm.tsx';
const STEP = 'src/app/export/onboarding/steps/KYCVerificationStep.tsx';

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

/** handleChange's body — where the defect lived. */
function handleChangeBody(): string {
    const src = codeOnly(FORM);
    const start = src.indexOf('function handleChange');
    expect(start).toBeGreaterThan(-1);
    const rest = src.slice(start);
    const end = rest.indexOf('async function handleVerifyBVN');
    return rest.slice(0, end > 0 ? end : 2000);
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#285 — editing a field clears its verification', () => {
    const body = handleChangeBody();

    it('BVN AND NIN RESET TO idle, LIKE THE VOTERS CARD ALWAYS DID', () => {
        // Was: `setBvnState(value ? 'verified' : 'idle')`.
        expect(body).not.toMatch(/set(Bvn|Nin)State\(value \?/);
        expect(body).toMatch(/setBvnState\('idle'\)/);
        expect(body).toMatch(/setNinState\('idle'\)/);
        expect(body).toMatch(/setVotersCardState\('idle'\)/);
    });

    it('AND CLEAR THE VERIFIED FLAG RATHER THAN SETTING IT FROM THE VALUE', () => {
        // The half that reached the database: this flag is what the step
        // persists and what the admin detail modal reads back.
        expect(body).not.toMatch(/updated\.(bvn|nin)Verified = !!value/);
        expect(body).toMatch(/updated\.bvnVerified = false/);
        expect(body).toMatch(/updated\.ninVerified = false/);
        expect(body).toMatch(/updated\.votersCardVerified = false/);
    });

    it('and no longer tick the confirmation box for the member', () => {
        // `if (!bvnConfirmed)` in handleVerifyBVN is there to make the member
        // confirm their digits. Auto-ticking it meant it could never refuse.
        expect(body).not.toMatch(/set(Bvn|Nin)Confirmed\(!!value\)/);
        expect(body).toMatch(/setBvnConfirmed\(false\)/);
        expect(body).toMatch(/setNinConfirmed\(false\)/);
    });

    it('all three fields are handled the same way, which is the point', () => {
        // The finding was one function treating three identical cases two
        // different ways. Stated as a property so a fourth field added later
        // has to join the pattern.
        const resets = (body.match(/State\('idle'\)/g) ?? []).length;
        const cleared = (body.match(/Verified = false/g) ?? []).length;

        expect(resets).toBe(3);
        expect(cleared).toBe(3);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#285 — reopening the form shows what was actually verified', () => {
    it('THE INITIAL STATE READS THE FLAG, NOT THE PRESENCE OF A NUMBER', () => {
        // Was: `initialData?.bvn ? 'verified' : 'idle'`.
        const src = codeOnly(FORM);

        expect(src).toContain("initialData?.bvnVerified ? 'verified' : 'idle'");
        expect(src).toContain("initialData?.ninVerified ? 'verified' : 'idle'");
        expect(src).toContain("initialData?.votersCardVerified ? 'verified' : 'idle'");
        expect(src).not.toMatch(/initialData\?\.(bvn|nin) \? 'verified'/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#285 — only a real check may set the flag', () => {
    const src = codeOnly(FORM);

    for (const [handler, action, flag] of [
        ['handleVerifyBVN', 'verifyBVNAction', 'bvnVerified'],
        ['handleVerifyNIN', 'verifyNINAction', 'ninVerified'],
        ['handleVerifyVotersCard', 'verifyVotersCardAction', 'votersCardVerified'],
    ] as const) {
        it(`${handler} sets ${flag} only behind ${action} and isMatch`, () => {
            const start = src.indexOf(`function ${handler}`);
            expect(start).toBeGreaterThan(-1);
            const body = src.slice(start, start + 1800);

            expect(body).toContain(action);
            // The flag is set inside the isMatch branch, and the branch exists.
            expect(body).toMatch(/result\.success && result\.data\?\.isMatch/);
            expect(body).toMatch(new RegExp(`${flag}: true`));
        });
    }

    it('and nothing outside those handlers sets a verified flag to true', () => {
        // The ratchet. Any new path that decides "verified" without asking the
        // action reinstates the defect through a different door.
        const offenders = src.split('\n')
            .map((line, i) => ({ at: i + 1, line }))
            .filter(({ line }) => /(bvn|nin|votersCard)Verified\s*[:=]\s*true/i.test(line))
            .filter(({ at }) => {
                // Inside one of the three verify handlers?
                const upto = src.split('\n').slice(0, at).join('\n');
                const lastHandler = Math.max(
                    upto.lastIndexOf('function handleVerifyBVN'),
                    upto.lastIndexOf('function handleVerifyNIN'),
                    upto.lastIndexOf('function handleVerifyVotersCard'),
                );
                const lastOther = upto.lastIndexOf('function handleChange');
                return lastHandler < lastOther;
            })
            .map((o) => `${FORM}:${o.at}`);

        expect(offenders).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#285 — the gate the form was disarming', () => {
    it('KYCVerificationStep STILL REFUSES AN UNVERIFIED BVN OR NIN', () => {
        // Unchanged and pinned. The check was always right; what was wrong is
        // that it could never fire. If somebody removes it because "it never
        // triggers", this says why it did not.
        const src = codeOnly(STEP);

        expect(src).toMatch(/kycData\.nin[\s\S]{0,80}!kycData\.ninVerified/);
        expect(src).toMatch(/kycData\.bvn[\s\S]{0,80}!kycData\.bvnVerified/);
    });

    it('and it is still this form the step renders', () => {
        expect(codeOnly(STEP)).toContain('KYCForm');
    });
});
