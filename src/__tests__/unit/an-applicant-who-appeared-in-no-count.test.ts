/**
 * @jest-environment node
 */

/**
 *   THE EXPORT APPLICANT WHO WAS IN NEITHER FIGURE.
 *
 *   THE OWNER, on the module breakdown migration 049 now produces — Export Hub
 *   **5**, Export Onboarding **1**, against 20,435 WAVE and 1,791 Marketplace:
 *   "check the export registration statuses".
 *
 *   Two collections, and the vocabulary does not cross between them cleanly:
 *
 *       export_onboarding_applications   the detailed form. _ex_onboarding
 *                                        CREATES it with `status:
 *                                        "pending_review"`.
 *       serviceRegistrations.export      the REGISTER (#835's word), which is
 *                                        what every count reads.
 *
 *   `pending_review` is not in ACTIVE_REGISTRATION_STATUSES and never was — it
 *   belongs to the application, not the registration. THREE paths copy one to
 *   the other and only two translated:
 *
 *       _ex_onboarding:351   -> "pending_approval"
 *       data-recovery:279    -> "pending"           (a second spelling)
 *       _ex_onboarding:372   -> verbatim            (none at all)
 *
 *   The third is the legacy sync. It wrote `pending_review` onto the register,
 *   where it matches neither ACTIVE_REGISTRATION_STATUSES — so the account is
 *   not an Export Hub registration — nor the onboarding slice
 *   `(pending, pending_approval, under_review, revision_required)` — so it is
 *   not in review either. The person had applied and appeared in no count.
 *
 *   ── WHAT THIS DOES NOT CLAIM ───────────────────────────────────────────────
 *
 *   That it explains the 5. That cannot be settled from the code: the register
 *   may genuinely hold five, or hundreds of rows this repairs. #835 already
 *   records that the register and the detailed collection disagree, which is
 *   why `registerIsUsable()` exists. The query in
 *   scripts/export-registration-statuses.sql measures it; this closes the leak.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    registerStatusForExportApplication,
    isCountedAsActiveRegistration,
} from '@/lib/export-registration-status';

const ONBOARDING = 'src/app/actions/export/_ex_onboarding.ts';
const RECOVERY = 'src/app/actions/data-recovery.ts';
const code = (rel: string) =>
    stripComments(readFileSync(join(process.cwd(), rel), 'utf-8'), { label: rel });

describe('#911 — an export applicant lands on the register in the register\'s vocabulary', () => {
    it('THE DEFECT: pending_review WAS NOT A COUNTED STATUS', () => {
        /*
         *   The whole finding in one assertion. If this ever reads true,
         *   ACTIVE_REGISTRATION_STATUSES has absorbed the application
         *   vocabulary and the translation below is redundant — which would be
         *   a fine outcome, and this says so rather than passing silently.
         */
        expect(isCountedAsActiveRegistration('pending_review')).toBe(false);
    });

    it('AND IT IS TRANSLATED TO ONE THAT IS', () => {
        const translated = registerStatusForExportApplication('pending_review');

        expect({ translated, counted: isCountedAsActiveRegistration(translated) })
            .toEqual({ translated: 'pending_approval', counted: true });
    });

    it('AND EVERY OTHER STATUS IS PRESERVED — the control', () => {
        /*
         *   A translator that returned "pending_approval" for everything would
         *   pass the assertion above and report every rejected applicant as
         *   in review. `rejected` is a real outcome that belongs on the
         *   register and is deliberately NOT an active registration.
         */
        expect({
            approved: registerStatusForExportApplication('approved'),
            rejected: registerStatusForExportApplication('rejected'),
            revision: registerStatusForExportApplication('revision_required'),
            unknown: registerStatusForExportApplication('some_future_status'),
        }).toEqual({
            approved: 'approved',
            rejected: 'rejected',
            revision: 'revision_required',
            unknown: 'some_future_status',
        });

        //   And `rejected` stays uncounted, which is correct.
        expect(isCountedAsActiveRegistration('rejected')).toBe(false);
    });

    it('AND AN APPLICATION WITH NO STATUS STILL COUNTS AS APPLIED', () => {
        //   The caller has an application row in hand, so the person applied.
        //   Reading that as "no registration" is how they vanish.
        for (const empty of [undefined, null, '', '   ']) {
            const v = registerStatusForExportApplication(empty);
            expect({ input: String(empty), counted: isCountedAsActiveRegistration(v) })
                .toEqual({ input: String(empty), counted: true });
        }
    });

    it('AND ALL THREE PATHS ASK THE SAME RULE', () => {
        /*
         *   THE point. Two of them already translated, to two different values;
         *   the third translated not at all. A grep is the right assertion —
         *   what matters is that no file states the rule for itself.
         */
        for (const rel of [ONBOARDING, RECOVERY]) {
            const src = code(rel);
            expect({ file: rel, asks: src.includes('registerStatusForExportApplication') })
                .toEqual({ file: rel, asks: true });
            //   And the hand-written ternaries are gone from both.
            expect(src).not.toMatch(/=== *["']pending_review["'] *\? *["']pending/);
        }
    });

    it('AND THE APPLICATION IS STILL CREATED AS pending_review — the premise', () => {
        /*
         *   THE vacuity guard. Everything above is about translating a value
         *   that must actually be written. If the creator stopped writing it,
         *   this suite would be guarding nothing and should say so.
         */
        const src = code(ONBOARDING);

        expect(src).toContain('status: "pending_review"');
    });
});
