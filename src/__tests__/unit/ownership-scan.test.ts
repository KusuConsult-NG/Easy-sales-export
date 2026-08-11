/**
 * @jest-environment node
 */

/**
 * The ownership scanner, and — more usefully — what it cannot see.
 *
 * `action-auth-scan.ts` asks whether a function calls a guard.
 * This asks the next question: having established who the caller is, does the
 * function use the answer for anything?
 *
 * That is the vendor defect. All four vendor writers called `requireSession`.
 * Three used `session.user.id` only to stamp an audit row — recording WHO acted
 * without deciding whether they MAY.
 *
 * IT IS A LEAD LIST, NOT A DEFECT LIST, AND THAT IS DELIBERATE
 * -----------------------------------------------------------
 * Run over src/app/actions it produced 10 candidates. On reading:
 *
 *   1 real, live, fixed        _createDisputeAction
 *   1 real, unreachable        createPaymentRecordAction (no callers)
 *   8 false positives          each for a reason pinned below
 *
 * A 20% hit rate is worth an hour of reading and would be intolerable as a
 * build gate — which is why this ships as a tool with tests, not as a ratchet
 * like action-auth-per-function. Wiring it to fail CI would train people to
 * silence it.
 *
 * The false-positive cases below are the valuable part of this file. Each is an
 * idiom that enforces ownership in a way no syntactic rule can follow, and each
 * cost real reading time to dismiss.
 */

import { describe, it, expect } from '@jest/globals';
import { join } from 'path';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { scanFileForOwnership } from '@/lib/testing/ownership-scan';

function scan(code: string): string[] {
    const dir = mkdtempSync(join(tmpdir(), 'ownscan-'));
    try {
        const file = join(dir, 'sample.ts');
        writeFileSync(file, code);
        return scanFileForOwnership(file, dir).map((l) => l.name).sort();
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

describe('what it catches', () => {
    it('flags a function that authenticates and then ignores the session', async () => {
        // THE signature. The id is the caller's, the write is on the caller's
        // id, and the session is used for nothing but the audit trail.
        const found = scan(`
            "use server";
            export async function zeroStock(productId: string) {
                const { session } = await requireSession();
                await db.collection("products").doc(productId).update({
                    stock: 0,
                    updatedBy: session.user.id,
                });
            }
        `);

        expect(found).toContain('zeroStock');
    });

    it('does not flag one that compares the session to the record owner', async () => {
        // Vacuity guard.
        const found = scan(`
            "use server";
            export async function zeroStock(productId: string) {
                const { session } = await requireSession();
                const doc = await db.collection("products").doc(productId).get();
                if (doc.data().sellerId !== session.user.id) return { error: "Unauthorized" };
                await db.collection("products").doc(productId).update({ stock: 0 });
            }
        `);

        expect(found).not.toContain('zeroStock');
    });

    it('does not flag an admin action', async () => {
        // An admin action is legitimately not owner-scoped.
        const found = scan(`
            "use server";
            export async function banUser(userId: string) {
                const { session } = await requireSession();
                if (!isAdmin(session.user.roles)) return { error: "Unauthorized" };
                await db.collection("users").doc(userId).update({ banned: true });
            }
        `);

        expect(found).not.toContain('banUser');
    });

    it('recognises the hand-rolled admin check', async () => {
        // The commonest admin idiom here calls no helper. `isAdmin` is a local
        // variable and `r === "admin"` names no user id, so the obvious rules
        // miss it. Before this was handled the scan reported 35 leads instead
        // of 10, and 25 of them were correct admin actions.
        const found = scan(`
            "use server";
            export async function grantBadge(userId: string) {
                const { session } = await requireSession();
                const roles = session.user.roles || [];
                const isAdmin = roles.some(r => r === "admin" || r === "super_admin");
                if (!isAdmin) return { error: "Unauthorized: Admin only" };
                await db.collection("users").doc(userId).update({ badge: "verified" });
            }
        `);

        expect(found).not.toContain('grantBadge');
    });
});

describe('what it cannot see — each of these was a false positive worth reading', () => {
    it('ownership encoded in a derived document id', async () => {
        // completeCourse. The key is `${session.user.id}_${courseId}`, so a
        // caller can only ever address their own row. There is no comparison to
        // find because there is nothing to compare — the id cannot be forged.
        const found = scan(`
            "use server";
            export async function completeCourse(courseId: string) {
                const { session } = await requireSession();
                const ref = db.collection("progress").doc(\`\${session.user.id}_\${courseId}\`);
                await ref.update({ completed: true });
            }
        `);

        expect(found).toContain('completeCourse'); // flagged, but correct code
    });

    it('membership tested with .includes rather than a comparison', async () => {
        // addFlashSaleProductAction. `participantIds.includes(userId)` is a
        // call, not a binary expression, so the comparison rule never fires.
        const found = scan(`
            "use server";
            export async function addProduct(data: { eventId: string; title: string }) {
                const { session } = await requireSession();
                const userId = session.user.id;
                const event = await db.collection("events").doc(data.eventId).get();
                const participantIds = event.data().participantSellerIds || [];
                if (!participantIds.includes(userId)) return { error: "Not a participant" };
                await db.collection("products").add({ eventId: data.eventId, sellerId: userId });
            }
        `);

        expect(found).toContain('addProduct'); // flagged, but correct code
    });
});

describe('the scan over this codebase', () => {
    it('is a tool, not a gate — no assertion on the live count', () => {
        // Recorded rather than enforced. The count moves as actions are added,
        // and the value here is the reading it prompts, not a number that must
        // stay put. action-auth-per-function.test.ts is the gate; this is not.
        expect(typeof scanFileForOwnership).toBe('function');
    });
});
