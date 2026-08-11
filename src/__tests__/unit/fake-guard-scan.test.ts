/**
 * @jest-environment node
 */

/**
 * A scanner for authorisation checks that compare a record against a value the
 * CALLER supplied.
 *
 * THE PATTERN IT EXISTS FOR — land-listings.ts, fixed 2026-08-11
 * -------------------------------------------------------------
 *     async function _submitForVerificationAction(listingId, ownerId) {
 *         const listingData = listingDoc.data();
 *         if (listingData.ownerId !== ownerId) {         // ownerId is a PARAMETER
 *             return { error: "Unauthorized" };
 *         }
 *
 * Pass the real owner's id — readable from the public listing — and the check
 * passes. **Worse than no check, because it reads as one.**
 *
 * Neither existing scanner sees it. `action-auth-scan` asks whether a guard is
 * called; `ownership-scan` asks whether the session is used, and a comparison
 * counts as a decision. This asks the third question: is the value being
 * compared against something the caller controls?
 *
 * IT CURRENTLY FINDS NOTHING IN src/app/actions
 * ---------------------------------------------
 * Which is exactly why the tests below matter. A scanner that reports nothing is
 * indistinguishable from a scanner that is broken, and the only way to tell them
 * apart is to feed it the defect it was built for. The first case does that with
 * the real land-listings code.
 */

import { describe, it, expect } from '@jest/globals';
import { join } from 'path';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { scanFileForFakeGuards, scanForFakeGuards } from '@/lib/testing/fake-guard-scan';

function scan(code: string): string[] {
    const dir = mkdtempSync(join(tmpdir(), 'fakeguard-'));
    try {
        const file = join(dir, 'sample.ts');
        writeFileSync(file, code);
        return scanFileForFakeGuards(file, dir).map((l) => l.fn);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

describe('the defect it was built for', () => {
    it('catches the land-listings check, as it was actually written', async () => {
        // THE test. Verbatim shape of the code fixed this morning. If this ever
        // stops failing, the scanner has stopped working.
        const found = scan(`
            "use server";
            async function _submitForVerificationAction(listingId: string, ownerId: string) {
                const listingRef = db.collection("land").doc(listingId);
                const listingDoc = await listingRef.get();
                const listingData = listingDoc.data();
                if (listingData.ownerId !== ownerId) {
                    return { error: "Unauthorized" };
                }
                await listingRef.update({ status: "pending_verification" });
            }
        `);

        expect(found).toContain('_submitForVerificationAction');
    });

    it('catches it when the id arrives inside a data object', async () => {
        const found = scan(`
            "use server";
            async function updateThing(data: { id: string; ownerId: string }) {
                const doc = await db.collection("things").doc(data.id).get();
                if (doc.data().ownerId !== data.ownerId) return { error: "Unauthorized" };
                await doc.ref.update({ ok: true });
            }
        `);

        expect(found).toContain('updateThing');
    });
});

describe('what it must not flag', () => {
    it('a comparison against the session', async () => {
        const found = scan(`
            "use server";
            async function updateThing(id: string) {
                const { session } = await requireSession();
                const doc = await db.collection("things").doc(id).get();
                if (doc.data().ownerId !== session.user.id) return { error: "Unauthorized" };
            }
        `);

        expect(found).not.toContain('updateThing');
    });

    it('a comparison against a local derived from the session', async () => {
        const found = scan(`
            "use server";
            async function updateThing(id: string) {
                const { session } = await requireSession();
                const callerId = session.user.id;
                const doc = await db.collection("things").doc(id).get();
                if (doc.data().ownerId !== callerId) return { error: "Unauthorized" };
            }
        `);

        expect(found).not.toContain('updateThing');
    });

    it('a parameter PINNED to the session earlier in the function', async () => {
        // The good idiom, and the reason the first version of this scanner
        // reported deleteCertificateAction and _sendEscrowMessageAction — both
        // of which are correct. `userId` is proven before it is used.
        const found = scan(`
            "use server";
            async function deleteCertificate(certificateId: string, userId: string) {
                const { session } = await requireSession();
                if (session.user.id !== userId) return { error: "Unauthorized" };
                const cert = (await db.collection("certs").doc(certificateId).get()).data();
                if (cert.userId !== userId) return { error: "Unauthorized" };
                await db.collection("certs").doc(certificateId).delete();
            }
        `);

        expect(found).not.toContain('deleteCertificate');
    });

    it('two request values compared for validity, not authorisation', async () => {
        // _createEscrowAction does this: a seller may not be their own buyer.
        // It is a validation rule and names no record.
        const found = scan(`
            "use server";
            async function createEscrow(data: { buyerId: string; sellerId: string }) {
                if (data.sellerId === data.buyerId) return { error: "Invalid seller" };
                await db.collection("escrow").add(data);
            }
        `);

        expect(found).not.toContain('createEscrow');
    });

    it('a comparison of fields that are not identities', async () => {
        const found = scan(`
            "use server";
            async function updateThing(data: { id: string; status: string }) {
                const doc = await db.collection("things").doc(data.id).get();
                if (doc.data().status !== data.status) return { error: "Stale" };
            }
        `);

        expect(found).not.toContain('updateThing');
    });
});

describe('the scan over this codebase', () => {
    it('reports the current leads, whatever they are', () => {
        // Deliberately not asserting zero. The number is expected to be zero
        // today because land-listings was the only one and it is fixed, but
        // pinning that here would turn a lead list into a gate — the mistake
        // ownership-scan.test.ts also refuses to make.
        const leads = scanForFakeGuards(
            join(process.cwd(), 'src/app/actions'),
            join(process.cwd(), 'src')
        );

        expect(Array.isArray(leads)).toBe(true);
        for (const l of leads) {
            expect(typeof l.file).toBe('string');
            expect(typeof l.line).toBe('number');
        }
    });
});
