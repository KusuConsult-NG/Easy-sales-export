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

    it('membership tested with .includes — no longer a false positive', async () => {
        // addFlashSaleProductAction. This USED to be reported: `.includes()` is
        // a call, not a binary expression, so the comparison rule never fired.
        //
        // It is now cleared for a different and better reason — the write is
        // `sellerId: userId` where userId came from the session, which settles
        // ownership by construction. The `.includes()` blindness is still
        // there; it just stopped mattering here.
        //
        // Recorded as a change of behaviour rather than deleted, because the
        // original limitation is real and the next reader should know which
        // rule is doing the work.
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

        expect(found).not.toContain('addProduct');
    });

    it('still cannot see membership when the write carries no identity field', async () => {
        // The `.includes()` limitation, isolated. Ownership is enforced and the
        // scanner cannot tell, because nothing in the write names the caller.
        const found = scan(`
            "use server";
            export async function archiveEvent(data: { eventId: string }) {
                const { session } = await requireSession();
                const event = await db.collection("events").doc(data.eventId).get();
                if (!(event.data().organiserIds || []).includes(session.user.id)) {
                    return { error: "Not an organiser" };
                }
                await db.collection("events").doc(data.eventId).update({ archived: true });
            }
        `);

        expect(found).toContain('archiveEvent'); // flagged, but correct code
    });
});

describe('reads, which it used to ignore entirely', () => {
    it('flags a read scoped by a caller-supplied id', async () => {
        // THE addition. getUserPaymentHistoryAction is this exact shape: the
        // session is established, only the error is inspected, and the query
        // then runs on the caller's own argument. Any authenticated user reads
        // anybody's rows.
        //
        // Before this, the scanner considered only functions that WRITE, so the
        // read half was found by hand four separate times instead.
        const found = scan(`
            "use server";
            export async function getHistory(userId: string) {
                const sessionResult = await requireSession();
                if (sessionResult.error) return [];
                const snap = await db.collection("payments").where("userId", "==", userId).get();
                return snap.docs;
            }
        `);

        expect(found).toContain('getHistory');
    });

    it('does not flag a read scoped by the session', async () => {
        // Vacuity guard, and the distinction the whole rule turns on. Same
        // query, same collection — the only difference is where the compared
        // value came from.
        const found = scan(`
            "use server";
            export async function getMyHistory() {
                const { session } = await requireSession();
                const snap = await db.collection("payments").where("userId", "==", session.user.id).get();
                return snap.docs;
            }
        `);

        expect(found).not.toContain('getMyHistory');
    });

    it('does not flag a read scoped through a session-derived local', async () => {
        // Ownership is routinely established through a local rather than inline.
        const found = scan(`
            "use server";
            export async function getMine() {
                const sessionResult = await requireSession();
                const callerId = sessionResult.session?.user?.id;
                const snap = await db.collection("payments").where("userId", "==", callerId).get();
                return snap.docs;
            }
        `);

        expect(found).not.toContain('getMine');
    });

    it('clears a caller-scoped read once ownership is checked', async () => {
        // The fix shape, so the rule cannot be satisfied only by deleting the
        // query.
        const found = scan(`
            "use server";
            export async function getHistory(userId: string) {
                const { session } = await requireSession();
                if (session.user.id !== userId && !isAdmin(session.user.roles)) return [];
                const snap = await db.collection("payments").where("userId", "==", userId).get();
                return snap.docs;
            }
        `);

        expect(found).not.toContain('getHistory');
    });

    it('does not flag a read that never scopes by an identity at all', async () => {
        // Reads are reported only when a caller-supplied identity chose the
        // rows. Without that there is no demonstrable link to another user and
        // the list would fill with noise.
        const found = scan(`
            "use server";
            export async function getCourse(courseId: string) {
                await requireSession();
                const snap = await db.collection("courses").doc(courseId).get();
                return snap.data();
            }
        `);

        expect(found).not.toContain('getCourse');
    });
});

describe('stamping an identity into a log decides nothing', () => {
    it('still flags a function whose only session use is a log line', async () => {
        // How _getSellerReviewSummaryAction hid. `userId: session...` inside a
        // logger call matched the "identity field receives a session value"
        // rule, which exists for `ownerId: session.user.id` on a RECORD, and
        // marked the whole function as having decided ownership.
        //
        // This is the very distinction the rule was written to make — the vendor
        // writers "recorded WHO acted without deciding whether they MAY" — and
        // it was implemented for `updatedBy` only.
        const found = scan(`
            "use server";
            export async function getSummary(sellerId: string) {
                let sessionResult;
                try {
                    sessionResult = await requireSession();
                    const snap = await db.collection("reviews").where("sellerId", "==", sellerId).get();
                    return snap.docs;
                } catch (err) {
                    logger.error("failed", { sellerId, userId: sessionResult?.session?.user?.id });
                    return null;
                }
            }
        `);

        expect(found).toContain('getSummary');
    });

    it('still clears a write that stamps the identity onto the record', async () => {
        // Vacuity guard. The original rule is correct and must survive: an
        // ownerId taken from the session cannot be forged, so there is nothing
        // left to compare.
        const found = scan(`
            "use server";
            export async function createListing(data: { title: string }) {
                const { session } = await requireSession();
                await db.collection("listings").add({ title: data.title, ownerId: session.user.id });
            }
        `);

        expect(found).not.toContain('createListing');
    });

    it('does not clear a write because an audit call names the caller', async () => {
        // The vendor defect itself, one call further along: the audit row
        // records who acted, the update still writes to a caller-supplied id.
        const found = scan(`
            "use server";
            export async function zeroStock(productId: string) {
                const { session } = await requireSession();
                await db.collection("products").doc(productId).update({ stock: 0 });
                await createAdminAuditLog({ action: "zero_stock", userId: session.user.id });
            }
        `);

        expect(found).toContain('zeroStock');
    });
});

describe('corrections made after it missed a real bug', () => {
    it('does not treat a ceiling guard as an ownership guard', async () => {
        // THE correction. bookExportSlotAction authenticated, ignored the
        // session, and booked an export slot for a caller-supplied userId — and
        // was invisible here because it calls incrementWithinCeiling, which was
        // wrongly on the owner-aware list.
        //
        // incrementWithinCeiling enforces a CEILING. It does not know who the
        // caller is, so it is no evidence that ownership was checked.
        const found = scan(`
            "use server";
            export async function bookSlot(data: { windowId: string; userId: string }) {
                const { session } = await requireSession();
                await incrementWithinCeiling({ id: data.windowId, ceiling: 100 });
                await db.collection("slots").add({ userId: data.userId });
            }
        `);

        expect(found).toContain('bookSlot');
    });

    it('accepts ownership established by construction', async () => {
        // `ownerId: session.user.id` cannot be forged, so there is nothing left
        // to compare. Requiring a comparison flagged every correct writer.
        const found = scan(`
            "use server";
            export async function createThing(data: { ownerId: string; title: string }) {
                const { session } = await requireSession();
                await db.collection("things").add({ ...data, ownerId: session.user.id });
            }
        `);

        expect(found).not.toContain('createThing');
    });

    it('follows a session-derived local into the identity field', async () => {
        // bookExportSlotAction was fixed with a local, not a direct reference,
        // and kept being reported until this was handled.
        const found = scan(`
            "use server";
            export async function bookSlot(data: { windowId: string; userId: string }) {
                const sessionResult = await requireSession();
                const bookingUserId = sessionResult.session?.user?.id;
                await db.collection("slots").add({ windowId: data.windowId, userId: bookingUserId });
            }
        `);

        expect(found).not.toContain('bookSlot');
    });

    it('handles the shorthand property form', async () => {
        // `{ ownerId }` is a different AST node from `{ ownerId: x }`, and was
        // missed entirely — _createLandListingAction stayed flagged after it had
        // been fixed.
        const found = scan(`
            "use server";
            export async function createThing(data: { title: string }) {
                const { session } = await requireSession();
                const ownerId = session.user.id;
                await db.collection("things").add({ ...data, ownerId });
            }
        `);

        expect(found).not.toContain('createThing');
    });

    it('still flags the vendor case, where the session only stamps an audit row', async () => {
        // Vacuity guard for all four above. Recording WHO acted is not deciding
        // whether they MAY, and widening the rule must not lose that.
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
});

describe('the scan over this codebase', () => {
    it('is a tool, not a gate — no assertion on the live count', () => {
        // Recorded rather than enforced. The count moves as actions are added,
        // and the value here is the reading it prompts, not a number that must
        // stay put. action-auth-per-function.test.ts is the gate; this is not.
        expect(typeof scanFileForOwnership).toBe('function');
    });
});
