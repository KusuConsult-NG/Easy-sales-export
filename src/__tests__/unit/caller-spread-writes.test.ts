/**
 * @jest-environment node
 */

/**
 * The half of mass assignment that field order cannot fix.
 *
 * TWO RULES, ONE GAP BETWEEN THEM
 * -------------------------------
 * mass-assignment.test.ts enforces ORDER: a sensitive field must not be written
 * BEFORE a caller-controlled spread, because the spread would win. It is green,
 * and it is right.
 *
 * It says nothing about ADDITION. `{ ...data, status: "pending" }` passes that
 * rule — the spread comes first, which is what it asks for — and still writes
 * every field a caller invented that the literal never mentions. The declared
 * parameter type is erased before the request arrives; `data` is whatever JSON
 * was posted to the server action.
 *
 * So a write could satisfy the ordering rule perfectly and still let a caller
 * plant fields nobody listed. Three did:
 *
 *   payments.ts            PaymentRecord declares `completedAt` and
 *                          `paystackResponse`. A payment filed as "pending"
 *                          could arrive already carrying a gateway response and
 *                          a completion time.
 *
 *   _escrow_disputes.ts    Dispute declares `resolution`, `resolvedBy`,
 *                          `resolvedAt`. Opening an ordinary dispute could plant
 *                          a resolution and attribute it to an admin. The status
 *                          still read "open" — the admin dispute view renders
 *                          those fields regardless.
 *
 *   land-listings.ts       LandListing declares `verified`,
 *                          `verificationStatus`, `verifiedBy`, `verifiedAt` —
 *                          the record of a decision verifyLandListingAction
 *                          makes. A create request could include them. The
 *                          listing could not reach a purchasable status without
 *                          the admin transition, so this was a false badge
 *                          rather than a false sale.
 *
 * Two more were narrowed for the same reason without a declared field to point
 * at: _escrow_messages.ts (which also stopped accepting `senderName` from the
 * request — the chat renders it verbatim, so a participant could post as
 * "EasySales Support") and _quotes.ts.
 *
 * WHY A PIN AND NOT A GATE
 * ------------------------
 * The ordering scanner ships as a gate because its honest count is zero. This
 * one's honest count is not zero and should not be: the remaining sites spread
 * objects built by the server, or supplied by an admin who could write the
 * fields directly anyway. Forcing them to zero would be churn dressed as
 * security.
 *
 * So the known set is pinned. Anything NEW fails, and removing one requires
 * editing this list — which is the review conversation the property needs.
 *
 * THE COUNT, STATED HONESTLY
 * --------------------------
 * A grep for `{ ...data,` found 6 sites and I nearly reported that as the
 * total, contradicting a comment elsewhere in the tree that said fourteen. The
 * grep was wrong: it missed every literal assigned to a variable first, every
 * spread of a differently-named parameter, and every multi-line literal. The
 * AST scan finds 18. The "fourteen sites" figure in security-review-2026-08-10
 * was approximately right and my grep was not.
 */

import { describe, it, expect } from '@jest/globals';
import { join } from 'path';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import {
    scanFileForCallerSpreadWrites,
    scanForCallerSpreadWrites,
} from '@/lib/testing/mass-assignment-scan';

function scan(code: string) {
    const dir = mkdtempSync(join(tmpdir(), 'spreadwrite-'));
    try {
        const file = join(dir, 'sample.ts');
        writeFileSync(file, code);
        return scanFileForCallerSpreadWrites(file, dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

describe('the shape it exists for', () => {
    it('catches a caller spread in a write argument', () => {
        const found = scan(`
            "use server";
            export async function createThing(data: { title: string }) {
                await db.collection("things").add({ ...data, status: "pending" });
            }
        `);

        expect(found).toHaveLength(1);
        expect(found[0].spread).toBe('data');
        expect(found[0].named).toEqual(['status']);
    });

    it('catches it one hop away, through a variable', () => {
        // Both real instances were written this way. A scanner that only looked
        // at call arguments would have found neither, and reported zero — which
        // is indistinguishable from being correct.
        const found = scan(`
            "use server";
            export async function createThing(data: { title: string }) {
                const doc = { ...data, status: "pending" };
                await db.collection("things").add(doc);
            }
        `);

        expect(found).toHaveLength(1);
        expect(found[0].spread).toBe('data');
    });

    it('sees through an `as` cast on the literal', () => {
        // payments.ts writes `const payment: Omit<PaymentRecord, "id"> = {...}`
        // and _escrow_messages.ts used an intersection type. A scanner that
        // stopped at the first non-literal node would miss the typed ones —
        // which are the ones with a declared field list to abuse.
        const found = scan(`
            "use server";
            export async function createThing(data: { title: string }) {
                await db.collection("things").add({ ...data } as any);
            }
        `);

        expect(found).toHaveLength(1);
    });

    it('catches an update, not just a create', () => {
        const found = scan(`
            "use server";
            export async function editThing(id: string, data: { title: string }) {
                await db.collection("things").doc(id).update({ ...data, updatedAt: now() });
            }
        `);

        expect(found).toHaveLength(1);
    });

    it('follows caller data in through await request.json()', () => {
        // THE blind spot. A route handler's caller data is not a parameter, so
        // the first version of this scanner reported nothing for every API route
        // in the codebase — correctly by its own rule, and uselessly.
        //
        // api/marketplace/update-product was exactly this shape, and let a
        // seller write status, rating, reviewCount and sellerId on their own
        // product.
        const found = scan(`
            export async function POST(request: NextRequest) {
                const body = await request.json();
                const { productId, ...updateData } = body;
                await db.collection("products").doc(productId).update({ ...updateData, updatedAt: now() });
            }
        `);

        expect(found).toHaveLength(1);
        expect(found[0].spread).toBe('updateData');
    });

    it('follows it through formData() as well', () => {
        const found = scan(`
            export async function POST(request: NextRequest) {
                const form = await request.formData();
                await db.collection("things").add({ ...form, createdAt: now() });
            }
        `);

        expect(found).toHaveLength(1);
    });

    it('taints only the REST element of a destructuring, not a named one', () => {
        // `const { title } = body` is one field, which is the shape that is
        // safe. Tainting it would make the scan fire on every route that pulls
        // named fields out of a body — noise that would get the pin disabled.
        const found = scan(`
            export async function POST(request: NextRequest) {
                const body = await request.json();
                const { title } = body;
                await db.collection("things").add({ title, status: "pending" });
            }
        `);

        expect(found).toHaveLength(0);
    });

    it('reports the ordering-safe form too — that is the whole point', () => {
        // This literal PASSES the ordering scanner. If this test flipped to
        // expecting zero, the two scanners would cover the same ground twice and
        // the gap between them would be back.
        const found = scan(`
            "use server";
            export async function createEscrow(data: { buyerId: string }) {
                await db.collection("escrow").add({ ...data, status: "pending", _version: 0 });
            }
        `);

        expect(found).toHaveLength(1);
    });
});

describe('what it must not flag', () => {
    it('a write with no spread at all', () => {
        // Vacuity guard: a scanner that flagged every write would make every
        // assertion above pass while being useless, and would pin a set of 200.
        const found = scan(`
            "use server";
            export async function createThing(data: { title: string }) {
                await db.collection("things").add({ title: data.title, status: "pending" });
            }
        `);

        expect(found).toHaveLength(0);
    });

    it('a spread of a document loaded from the database', () => {
        const found = scan(`
            "use server";
            export async function refresh(id: string) {
                const existing = (await db.collection("things").doc(id).get()).data();
                await db.collection("things").doc(id).set({ ...existing, touchedAt: now() });
            }
        `);

        expect(found).toHaveLength(0);
    });

    it('a caller spread that never reaches a write', () => {
        // Building a response object out of the request is not a write. One of
        // my six grep hits was exactly this — _mp_catalog.ts attaching a seller
        // name to a product on the way out.
        const found = scan(`
            "use server";
            export async function search(params: { query: string }) {
                return { ...params, results: [] };
            }
        `);

        expect(found).toHaveLength(0);
    });

    it('a spread of a locally built object', () => {
        // export-admin.ts does this: `updates` is a literal chosen by a branch,
        // not anything a caller can reach.
        const found = scan(`
            "use server";
            export async function review(id: string, action: string) {
                const updates = action === "approve" ? { status: "live" } : { status: "rejected" };
                await db.collection("things").doc(id).update({ ...updates, reviewedAt: now() });
            }
        `);

        expect(found).toHaveLength(0);
    });
});

/**
 * The pinned set.
 *
 * Keyed by file with a count, not by line number: line numbers move whenever
 * anything above them is edited, and a gate that fails on unrelated edits gets
 * disabled rather than fixed.
 *
 * Every entry here spreads an object the SERVER built, or one an admin supplied
 * who could write the same fields directly. Adding a file to this list is a
 * claim about that write. Check it before you make it.
 */
const KNOWN: Record<string, number> = {
    // Admin-supplied, admin-writable.
    'app/actions/admin/_applications.ts': 1,
    'app/actions/admin/_settings.ts': 1,
    'app/actions/export-admin.ts': 1,
    'app/actions/wave/_wv_admin_resources.ts': 4,
    'app/actions/academy/_ac_catalog.ts': 1,
    // Admin-only route (isAdmin, incl. super_admin) spreading its own JSON body
    // into a quiz document. An admin can write these fields directly, so the
    // spread grants nothing. Surfaced only once the scanner learned to follow
    // `await request.json()` — see the note in mass-assignment-scan.ts.
    'app/api/admin/academy/quiz/create/route.ts': 1,

    // Server-built objects, not request payloads.
    'app/actions/academy/_ac_applications.ts': 1,
    'app/actions/land-listings.ts': 1,
    'app/actions/wave/_wv_resources.ts': 1,
    'infrastructure/notifications/service.ts': 2,
};

describe('the codebase', () => {
    const leads = scanForCallerSpreadWrites(
        [
            join(process.cwd(), 'src/app/actions'),
            join(process.cwd(), 'src/app/api'),
            join(process.cwd(), 'src/infrastructure'),
        ],
        join(process.cwd(), 'src')
    );

    it('has introduced no new caller-controlled spread into a write', () => {
        const actual: Record<string, number> = {};
        for (const l of leads) actual[l.file] = (actual[l.file] ?? 0) + 1;

        const added = Object.keys(actual).filter((f) => !(f in KNOWN));
        const grown = Object.keys(actual).filter((f) => f in KNOWN && actual[f] > KNOWN[f]);

        if (added.length || grown.length) {
            throw new Error(
                `\n\n⚠️  New caller-controlled spread(s) into a write:\n\n` +
                added.map((f) => `  NEW   ${f} (${actual[f]})`).join('\n') +
                (added.length && grown.length ? '\n' : '') +
                grown.map((f) => `  MORE  ${f} (${KNOWN[f]} → ${actual[f]})`).join('\n') +
                `\n\nThe spread writes every field the caller invented, including ones\n` +
                `this literal never mentions. Putting the spread first does not fix\n` +
                `that — it only stops the caller OVERWRITING the fields you listed.\n\n` +
                `FIX: name the fields you mean to write.\n` +
                `If the spread is of a server-built or admin-supplied object, add the\n` +
                `file to KNOWN in this test with a note saying which.\n`
            );
        }

        expect({ added, grown }).toEqual({ added: [], grown: [] });
    });

    it('the product update route writes a whitelist, not the body', () => {
        // The worst instance the widened scan found. Checked by content as well
        // as by absence from `leads`, because replacing the spread with
        // `Object.assign(patch, updateData)` would satisfy the scanner and
        // reintroduce the whole defect.
        const src = readFileSync(
            join(process.cwd(), 'src/app/api/marketplace/update-product/route.ts'),
            'utf-8',
        );

        expect(src).toContain('SELLER_EDITABLE_FIELDS');
        expect(src).not.toMatch(/update\(\{\s*\.\.\.updateData/);
        expect(src).not.toContain('Object.assign');

        // The fields a seller must NOT be able to set on their own product.
        const forbidden = ['status', 'rating', 'reviewCount', 'sellerId', 'sellerVerified', '_version'];
        const list = src.slice(src.indexOf('SELLER_EDITABLE_FIELDS = ['), src.indexOf('] as const'));
        for (const field of forbidden) {
            expect(list).not.toContain(`"${field}"`);
        }

        // And the ones it must still allow, or the edit form stops working.
        for (const field of ['title', 'description', 'pricingTiers', 'images', 'availableQuantity']) {
            expect(list).toContain(`"${field}"`);
        }
    });

    it('has kept the five that were narrowed narrow', () => {
        // The regression that matters: someone reintroducing `...data` in one of
        // the five writes this work fixed. Without this, the pin above would
        // simply absorb it as a "new" entry the next person adds to KNOWN.
        const fixed = [
            'app/actions/payments.ts',
            'app/actions/marketplace/_escrow_disputes.ts',
            'app/actions/marketplace/_escrow_messages.ts',
            'app/actions/marketplace/_quotes.ts',
            'app/actions/marketplace/_escrow_lifecycle.ts',
        ];

        expect(leads.filter((l) => fixed.includes(l.file))).toEqual([]);
    });

    it('still finds the sites that legitimately have one', () => {
        // Vacuity guard for the two assertions above. A scanner returning []
        // passes both of them and proves nothing; the count is not zero and must
        // not become zero silently.
        expect(leads.length).toBeGreaterThanOrEqual(10);
    });
});
