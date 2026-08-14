/**
 * @jest-environment node
 */

/**
 * A star re-export and a local declaration of the same name, in one module.
 *
 * THE BUG
 * -------
 * src/lib/types/firestore.ts — the module 275 files import — opens with
 *
 *     export * from "./prd-interfaces";
 *
 * and then declares thirteen interfaces of its own. Two of those names were
 * also exported by prd-interfaces: CooperativeMember and LoanApplication.
 *
 * A local declaration shadows a star re-export. Silently: no error, no warning,
 * nothing in the build. So the prd-interfaces versions of both lost, and
 * neither had a direct importer either — they were unreachable from anywhere.
 *
 * That file is titled "PRD-Required Type Interfaces". Two of its eight
 * requirements could not be enforced by anything, and editing them would have
 * changed nothing at all.
 *
 * WHAT THE SHADOWED SHAPES CARRIED
 * --------------------------------
 * The winning declarations have more fields overall, but not these:
 *
 *   LoanApplication    approvedBy, completedAt, dueDate, interestAmount,
 *                      memberId, paid, paidAt, productId, repaymentSchedule
 *   CooperativeMember  approvedAt, approvedBy, fullName, paymentReference
 *
 * `repaymentSchedule` and `productId` on a loan are not incidental. Whether they
 * belong on the live shape is a product question — now a visible one.
 *
 * THE FIX WAS TO FINISH A MIGRATION, NOT TO START ONE
 * ---------------------------------------------------
 * prd-interfaces.ts is marked @deprecated and its own header already listed
 * both names as migrated to cooperative.ts. The migration moved them and did
 * not delete them. Deleting them changes nothing observable — which is exactly
 * the point, and why tsc and 2,216 tests were green before and after.
 *
 * THIS TEST
 * ---------
 * Recurrence is the risk. Adding an interface to firestore.ts whose name
 * already exists in prd-interfaces silently disables the prd one again, and
 * nothing in the toolchain objects. This does.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function exportedNames(src: string): string[] {
    return (src.match(/^export (?:interface|type|const|enum)\s+(\w+)/gm) || []).map(
        (m) => m.split(/\s+/).pop() as string
    );
}

const PRD = 'src/lib/types/prd-interfaces.ts';
const FIRESTORE = 'src/lib/types/firestore.ts';

describe('nothing re-exported by firestore.ts is shadowed by it', () => {
    it('the star re-export is still there', () => {
        // Vacuity guard: if the re-export goes away, every assertion below
        // passes for the wrong reason.
        expect(source(FIRESTORE)).toContain('export * from "./prd-interfaces"');
    });

    it('prd-interfaces still exports something worth re-exporting', () => {
        expect(exportedNames(source(PRD)).length).toBeGreaterThan(0);
    });

    it('no name is declared in both', () => {
        // THE test. CooperativeMember and LoanApplication were, and both prd
        // versions were unreachable as a result.
        const prd = new Set(exportedNames(source(PRD)));
        const local = exportedNames(source(FIRESTORE));

        const shadowed = local.filter((n) => prd.has(n));

        expect(shadowed).toEqual([]);
    });

    it('the two that were shadowed are gone from prd-interfaces', () => {
        const prd = exportedNames(source(PRD));

        expect(prd).not.toContain('CooperativeMember');
        expect(prd).not.toContain('LoanApplication');
    });

    it('and firestore.ts still declares them, because those are the live ones', () => {
        // The shapes that won are the shapes in use. Removing the losers must
        // not have removed the winners.
        const local = exportedNames(source(FIRESTORE));

        expect(local).toContain('CooperativeMember');
        expect(local).toContain('LoanApplication');
    });

    it('what the live shapes lack is written down', () => {
        // The only part of the shadowed declarations worth keeping is the list
        // of fields they had and the live ones do not.
        const prd = source(PRD);

        expect(prd).toContain('repaymentSchedule');
        expect(prd).toContain('paymentReference');
    });
});

describe('the rest of the re-export still works', () => {
    it('the six unshadowed names are reachable through firestore.ts', () => {
        // These are the ones the star re-export actually delivers.
        const prd = new Set(exportedNames(source(PRD)));

        for (const name of [
            'AcademyQuiz',
            'FixedSavingsPlan',
            'LandVerification',
            'LoanProduct',
            'QuizAttempt',
            'SellerVerification',
        ]) {
            expect(`${name}: ${prd.has(name)}`).toBe(`${name}: true`);
        }
    });
});
