/**
 * @jest-environment node
 */

/**
 * Two more off the unnamed list, and the first is the same shape as
 * lib/claim-outcome: a suite that asserts the WIRING and never calls the rule.
 *
 * ── lib/land-inspection ─────────────────────────────────────────────────────
 *
 *   `inspectionRefusal` decides whether a land approval may proceed — the rule
 *   behind the owner's flow: "admin sends an inspector with all the details
 *   submitted from the listing and all the documents, then after inspector
 *   verifies then admin can approve."
 *
 *   an-inspection-nobody-had-to-do.test.ts enumerates the six approval doors
 *   from disk and checks each one MENTIONS `inspectionRefusal(`. That is the
 *   right check and it is not this one: it never imports the module, so what the
 *   function actually answers was untested. Six doors calling a rule nobody had
 *   exercised.
 *
 *   The distinction matters here more than most, because the rule is
 *   deliberately asymmetric. It refuses only where the listing is UNDER REVIEW;
 *   a listing already on sale may be re-approved without a new inspection,
 *   because that is how the three purchasable spellings converge on `verified`.
 *   Get that backwards and either every re-approval stalls or every review
 *   passes.
 *
 * ── lib/form-validation ─────────────────────────────────────────────────────
 *
 *   The single binding point between an HTML field name and a Zod schema field
 *   name, which have no compile-time relationship at all. Three cooperative
 *   money paths run their FormData through it — a membership registration twice
 *   and a loan application — so what it does with a repeated key, an empty
 *   string or a nested path decides whether somebody's application validates.
 */

import { describe, it, expect } from '@jest/globals';
import { z } from 'zod';
import {
    inspectionReportOf, hasPassedInspection, inspectionRefusal,
} from '@/lib/land-inspection';
import { APPROVABLE_FROM_STATUSES } from '@/lib/land-listing-status';
import {
    formDataToObject, parseFormData, parseFormDataOrThrow,
    formatZodErrors, getFirstErrorMessage, isFormSuccess,
} from '@/lib/form-validation';

const passed = (extra: Record<string, unknown> = {}) => ({
    outcome: 'passed' as const, inspectorName: 'Musa Danjuma', ...extra,
});

// ─────────────────────────────────────────────────────────────────────────────
describe('whether a land approval may proceed', () => {
    it('A LISTING UNDER REVIEW WITH NO REPORT IS REFUSED', () => {
        //   THE rule. Six doors write an approval and every one of them asks
        //   this; until now none of them had asked it of a test.
        for (const status of ['draft', 'pending_verification', 'inspection_scheduled', 'rejected']) {
            const refusal = inspectionRefusal({ status });
            expect({ status, refused: refusal !== null }).toEqual({ status, refused: true });
            expect(refusal).toMatch(/has not been inspected/i);
        }
    });

    it('AND ONE WITH A PASSED REPORT PROCEEDS', () => {
        expect(inspectionRefusal({ status: 'inspection_scheduled', inspectionReport: passed() }))
            .toBeNull();
    });

    it('AND A FAILED REPORT IS REFUSED, quoting what the inspector said', () => {
        //   The whole reason a failed inspection is worth recording: the admin
        //   is told what was found rather than just being blocked.
        const refusal = inspectionRefusal({
            status: 'inspection_scheduled',
            inspectionReport: { outcome: 'failed', findings: 'No access road; boundary disputed' },
        });

        expect(refusal).toContain('did not pass');
        expect(refusal).toContain('No access road; boundary disputed');
    });

    it('AND A FAILED REPORT WITH NO FINDINGS STILL READS AS A SENTENCE', () => {
        const refusal = inspectionRefusal({
            status: 'inspection_scheduled',
            inspectionReport: { outcome: 'failed', findings: '   ' },
        });

        expect(refusal).toContain('did not pass this listing.');
        expect(refusal).not.toContain(':  ');
    });

    it('A LISTING ALREADY ON SALE IS NOT REFUSED — it is a re-approval', () => {
        /*
         *   The asymmetry, and it is deliberate. APPROVABLE_FROM_STATUSES
         *   includes the three purchasable spellings because that is how
         *   `available` and `approved` converge on the canonical `verified`.
         *   Demanding an inspection here would stall listings that never needed
         *   a new one.
         */
        for (const status of ['verified', 'available', 'approved']) {
            expect({ status, refusal: inspectionRefusal({ status }) })
                .toEqual({ status, refusal: null });
        }
    });

    it('AND A REPORT IS ONLY A REPORT IF IT SAYS WHICH WAY IT WENT', () => {
        //   A half-written row must not read as a pass. Anything that is not
        //   one of the two outcomes is no report at all, and the listing is
        //   refused as uninspected.
        for (const report of [null, undefined, 'passed', {}, { outcome: 'maybe' }, { outcome: true }]) {
            expect({ report, found: inspectionReportOf({ inspectionReport: report }) })
                .toEqual({ report, found: null });
            expect({ report, passed: hasPassedInspection({ inspectionReport: report }) })
                .toEqual({ report, passed: false });
        }
    });

    it('AND hasPassedInspection IS TRUE ONLY FOR A PASS', () => {
        expect(hasPassedInspection({ inspectionReport: passed() })).toBe(true);
        expect(hasPassedInspection({ inspectionReport: { outcome: 'failed' } })).toBe(false);
        expect(hasPassedInspection(null)).toBe(false);
    });

    it('AND A LISTING WITH NO STATUS FALLS THROUGH — which the DOORS catch', () => {
        /*
         *   THIS RULE FAILS OPEN, and writing down why that is safe is the
         *   point of the assertion. `UNDER_REVIEW` is a list of review states,
         *   so anything unrecognised — a blank status, a spelling nobody
         *   declared — is treated as "not under review" and proceeds.
         *
         *   On its own that would be a bypass: a row whose status could not be
         *   read would be approvable with no inspection. It is not, because
         *   every one of the six doors ALSO checks APPROVABLE_FROM_STATUSES,
         *   which is an allowlist and refuses exactly those values. Both gates
         *   must pass, and the order they are called in does not matter.
         *
         *   Asserted as it behaves rather than as one might wish, so that if
         *   somebody ever removes the status check from a door this reads as the
         *   warning it is rather than as a guarantee it never made.
         */
        expect(inspectionRefusal({})).toBeNull();
        expect(inspectionRefusal({ status: '' })).toBeNull();
        expect(inspectionRefusal({ status: 'not_a_real_status' })).toBeNull();

        //   And the allowlist that makes that safe does refuse them.
        for (const status of ['', 'not_a_real_status']) {
            expect({ status, approvable: APPROVABLE_FROM_STATUSES.includes(status) })
                .toEqual({ status, approvable: false });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('binding a form field to a schema field', () => {
    const fd = (pairs: Array<[string, string]>) => {
        const f = new FormData();
        for (const [k, v] of pairs) f.append(k, v);
        return f;
    };

    it('A REPEATED KEY BECOMES AN ARRAY, and a third appends to it', () => {
        //   Checkbox groups and multi-selects post the same name repeatedly.
        //   Keeping only the last would silently drop every choice but one.
        expect(formDataToObject(fd([['crop', 'yam'], ['crop', 'sesame'], ['crop', 'hibiscus']])))
            .toEqual({ crop: ['yam', 'sesame', 'hibiscus'] });
    });

    it('AND AN EMPTY STRING IS PRESERVED, not dropped', () => {
        //   So a schema can decide whether blank is allowed. Dropping it here
        //   would turn "the member left it blank" into "the field was absent",
        //   and `.optional()` would then accept what `.min(1)` should refuse.
        expect(formDataToObject(fd([['lga', '']]))).toEqual({ lga: '' });
    });

    it('A VALID FORM PARSES TO TYPED DATA', () => {
        const schema = z.object({ firstName: z.string().min(1), age: z.coerce.number() });

        const result = parseFormData(schema, fd([['firstName', 'Ada'], ['age', '31']]));

        expect(result).toEqual({
            success: true, data: { firstName: 'Ada', age: 31 }, error: null, fieldErrors: null,
        });
        expect(isFormSuccess(result)).toBe(true);
    });

    it('AND AN INVALID ONE NAMES THE FIELD, so the drift is visible', () => {
        /*
         *   The whole point of the module: an HTML `name` and a schema key have
         *   no compile-time relationship, so when one is renamed the other
         *   produces `undefined` — and a bare `.get()` + `safeParse()` reports
         *   that as an unrelated type error with no field name in it.
         */
        const schema = z.object({ stateOfOrigin: z.string().min(1) });

        const result = parseFormData(schema, fd([['state', 'Kogi']]));

        expect(result.success).toBe(false);
        expect(result.fieldErrors).toHaveProperty('stateOfOrigin');
        expect(result.error).toContain('stateOfOrigin');
    });

    it('AND A NESTED PATH IS FLATTENED TO DOT NOTATION', () => {
        const schema = z.object({ nextOfKin: z.object({ name: z.string().min(1) }) });
        const parsed = schema.safeParse({ nextOfKin: { name: '' } });

        expect(parsed.success).toBe(false);
        expect(Object.keys(formatZodErrors(parsed.error!))).toEqual(['nextOfKin.name']);
    });

    it('AND AN ERROR WITH NO PATH IS NOT FILED UNDER AN EMPTY KEY', () => {
        //   A refinement on the whole object has no path. `""` as an object key
        //   is a field name no form has, so it becomes `_root`.
        const schema = z.object({ a: z.string() }).refine(() => false, { message: 'whole form' });
        const parsed = schema.safeParse({ a: 'x' });

        expect(Object.keys(formatZodErrors(parsed.error!))).toEqual(['_root']);
        expect(getFirstErrorMessage(parsed.error!)).toBe('whole form');
    });

    it('parseFormDataOrThrow CARRIES THE FIELD ERRORS ON THE EXCEPTION', () => {
        //   So a caller that bubbles to a try/catch does not lose which field
        //   was wrong, which is the thing the module exists to preserve.
        const schema = z.object({ bvn: z.string().length(11) });

        try {
            parseFormDataOrThrow(schema, fd([['bvn', '123']]));
            throw new Error('should have thrown');
        } catch (err: any) {
            expect(err.message).toContain('bvn');
            expect(err.fieldErrors).toHaveProperty('bvn');
        }
    });

    it('AND IT RETURNS THE DATA WHEN THE FORM IS GOOD (control)', () => {
        const schema = z.object({ bvn: z.string().length(11) });

        expect(parseFormDataOrThrow(schema, fd([['bvn', '12345678901']])))
            .toEqual({ bvn: '12345678901' });
    });
});
