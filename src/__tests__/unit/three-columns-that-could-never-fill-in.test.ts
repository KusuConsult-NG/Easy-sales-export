/**
 * @jest-environment node
 */

/**
 *   #640 THE SWEEP THAT COMPOSES THREE SCANNERS HAD ONE WIRED TO A FIELD THAT
 *        DOES NOT EXIST, AND THE OTHER TWO POINTED AT HALF THE SURFACE.
 *
 *   module-sweep is the fourth instrument, and the one that finds what the other
 *   three cannot: it stands every endpoint beside its siblings in the same
 *   business module and asks which one differs. That is how
 *   `_syncShipmentWithCarrierAction` was found — every other WAVE endpoint
 *   required a session and that one took an id and required nothing.
 *
 *   It walks BOTH src/app/actions and src/app/api, deliberately. The three lead
 *   columns it joins against did not:
 *
 *       scanForOwnership("src/app/actions", "src")
 *       scanForFakeGuards("src/app/actions", "src")
 *       scanDirectory(join(ROOT, "src/app/actions"), join(ROOT, "src"))
 *
 *   So a route handler could never carry `ownership-lead`, `fake-guard` or
 *   `baseline-unguarded`. Every API entry in every module was listed with three
 *   columns permanently blank, and a blank column reads as "nothing found".
 *
 *   AND THE FAKE-GUARD COLUMN WAS BLANK EVERYWHERE, on both surfaces. Its key
 *   was built as
 *
 *       scanForFakeGuards(...).map((l: any) => `${l.file}::${l.name}`)
 *
 *   and a FakeGuardLead has no `name` — the field is `fn`. Every key was the
 *   string "…::undefined", which matches no entry, so the `fake-guard` clause of
 *   `isLead()` had never fired for anything, anywhere, since the day it was
 *   written. The `as any` is what let it compile.
 *
 *   The timing is the part worth keeping: #638 and #639 had just finished
 *   teaching the ownership and fake-guard scanners to read route handlers at
 *   all, and this is where both answers were going to be thrown away.
 *
 *   Same shape as the two findings before it — a silence that cannot be told
 *   apart from a clean result — which is why it was looked for.
 *
 * ── WHAT THE REPAIRED SWEEP SAYS ────────────────────────────────────────────
 *
 *   654 entries, 116 of them route handlers. The route leads it can now produce
 *   were read, and all are the documented false-positive classes:
 *
 *     paystack webhook, two crons     `baseline-unguarded`: a signature and a
 *                                     shared secret, which is what a callback
 *                                     has instead of a session.
 *     auth/register, whatsapp-invite  public by design.
 *     two cooperative money routes    `MONEY` with no role check — a member
 *                                     moving their own money, the largest
 *                                     false-positive class this sweep has.
 *
 *   And two entries were read closely because they are not that class:
 *
 *     _getOrCreateWallet              NOT an entry point. A private helper in an
 *                                     actions file, called with a session-derived
 *                                     id. The sweep names every function in the
 *                                     file, which is a lead list's job.
 *     _confirmWalletFundingAction     exported, and genuinely has no session —
 *                                     correctly. The authority is the PAYMENT:
 *                                     the reference is verified against Paystack,
 *                                     the amount is taken from what Paystack
 *                                     actually charged rather than the metadata,
 *                                     the credited user is the one the payment
 *                                     names, and creditWalletOnce claims the
 *                                     reference atomically so a replay returns
 *                                     "already processed" instead of crediting
 *                                     twice. Nothing a caller supplies decides
 *                                     anything.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { join } from 'path';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { sweepByModule, isLead, type ModuleEntry } from '@/lib/testing/module-sweep';
import { scanFileForFakeGuards } from '@/lib/testing/fake-guard-scan';

const ROOT = process.cwd();

/**
 * Sweep a throwaway tree holding one route handler.
 *
 *   NOT THE REAL TREE. The first version of this wrote the probe into
 *   src/app/api and deleted it afterwards, which passed on its own and FAILED
 *   in the full run: jest runs suites in parallel workers, and another suite
 *   that scans the write surface counted the probe while it existed. A test
 *   that mutates the tree its neighbours are reading is a flake generator, and
 *   the repair is the instrument's, not the test's — sweepByModule takes its
 *   roots as an argument now.
 */
function sweepProbe(code: string): ModuleEntry[] {
    const dir = mkdtempSync(join(tmpdir(), 'sweep-probe-'));
    const api = join(dir, 'src', 'app', 'api', 'thing');
    try {
        mkdirSync(api, { recursive: true });
        writeFileSync(join(api, 'route.ts'), code);
        //   An empty actions surface as well, so the sweep reads exactly one
        //   entry and nothing can be attributed to a neighbour.
        mkdirSync(join(dir, 'src', 'app', 'actions'), { recursive: true });
        return sweepByModule({
            surfaces: [join(dir, 'src/app/actions'), join(dir, 'src/app/api')],
            src: join(dir, 'src'),
        }).flatMap((g) => g.entries);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#640 — the fake-guard column was keyed on a field that does not exist', () => {
    it('A FakeGuardLead HAS `fn`, AND HAS NEVER HAD `name`', () => {
        /*
         *   The direct cause, asserted on the value rather than on the type —
         *   a type tells you what the compiler believed, and `as any` was what
         *   stopped it believing anything.
         */
        const dir = mkdtempSync(join(tmpdir(), 'leadshape-'));
        try {
            const file = join(dir, 'sample.ts');
            writeFileSync(file, `
                export async function submitForVerificationAction(listingId: string, ownerId: string) {
                    const doc = await db.collection("land").doc(listingId).get();
                    if (doc.data().ownerId !== ownerId) return { error: "Unauthorized" };
                    await doc.ref.update({ status: "submitted" });
                }
            `);
            const leads = scanFileForFakeGuards(file, dir);
            expect(leads).toHaveLength(1);
            expect(leads[0].fn).toBe('submitForVerificationAction');
            expect((leads[0] as unknown as Record<string, unknown>).name).toBeUndefined();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('AND THE SWEEP NOW FLAGS ONE — the clause that had never fired', () => {
        const entries = sweepProbe(`
            export async function POST(req: Request) {
                const { session } = await requireSession();
                const { listingId, ownerId } = await req.json();
                const doc = await db.collection("land").doc(listingId).get();
                if (doc.data().ownerId !== ownerId) {
                    return Response.json({ error: "Unauthorized" }, { status: 403 });
                }
                await doc.ref.update({ status: "submitted" });
                return Response.json({ ok: true });
            }
        `);

        expect(entries).toHaveLength(1);
        expect(entries[0].flags).toContain('fake-guard');
        expect(isLead(entries[0])).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#640 — and the three columns reach the API surface', () => {
    it('AN OWNERSHIP LEAD IN A ROUTE IS AN OWNERSHIP LEAD', () => {
        const entries = sweepProbe(`
            export async function POST(req: Request) {
                const { session } = await requireSession();
                const { userId } = await req.json();
                await db.collection("wallets").doc(userId)
                    .update({ balance: 0, updatedBy: session.user.id });
                return Response.json({ ok: true });
            }
        `);

        expect(entries).toHaveLength(1);
        expect(entries[0].flags).toContain('ownership-lead');
        expect(isLead(entries[0])).toBe(true);
    });

    it('AND A ROUTE WITH NO GUARD AT ALL REACHES THE UNGUARDED COLUMN', () => {
        const entries = sweepProbe(`
            export async function POST(req: Request) {
                const { thingId } = await req.json();
                await db.collection("things").doc(thingId).update({ touched: true });
                return Response.json({ ok: true });
            }
        `);

        expect(entries).toHaveLength(1);
        expect(entries[0].flags).toContain('baseline-unguarded');
    });

    it('AND A CAREFUL ROUTE COLLECTS NONE OF THE THREE', () => {
        //   Otherwise "the columns reach the API surface" would also be true of
        //   columns that flag everything, which is a lead list nobody reads.
        const entries = sweepProbe(`
            export async function POST(req: Request) {
                const { session } = await requireSession();
                const { listingId } = await req.json();
                const doc = await db.collection("land").doc(listingId).get();
                if (doc.data().ownerId !== session.user.id) {
                    return Response.json({ error: "Unauthorized" }, { status: 403 });
                }
                await doc.ref.update({ status: "submitted" });
                return Response.json({ ok: true });
            }
        `);

        expect(entries).toHaveLength(1);
        for (const flag of ['fake-guard', 'ownership-lead', 'baseline-unguarded']) {
            expect({ flag, present: entries[0].flags.includes(flag) })
                .toEqual({ flag, present: false });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#640 — and the real tree carries neither of the two sharp flags', () => {
    const all = sweepByModule().flatMap((g) => g.entries);

    it('THE SWEEP READS BOTH SURFACES — a positive control on the walk', () => {
        //   A sweep that read no route files would make the assertions below
        //   pass while measuring nothing, which is this finding's own shape.
        expect(all.length).toBeGreaterThan(500);
        expect(all.filter((e) => e.kind === 'route').length).toBeGreaterThan(100);
        expect(all.filter((e) => e.kind === 'action').length).toBeGreaterThan(300);
    });

    it('NO ENTRY IS A FAKE GUARD', () => {
        expect(all.filter((e) => e.flags.includes('fake-guard'))
            .map((e) => `${e.file}::${e.name}`)).toEqual([]);
    });

    it('AND THE OWNERSHIP LEADS ARE THE THREE ALREADY READ', () => {
        /*
         *   Named rather than counted, and all three are recorded false
         *   positives — two in ownership-scan.test.ts, the third read in
         *   a-scan-that-read-half-the-doors.test.ts. A fourth appearing here is
         *   the signal to read it.
         */
        expect(all.filter((e) => e.flags.includes('ownership-lead'))
            .map((e) => e.name).sort()).toEqual([
            '_getSellerReviewSummaryAction',
            'completeCourse',
            'joinVillageMarketEventAction',
        ]);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: the fake-guard key goes back to `l.name`            KILLED
 *     THE DEFECT: the lead sets cover the first surface only          KILLED
 *     the ownership column covers the first surface only              KILLED
 *     the unguarded column covers the first surface only              KILLED
 *     isLead stops treating a fake guard as a lead                    KILLED
 *     the sweep stops walking the second surface                      KILLED
 *     paths stop being relative to the swept tree                     KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                              SURVIVED ✓
 *
 * ── AND THE FIRST VERSION OF THIS TEST WAS ITSELF THE DEFECT ────────────────
 *
 *   To prove the columns can fill in, something has to be there to fill them.
 *   The first version wrote its probe into src/app/api and deleted it
 *   afterwards. It passed alone and FAILED IN THE FULL RUN: jest runs suites in
 *   parallel workers, and a neighbouring suite that scans the write surface
 *   counted the probe while it existed.
 *
 *   A test that mutates the tree its neighbours are reading is a flake
 *   generator, and the repair belongs to the instrument rather than the test:
 *   `sweepByModule` takes its roots as an argument now, and the probes run on a
 *   throwaway tree. A scanner that can only be pointed at one directory cannot
 *   be tested without disturbing it — which is why it had not been.
 */
