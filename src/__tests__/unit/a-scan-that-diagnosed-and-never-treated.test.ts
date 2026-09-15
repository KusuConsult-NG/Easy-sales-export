/**
 * @jest-environment node
 */

/**
 *   #757 THE FORENSIC SCAN REPORTED TEN DEFECT CLASSES AND REPAIRED NONE,
 *        WHILE THE REPAIRS FOR THREE OF THEM ALREADY EXISTED IN THIS TREE.
 *
 *   Reported by the owner: "I want you to fix all the issues on forensic scan so
 *   that when admin scan all the defects should be healed."
 *
 *   `runForensicScanAction` is 1,500 lines of cross-module integrity checking
 *   and is entirely read-only. It finds ghost accounts, orphaned products and
 *   approval drift, lists the affected ids, and stops — while
 *
 *       lib/orphaned-user-repair.ts     repairOrphanedUser / repairAllOrphanedUsers
 *       actions/data-recovery.ts        runServiceRegistrationRecoveryAction
 *
 *   sit in the same repository, fully built, reachable from nowhere the scan
 *   knows about. The diagnosis and the cure were written by different findings
 *   and never introduced to one another.
 *
 * ── AND WHY THIS IS NOT A "HEAL EVERYTHING" BUTTON ──────────────────────────
 *
 *   The owner's standing instruction on this audit is that data must be safe —
 *   "you can't delete or destroy anything... rather fix the errors and ensure
 *   all data are safe". Six of the scan's checks CANNOT be healed by a machine
 *   without inventing a fact:
 *
 *     a balance disagreeing with its transactions is either a missing
 *     transaction or a wrong balance, and writing one to match the other
 *     destroys the evidence of which; a WAVE applicant recorded as male is
 *     either a wrong record or an application that should not stand; an
 *     investment over its cap is money that already moved.
 *
 *   So each check declares whether it is repairable, and when it is not it says
 *   WHY on the screen. A reason is more useful than a button that does nothing
 *   and far more useful than one that does the wrong thing — and this suite
 *   pins that every unrepairable check actually carries one.
 *
 * ── THE ORPHANED PRODUCT REPAIR SUSPENDS, IT DOES NOT DELETE ────────────────
 *
 *   A listing whose seller no longer exists cannot be fulfilled, so leaving it
 *   on sale takes money for goods nobody will ship. Suspending removes it from
 *   every buyer-facing read — they all filter `status == "active"` — and keeps
 *   the row, its images and its order history. That is what the owner's
 *   instruction requires and what makes the repair reversible.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { REPAIR_BY_CHECK, repairFor, isRepairKind, REPAIR_KINDS } from '@/lib/forensic-repairs';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

const FORENSICS = 'src/app/actions/forensics.ts';
const PAGE = 'src/app/admin/forensics/page.tsx';

// ─────────────────────────────────────────────────────────────────────────────
describe('#757 — every check says whether it can be repaired, and why not', () => {
    it('EVERY CHECK THE SCAN EMITS HAS AN ANSWER', () => {
        /*
         *   Measured from the scan itself rather than from a hand-kept list:
         *   the check names are string literals in forensics.ts, and a check
         *   added later with no entry must still get an answer.
         */
        const names = [...code(FORENSICS).matchAll(/check:\s*"([^"]+)"/g)].map((m) => m[1]);

        expect(names.length).toBeGreaterThan(8);
        for (const name of new Set(names)) {
            const offer = repairFor(name);
            //   Either it is repairable, or it explains itself. Never neither.
            expect({ name, answered: offer.safe === true || !!offer.reason })
                .toEqual({ name, answered: true });
        }
    });

    it('AND AN UNSAFE OFFER ALWAYS CARRIES A REASON', () => {
        //   "No button and no explanation" reads as an oversight, which is how
        //   a deliberate refusal to auto-repair gets mistaken for a gap.
        for (const [check, offer] of Object.entries(REPAIR_BY_CHECK)) {
            if (offer.safe) continue;
            expect({ check, hasReason: (offer.reason ?? '').length > 20 })
                .toEqual({ check, hasReason: true });
        }
    });

    it('AND A SAFE OFFER ALWAYS NAMES A KIND THE DISPATCHER KNOWS', () => {
        //   The vacuity guard: `safe: true` with no kind renders a button that
        //   cannot do anything.
        for (const [check, offer] of Object.entries(REPAIR_BY_CHECK)) {
            if (!offer.safe) continue;
            expect({ check, known: isRepairKind(offer.kind) }).toEqual({ check, known: true });
        }
    });

    it('AND AN UNKNOWN CHECK IS NOT SILENTLY TREATED AS FINE', () => {
        //   The failure direction that costs nothing: a check renamed without
        //   updating the map offers no repair and says so, rather than
        //   inheriting somebody else's.
        const offer = repairFor('A Check Nobody Has Written Yet');

        expect(offer.safe).toBe(false);
        expect(offer.kind).toBeUndefined();
        expect(offer.reason).toContain('No automatic repair');
    });

    it('THE THREE MONEY AND IDENTITY CHECKS ARE DELIBERATELY NOT AUTO-REPAIRED', () => {
        /*
         *   Asserted by name, because this is a decision rather than an
         *   omission and a later sweep should have to argue with it.
         */
        for (const check of [
            'Financial Reconciliation (Balance vs Txs)',
            'Eligibility Paradox (Gender/Age)',
            'Investment Cap Breach',
        ]) {
            expect({ check, safe: repairFor(check).safe }).toEqual({ check, safe: false });
        }
    });

    it('and the scan attaches the offer to every result it returns', () => {
        //   Attached once at the return rather than at each of the ten push
        //   sites, so a check added later gets an answer automatically.
        expect(code(FORENSICS)).toContain('repair: repairFor(r.check)');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#757 — the repair itself is gated, validated and audited', () => {
    it('IT ASKS THE DATABASE FOR THE CALLER\'S ROLE, NOT THE TOKEN', () => {
        //   This writes across the user table and the product catalogue. #532
        //   and #750 established that such a gate must re-read the roles, and
        //   #375 that it must name its permission.
        expect(code(FORENSICS)).toContain('await requireAdmin("config:update")');
    });

    it('AND REFUSES A KIND IT DOES NOT KNOW', () => {
        //   A server action's argument is whatever a browser sent. Without
        //   this, the dispatcher's final branch — the product suspension — runs
        //   for any unrecognised string.
        expect(code(FORENSICS)).toContain('if (!isRepairKind(kind))');
        expect(isRepairKind('orphaned_users')).toBe(true);
        expect(isRepairKind('rm -rf')).toBe(false);
        expect(isRepairKind(undefined)).toBe(false);
    });

    it('AND RECORDS WHAT IT DID', () => {
        //   maintenance.ts was pulled up for exactly this: a bulk mutation of
        //   payment and wallet rows, recorded nowhere.
        const src = code(FORENSICS);

        expect(src).toContain('recordAdminAction');
        expect(src).toContain('"forensic_repair"');
    });

    it('AND THE RECOVERY IT DISPATCHES TO IS ITSELF ON THE LIVE GATE NOW', () => {
        /*
         *   `runServiceRegistrationRecoveryAction` gated on
         *   `hasAdminPermission(session.user.roles, ...)` — the stale JWT — on
         *   a job that writes every user on the platform. It became reachable
         *   from the forensic screen in this finding, which is the wrong moment
         *   to leave that gate on it.
         */
        const src = code('src/app/actions/data-recovery.ts');

        expect(src).toContain('await requireAdmin("users:update")');
        expect(src).not.toContain('hasAdminPermission(sessionResult.session.user.roles');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#757 — the orphaned-product repair suspends rather than deletes', () => {
    it('IT WRITES A STATUS, AND THERE IS NO DELETE IN THE DISPATCHER', () => {
        /*
         *   The owner's standing instruction on this audit, asserted as code: a
         *   listing whose seller is gone is taken off sale and KEPT. Deleting
         *   it would take its images and its order history with it, and could
         *   not be undone if the seller is restored.
         */
        const src = code(FORENSICS);
        const dispatcher = src.slice(src.indexOf('async function runRepair'));

        expect(dispatcher).toContain('status: "suspended"');
        expect(dispatcher).toContain('seller_no_longer_exists');
        expect(dispatcher).not.toMatch(/\.delete\(\)/);
        expect(dispatcher).not.toContain('deleteDoc');
    });

    it('AND SUSPENDING REALLY DOES TAKE IT OFF SALE', () => {
        /*
         *   Without this the repair would be a label. Visibility is defined in
         *   one place — PRODUCT_VISIBLE_STATUSES — and "suspended" is not in
         *   it, which is what makes the repair sufficient.
         */
        const { PRODUCT_VISIBLE_STATUSES, PRODUCT_SELLABLE_STATUSES, isSellableProductStatus } =
            jest.requireActual('@/lib/product-status') as typeof import('@/lib/product-status');

        expect([...PRODUCT_VISIBLE_STATUSES]).not.toContain('suspended');
        expect([...PRODUCT_SELLABLE_STATUSES]).not.toContain('suspended');
        expect(isSellableProductStatus('suspended')).toBe(false);
        expect(isSellableProductStatus('active')).toBe(true);
    });

    it('AND IT SWEEPS EVERY VISIBLE STATUS, NOT JUST "active"', () => {
        /*
         *   A CORRECTION TO MY OWN FIRST DRAFT, caught by writing the test
         *   above. The repair filtered `status == "active"`, and
         *   PRODUCT_VISIBLE_STATUSES is ["active", "out_of_stock"] — an
         *   out-of-stock listing is still on the shop and still belongs to a
         *   seller who no longer exists. Repairing one of the two would have
         *   looked complete and left half the orphans on sale: the same
         *   partial-coverage shape this audit keeps finding, committed by me,
         *   in the fix for it.
         */
        const src = code(FORENSICS);
        const dispatcher = src.slice(src.indexOf('async function runRepair'));

        expect(dispatcher).toContain('"status", "in", [...PRODUCT_VISIBLE_STATUSES]');
        expect(dispatcher).not.toContain('"status", "==", "active"');
    });

    it('and it only touches listings whose seller is genuinely absent', () => {
        //   The guard that keeps this from suspending the catalogue: a product
        //   is skipped when it has no sellerId recorded OR the seller exists.
        const src = code(FORENSICS);
        const dispatcher = src.slice(src.indexOf('async function runRepair'));

        expect(dispatcher).toContain('if (!sellerId || liveSellerIds.has(sellerId)) continue;');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#757 — and the screen offers it, or explains itself', () => {
    it('A REPAIRABLE FINDING GETS A BUTTON', () => {
        expect(code(PAGE)).toContain('runRepair(r.repair!.kind!)');
    });

    it('AND AN UNREPAIRABLE ONE PRINTS THE REASON INSTEAD', () => {
        const page = code(PAGE);

        expect(page).toContain('Not repaired automatically.');
        expect(page).toContain('{r.repair.reason}');
    });

    it('AND A PASSING CHECK OFFERS NEITHER', () => {
        //   A "Repair these" button beside a green check is noise, and worse,
        //   it invites a write nobody needs.
        expect(code(PAGE)).toContain('r.status !== "pass" && r.repair?.safe');
    });

    it('AND THE SCREEN RE-SCANS AFTER REPAIRING, SO THE RESULT IS MEASURED', () => {
        /*
         *   A repair that reports "fixed 12" and leaves the same twelve
         *   findings on screen has told an administrator nothing they can
         *   check. Re-running turns the claim into a measurement.
         */
        const page = code(PAGE);
        const handler = page.slice(page.indexOf('async function runRepair'));

        expect(handler).toContain('await runScan()');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored from a snapshot copy
 *   keyed by FULL PATH, each mutant proving its edit landed by a unique string
 *   on disk.
 *
 *     MUTANT                                                        RESULT
 *     a money check is marked safe to auto-repair                    KILLED
 *     an unsafe offer loses its reason                               KILLED
 *     the unknown-check fallback claims safety                       KILLED
 *     the kind validation is removed                                 KILLED
 *     the gate goes back to the token                                KILLED
 *     the product repair deletes instead of suspending               KILLED
 *     the product repair narrows back to "active" only               KILLED
 *     the recovery gate goes back to the token                       KILLED
 *     the screen stops re-scanning after a repair                    KILLED
 *     the scan stops attaching repair offers                         KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED
 *
 *   ONE DEFECT IN THIS FINDING WAS FOUND BY WRITING ITS OWN TEST. The product
 *   repair filtered `status == "active"`, and PRODUCT_VISIBLE_STATUSES is
 *   ["active", "out_of_stock"] — so half the orphaned listings would have been
 *   left on sale by a repair that reported success. That is the partial-coverage
 *   shape this audit keeps finding, committed by me, inside the fix for it.
 */
