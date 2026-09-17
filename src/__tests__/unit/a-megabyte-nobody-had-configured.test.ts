/**
 * @jest-environment node
 */

/**
 *   #866 THE PLATFORM PROMISED 5 MB IN THREE PLACES AND THE FRAMEWORK REFUSED
 *   AT ONE.
 *
 *   FROM A PRODUCTION LOG, twice in a single window:
 *
 *       ⨯ Error: Body exceeded 1 MB limit.
 *         To configure the body size limit for Server Actions, see: …
 *         statusCode: 413
 *
 *   A Server Action carries its arguments in the request body, so Next.js
 *   applies `serverActions.bodySizeLimit` to an uploaded file — DEFAULT 1 MB,
 *   and next.config.ts configures none.
 *
 *   `uploadDocumentAction` took the raw bytes. In front of it stood three
 *   statements of a 5 MB limit, every one of them unreachable:
 *
 *       components/shared/DocumentUpload      "Max file size: 5MB"
 *       components/onboarding/DocumentUpload  "…up to 5MB"
 *       the action's own MAX_SIZE_MB = 5      and the check that read it
 *
 *   All three agreed with each other and none of them ran, because the request
 *   was refused before it arrived. Every document between 1 MB and 5 MB — an
 *   ordinary phone photograph of a CAC certificate or an ID — failed with an
 *   error the uploader could do nothing about, on the marketplace seller
 *   onboarding and the loan wizard both.
 *
 *   This audit's most common shape, with a twist: the rule was not merely
 *   unenforced, it was OVERRULED by a framework default nobody had looked at.
 *
 * ── THE FIX IS THE PATH THAT ALWAYS WORKED ──────────────────────────────────
 *
 *   /api/upload is an HTTP route, so the action body limit does not apply; it
 *   accepts 50 MB; and hooks/use-storage with lib/upload-request already sends
 *   every other upload on this platform through it, carrying #297's retry
 *   rules. Farm Nation's listing form has used it all along, which is why
 *   #860's multiple-document upload was never affected.
 *
 *   NOT `bodySizeLimit`. Raising it would widen the accepted payload of EVERY
 *   server action on the platform in order to repair two callers — and would
 *   leave the same trap for the next feature that reaches for an action to move
 *   a file. The last test below pins that nobody goes back.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const code = (rel: string) =>
    stripComments(readFileSync(join(ROOT, rel), 'utf8'), { label: rel });

/** The two callers that were sending file bytes through a Server Action. */
const CALLERS = [
    'src/app/marketplace/onboarding/steps/BusinessVerificationStep.tsx',
    'src/components/loans/LoanWizard.tsx',
];

// ─────────────────────────────────────────────────────────────────────────────
describe('#866 — no file goes through a Server Action any more', () => {
    it('THE REPORTED 413: neither caller invokes the action', () => {
        const offenders = CALLERS.filter((f) => code(f).includes('uploadDocumentAction'));
        expect(offenders).toEqual([]);
    });

    it('AND BOTH POST TO THE ROUTE INSTEAD', () => {
        const missing = CALLERS.filter((f) => !code(f).includes('postUploadWithRetry('));
        expect(missing).toEqual([]);
    });

    it('AND THE ROUTE THEY USE ACCEPTS MORE THAN THE FORMS PROMISE', () => {
        /*
         *   The check that makes the repair real rather than a relocation. The
         *   controls in front of these callers advertise 5 MB; the route has to
         *   accept at least that or the defect has only moved.
         */
        const route = code('src/app/api/upload/route.ts');
        const at = route.indexOf('const maxSize');

        expect(at).toBeGreaterThan(-1);
        expect(route.slice(at, at + 120)).toContain('50 * 1024 * 1024');
    });

    it('AND THE FORMS STILL SAY WHAT THEY ENFORCE', () => {
        //   The other direction: the 5 MB the controls promise is now a rule
        //   they apply themselves, and it must not have been quietly dropped
        //   while the plumbing moved.
        for (const rel of [
            'src/components/shared/DocumentUpload.tsx',
            'src/components/onboarding/DocumentUpload.tsx',
        ]) {
            const src = code(rel);
            expect({ rel, caps: src.includes('maxSize = 5') }).toEqual({ rel, caps: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#866 — and the action itself is left alone', () => {
    const ACTION = 'src/app/actions/upload.ts';

    /*
     *   I FIRST GUTTED THIS FILE AND PUT A REFUSAL IN ITS PLACE, AND THAT WAS
     *   WRONG. Six suites failed: upload-path-traversal, storage-backend-single-
     *   rule, nothing-destroys-an-uploaded-asset, action-security-audit and
     *   action-auth-per-function all pin REAL behaviour in this action — how it
     *   sanitises a public_id, that it never deletes an existing asset, that it
     *   demands a session. Replacing it with a stub deleted those properties to
     *   repair a body limit that no longer reaches it, because nothing calls it.
     *
     *   So it is untouched, unreached, and declared in the orphaned-actions
     *   triage registry with the reason. The protection against a THIRD caller
     *   appearing is the ratchet below, not the shape of this file.
     */
    it('IT STILL UPLOADS, and its security properties are undisturbed', () => {
        const src = code(ACTION);

        expect(src).toContain('export async function uploadDocumentAction');
        expect(src).toContain('requireSession');
    });

    it('AND IT IS DECLARED AS UNREACHED, with the reason', () => {
        //   An action nothing calls is otherwise indistinguishable from one
        //   somebody forgot to wire up — which is exactly what #399's queue
        //   exists to stop happening silently.
        const triage = code('src/__tests__/unit/orphaned-actions-are-triaged.test.ts');

        expect(triage).toContain('uploadDocumentAction:');
        expect(triage).toMatch(/#866/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#866 — and nothing reaches for an action to move a file again', () => {
    it('NO CLIENT APPENDS A FILE TO A FormData IT HANDS TO A SERVER ACTION', () => {
        /*
         *   THE RATCHET. The two callers above are repaired; this is what stops
         *   a third appearing, because the failure is invisible until a file
         *   happens to exceed a megabyte — which is to say, invisible in
         *   development and on every small test file.
         *
         *   Matched on the shape that caused it: a FormData carrying `file`,
         *   passed to something named like an action, in a client component.
         */
        const { readdirSync, statSync } = require('fs') as typeof import('fs');

        const walk = (dir: string, out: string[] = []): string[] => {
            for (const entry of readdirSync(dir)) {
                const full = join(dir, entry);
                if (statSync(full).isDirectory()) {
                    if (!full.includes('__tests__')) walk(full, out);
                } else if (/\.tsx?$/.test(full) && !full.includes('.test.')) {
                    out.push(full);
                }
            }
            return out;
        };

        const offenders: string[] = [];
        for (const full of walk(join(ROOT, 'src'))) {
            const rel = full.slice(ROOT.length + 1);
            const src = stripComments(readFileSync(full, 'utf8'), { label: rel });

            if (!/formData\.append\(\s*["']file["']/.test(src)) continue;
            //   An action call on a FormData: `await somethingAction(formData)`.
            if (/\b\w*Action\(\s*formData\s*\)/.test(src)) offenders.push(rel);
        }

        expect(offenders).toEqual([]);
    });

    it('AND THE SWEEP IS NOT VACUOUS — it still finds the FormData uploads', () => {
        /*
         *   A positive control. "No offenders" is also what a broken matcher
         *   returns, and this rule is only worth having if it can see the files
         *   it is meant to police.
         */
        const withFileFormData = CALLERS.filter((f) =>
            /formData\.append\(\s*["']file["']/.test(code(f)));

        expect(withFileFormData).toEqual(CALLERS);
    });
});
