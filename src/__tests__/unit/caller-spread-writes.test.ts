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
 *
 * AND THE SCAN CAN GO BLIND, WHICH IS WORSE THAN A WRONG GREP — #948
 * -----------------------------------------------------------------
 * A wrong grep is wrong out loud. An instrument that stops seeing a shape
 * reports a smaller number, and a smaller number on a security ledger reads as
 * progress.
 *
 * #612 added `updateExisting` to the adapter — `update()` on a missing document
 * is a silent no-op in the Supabase shim — and converted sixteen call sites to
 * it. WRITE_METHODS did not list it, so all sixteen left this scan's view in
 * that commit, two of them spreading the action's own parameter. The pin for
 * app/actions/wave/_wv_admin_resources.ts still said 4 and the scan found 2,
 * and nothing failed: the gate only asked whether a count had GROWN.
 *
 * Two things follow, both below. WRITE_METHODS lists updateExisting, with a
 * fixture that fails if it is ever dropped again; and the pin ratchets
 * downwards, so a number above the truth has to be explained — as a site that
 * was fixed, or as the instrument going blind again.
 */

import { describe, it, expect } from '@jest/globals';
import { join } from 'path';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import {
    scanFileForCallerSpreadWrites,
    scanForCallerSpreadWrites,
    WRITE_METHODS,
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

    it("catches #612's updateExisting, which it was blind to", () => {
        /*
         *   #948 THE BLIND SPOT, AS A FIXTURE.
         *
         *   `updateExisting` is the adapter method #612 added because `update()`
         *   on a missing document is a silent no-op in the Supabase shim. Sixteen
         *   call sites were converted to it, and all of them left this scanner's
         *   view in that commit — WRITE_METHODS did not list it.
         *
         *   Two of them spread the action's own parameter. Both are pinned below;
         *   the pin was right and the scan had stopped seeing them, which is why
         *   the ledger went down while nothing was fixed.
         */
        const found = scan(`
            "use server";
            export async function editThing(id: string, data: { title: string }) {
                const wrote = await db.collection("things").doc(id).updateExisting({
                    ...data,
                    updatedAt: FieldValue.serverTimestamp(),
                });
                if (!wrote) return { success: false as const, error: "gone" };
            }
        `);

        expect(found).toHaveLength(1);
        expect(found[0].spread).toBe('data');
        expect(found[0].named).toEqual(['updatedAt']);
    });

    it('AND WRITE_METHODS COVERS EVERY DATA-TAKING WRITE ON THE ADAPTER', () => {
        /*
         *   #948 THE GENERAL FORM, and the assertion that would have failed on
         *   the day updateExisting landed rather than months later.
         *
         *   A fixture proves the scanner sees the methods somebody thought to
         *   write a fixture for. This asks the adapter what it can write, which is
         *   the question that goes stale on its own — the blind spot did not
         *   arrive as a mistake in this file, it arrived as a new method in
         *   another one.
         *
         *   Read off supabase-db.ts by signature, because a hand-kept second list
         *   of write methods is the shape that produced the gap.
         */
        const adapter = readFileSync(join(process.cwd(), 'src/lib/supabase-db.ts'), 'utf-8');

        const writers = new Set<string>();
        for (const m of adapter.matchAll(
            /^\s+(?:async )?([a-zA-Z]+)\((?:ref: SupabaseDocumentReference, )?data: Record<string, any>/gm,
        )) {
            writers.add(m[1]);
        }

        //   Control: the pattern must find the adapter's writes, or an empty set
        //   would satisfy the assertion below and prove nothing.
        expect([...writers].sort()).toEqual(['add', 'create', 'set', 'update', 'updateExisting']);

        const missing = [...writers].filter((w) => !WRITE_METHODS.has(w));

        expect({
            missing,
            hint: 'A write method the scanner cannot see is a write it cannot check.',
        }).toEqual({
            missing: [],
            hint: 'A write method the scanner cannot see is a write it cannot check.',
        });
    });

    it('catches a caller spread into .create(), which is an INSERT', () => {
        //   #948 Nothing in the tree does this today — payout-outcome's single
        //   .create() names its fields — so this fixture is the whole of the
        //   coverage, and it is why `create` was added before somebody needed it.
        const found = scan(`
            "use server";
            export async function recordThing(id: string, data: { note: string }) {
                await db.collection("things").doc(id).create({ ...data, receivedAt: 1 });
            }
        `);

        expect(found).toHaveLength(1);
        expect(found[0].spread).toBe('data');
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
    //   #948 _settings.ts REMOVED. #317 narrowed it: the write is now
    //   `{ ...checked.values, updatedBy, updatedAt }`, where `checked.values`
    //   comes out of checkSystemSettingsPatch and holds exactly the fields
    //   SYSTEM_SETTINGS_FIELDS declares. The scanner cannot trace that to a
    //   parameter because it is not one any more. The entry goes so that `added`
    //   catches it if the bounds-checker is ever removed.
    'app/actions/export-admin.ts': 1,
    'app/actions/wave/_wv_admin_resources.ts': 4,
    //   #948 _ac_catalog.ts REMOVED, for the same reason as its sibling above
    //   and NOT because of the blind spot: both its spreads are of a parser's
    //   output — `...validatedData` on create and `...validation.data` on
    //   update — so adding updateExisting to WRITE_METHODS made the update site
    //   visible and the scanner still, correctly, declines to flag it.
    // Admin-only route (isAdmin, incl. super_admin) spreading its own JSON body
    // into a quiz document. An admin can write these fields directly, so the
    // spread grants nothing. Surfaced only once the scanner learned to follow
    // `await request.json()` — see the note in mass-assignment-scan.ts.
    'app/api/admin/academy/quiz/create/route.ts': 1,

    // Server-built objects, not request payloads.
    //
    //   #920 _ac_applications.ts REMOVED, and the claim it was filed under was
    //   the wrong one. Its entry sat in this section — "server-built objects, not
    //   request payloads" — but the spread was
    //   `t.set(appRef, { ...applicationData })`, and `applicationData` was the
    //   action's own PARAMETER: the learner's form body, straight from the
    //   browser, with no schema between. What made it harmless was the eleven
    //   fields pinned AFTER the spread (userId, status, paymentStatus, reviewedBy
    //   and the rest), not anything about where the object came from. Measured:
    //   `invented: 'yes'` and `_version: 99` reached the row.
    //
    //   The submit door now parses through AcademyApplicationInputSchema, like
    //   its resubmit sibling, so the spread really is of a server-built object —
    //   the parser's output — and the scanner no longer traces it to a parameter.
    //   The entry goes rather than being restated, so that `added` catches it if
    //   the parse is ever removed.
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

    it('AND THE PIN RATCHETS DOWNWARDS TOO — #948', () => {
        /*
         *   A pin ABOVE the truth fails here. The gate above only asked about
         *   `added` and `grown`, so a KNOWN entry describing a site that has gone
         *   away failed nothing — and the difference was room for that many new
         *   caller-controlled spreads IN THAT FILE, absorbed in silence, because
         *   `actual[f] > KNOWN[f]` is false while the slack lasts.
         *
         *   The previous note recorded that gap and declined to close it: "a stale
         *   entry is a claim somebody made that only its author can retire." That
         *   reasoning protects the wrong thing. The claim a KNOWN entry makes is
         *   "this spread is safe BECAUSE …"; when the spread is gone the claim is
         *   not somebody's opinion to preserve, it is slack in a security gate.
         *
         *   And it is how #948 stayed invisible. `_wv_admin_resources.ts` was
         *   pinned at 4 while the scan found 2, because updateExisting had left
         *   WRITE_METHODS — so the instrument went blind and the gate read that as
         *   two sites fixed. A ledger that can only be tightened by hand is a
         *   ledger that records an instrument failure as progress.
         */
        const actual: Record<string, number> = {};
        for (const l of leads) actual[l.file] = (actual[l.file] ?? 0) + 1;

        const shrunk = Object.keys(KNOWN)
            .filter((f) => (actual[f] ?? 0) < KNOWN[f])
            .map((f) => `${f}: pinned ${KNOWN[f]}, found ${actual[f] ?? 0}`);

        if (shrunk.length) {
            throw new Error(
                `\n\n⬇️  A pin above the truth. Two things do this, and they are\n` +
                `   opposites — establish WHICH before editing the number:\n\n` +
                shrunk.map((l) => `  ${l}`).join('\n') +
                `\n\n1. THE SITE WAS FIXED. Lower the pin, with a note naming what\n` +
                `   narrowed it. This is the good case.\n` +
                `2. THE SCANNER WENT BLIND — a new adapter write method that is not\n` +
                `   in WRITE_METHODS, which is #948 exactly. Open the file and look\n` +
                `   for the spread before you touch this number.\n`
            );
        }

        expect(shrunk).toEqual([]);
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
        /*
         *   Vacuity guard for the assertions above. A scanner returning [] passes
         *   `added` and `grown` and proves nothing.
         *
         *   #948 9 -> 11, AND THE DIRECTION IS THE OPPOSITE OF AN IMPROVEMENT.
         *   `updateExisting` joined WRITE_METHODS, so two sites the scan had
         *   stopped seeing are visible again — both in
         *   app/actions/wave/_wv_admin_resources.ts, both spreading the action's
         *   own `data` parameter, both there the whole time. Nothing about the
         *   actions changed. The pin of 4 was right.
         *
         *   #920's 10 -> 9 was the good kind: the academy submit door now parses
         *   its input, so the spread really is of a parser's output. Both movements
         *   looked identical from here, which is what the downward ratchet above
         *   exists to stop.
         *
         *   THE NUMBER IS EXACT NOW, not a floor. The ratchet makes every KNOWN
         *   entry equal to its measured count, so the total is determined — and an
         *   exact total is one more place a silent blind spot has to show up.
         */
        const pinned = Object.values(KNOWN).reduce((a, b) => a + b, 0);

        expect(leads.length).toBe(pinned);
        expect(leads.length).toBe(11);
    });
});

/**
 * ── MUTATION LOG, #948 ──────────────────────────────────────────────────────
 *
 *   MUTANT                                          CAUGHT BY
 *   ──────────────────────────────────────────────  ───────────────────────────
 *   `updateExisting` dropped from WRITE_METHODS      "catches #612's
 *     (the defect exactly as it shipped)             updateExisting", THE PIN
 *                                                    RATCHETS DOWNWARDS, and
 *                                                    "still finds the sites"
 *   `create` dropped from WRITE_METHODS              WRITE_METHODS COVERS EVERY
 *                                                    DATA-TAKING WRITE, and the
 *                                                    .create() fixture
 *   the adapter-signature pattern broken so the      WRITE_METHODS COVERS EVERY
 *     coverage claim is vacuous                      DATA-TAKING WRITE (its own
 *                                                    control on the found set)
 *   a stale pin put back (`_settings.ts`)             THE PIN RATCHETS
 *                                                    DOWNWARDS, "still finds"
 *   a pin raised above a live site, which is          THE PIN RATCHETS
 *     the slack the old gate could not see            DOWNWARDS, "still finds"
 *
 *   ALL FIVE CAUGHT. The two that matter are the first and the last: one is the
 *   instrument going blind, the other is the gate being unable to notice.
 */

