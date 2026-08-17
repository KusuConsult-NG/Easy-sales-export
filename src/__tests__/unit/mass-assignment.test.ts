/**
 * @jest-environment node
 */

/**
 * Caller data must never overwrite a security-relevant field.
 *
 * WHY THIS IS A GATE AND NOT A LEAD LIST
 * --------------------------------------
 * The other scanners answer fuzzy questions and have false positives, so they
 * ship as tools. This one answers a mechanical question — does a sensitive
 * field appear before a caller-controlled spread in the same object literal —
 * and the live count is **zero**. A gate that starts green and only ever fails
 * on a real regression is worth having in CI.
 *
 * WHAT IT PROTECTS
 * ----------------
 * From security-review-2026-08-10.md:
 *
 *     const escrow = { ...data,          // caller-supplied
 *         status: "pending",             // ← overwrites an injected status
 *         _version: 0 };
 *
 * "Reverse those two lines and it becomes privilege escalation — an escrow
 * created already funded, without payment. Fourteen sites depend on this, and
 * nothing enforces it."
 *
 * All fourteen are correct today. They are correct by the ORDER OF TWO LINES,
 * which no reviewer checks. This makes it structural.
 *
 * IT FINDS NOTHING TODAY, SO THE FIXTURES ARE THE REAL TEST
 * --------------------------------------------------------
 * A checker reporting zero is indistinguishable from a broken one — the lesson
 * from `fake-guard-scan` and from three vacuous assertions before it. So the
 * first case below is the exact literal from the security review, reversed.
 */

import { describe, it, expect } from '@jest/globals';
import { join } from 'path';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import {
    scanFileForMassAssignment,
    scanForMassAssignment,
} from '@/lib/testing/mass-assignment-scan';

function scan(code: string) {
    const dir = mkdtempSync(join(tmpdir(), 'massassign-'));
    try {
        const file = join(dir, 'sample.ts');
        writeFileSync(file, code);
        return scanFileForMassAssignment(file, dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

describe('the defect it exists for', () => {
    it('catches a status set before a caller-controlled spread', async () => {
        // THE test — the escrow literal from the security review, with the two
        // lines reversed. A caller sending `status: "funded"` wins.
        const found = scan(`
            "use server";
            export async function createEscrow(data: { buyerId: string; amount: number }) {
                const escrow = {
                    status: "pending",
                    _version: 0,
                    ...data,
                };
                await db.collection("escrow").add(escrow);
            }
        `);

        expect(found).toHaveLength(1);
        expect(found[0].fields).toEqual(expect.arrayContaining(['status', '_version']));
    });

    it('catches roles being overwritable', async () => {
        // The worst version of this: a caller-supplied roles array is privilege
        // escalation outright.
        const found = scan(`
            "use server";
            export async function createUser(input: { email: string }) {
                await db.collection("users").add({ roles: ["member"], ...input });
            }
        `);

        expect(found).toHaveLength(1);
        expect(found[0].fields).toContain('roles');
    });

    it('catches ownerId being overwritable', async () => {
        const found = scan(`
            "use server";
            export async function createListing(data: { title: string }) {
                const { session } = await requireSession();
                await db.collection("listings").add({ ownerId: session.user.id, ...data });
            }
        `);

        expect(found).toHaveLength(1);
        expect(found[0].fields).toContain('ownerId');
    });
});

describe('inside an API route', () => {
    it('catches a sensitive field before a request-derived spread', () => {
        // The blind spot both scanners in this file shared: caller data in a
        // route handler is not a parameter, it is `await request.json()`. Every
        // API route was therefore exempt from this gate by construction.
        const found = scan(`
            export async function POST(request: NextRequest) {
                const body = await request.json();
                const { id, ...rest } = body;
                await db.collection("products").doc(id).update({ status: "active", ...rest });
            }
        `);

        expect(found).toHaveLength(1);
        expect(found[0].fields).toContain('status');
    });

    it('but not a named binding off the same body', () => {
        // Vacuity guard for the widening. Tainting named bindings would make
        // this gate fire on ordinary routes and it would get switched off.
        const found = scan(`
            export async function POST(request: NextRequest) {
                const body = await request.json();
                const { title } = body;
                await db.collection("things").add({ status: "pending", title });
            }
        `);

        expect(found).toHaveLength(0);
    });
});

describe('what it must not flag', () => {
    it('the safe ordering — spread first', async () => {
        // Vacuity guard: a checker that flags every spread would make every
        // assertion above pass while being useless.
        const found = scan(`
            "use server";
            export async function createEscrow(data: { buyerId: string; amount: number }) {
                await db.collection("escrow").add({
                    ...data,
                    status: "pending",
                    _version: 0,
                });
            }
        `);

        expect(found).toHaveLength(0);
    });

    it('a conditional spread of server-computed values', async () => {
        // farm-nation-admin.ts really does this, and the first version of the
        // scanner reported it. The spread carries timestamps the server made;
        // no caller can reach it.
        const found = scan(`
            "use server";
            export async function completeSale(txData: { propertyId: string }) {
                const isLease = true;
                await db.collection("listings").doc(txData.propertyId).update({
                    status: isLease ? "leased" : "sold",
                    ...(isLease ? { leasedAt: serverTimestamp() } : { soldAt: serverTimestamp() }),
                });
            }
        `);

        expect(found).toHaveLength(0);
    });

    it('a spread of a document loaded from the database', async () => {
        // Also flagged by the first version. The record is server-owned.
        const found = scan(`
            "use server";
            export async function refresh(id: string) {
                const existing = (await db.collection("things").doc(id).get()).data();
                await db.collection("things").doc(id).set({ status: "active", ...existing });
            }
        `);

        expect(found).toHaveLength(0);
    });

    it('a non-sensitive field before a caller spread', async () => {
        // Overwriting a display name is not a security event.
        const found = scan(`
            "use server";
            export async function createThing(data: { title: string }) {
                await db.collection("things").add({ label: "default", ...data });
            }
        `);

        expect(found).toHaveLength(0);
    });
});

describe('the codebase', () => {
    it('has no write where caller data can overwrite a security field', () => {
        const leads = scanForMassAssignment(
            [join(process.cwd(), 'src/app/actions'), join(process.cwd(), 'src/app/api')],
            join(process.cwd(), 'src')
        );

        if (leads.length > 0) {
            throw new Error(
                `\n\n⚠️  ${leads.length} write(s) let caller data overwrite a security field:\n\n` +
                leads.map((l) => `  ${l.file}:${l.line}\n      overwritable: ${l.fields.join(', ')}`).join('\n') +
                `\n\nFIX: move the spread FIRST, so the server's values are written after it:\n` +
                `      { ...data, status: "pending", _version: 0 }\n\n` +
                `This is not style. Reversed, a caller can create a record already\n` +
                `funded, approved, or owned by someone else.\n`
            );
        }
        expect(leads).toEqual([]);
    });
});
