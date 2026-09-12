/**
 * @jest-environment node
 */

/**
 *   #654 A RULE THE DATABASE ENFORCES BY ITSELF, THAT NOTHING TESTS AND NO
 *        TYPESCRIPT MENTIONS.
 *
 *   `trg_enforce_member_active_on_paid` is a BEFORE INSERT OR UPDATE trigger on
 *   `cooperative_members`, enabled, shipped in schema.sql and migration 008. It
 *   refuses to move a member who is `active` or `paid` back to `pending` when
 *   they have a cooperative contribution on record, unless the update carries a
 *   `statusChangeReason` explaining why.
 *
 *   It fires on EVERY write to that table — every approval, every suspension,
 *   every synthesised membership — and it is the only business rule in this
 *   platform enforced by the database rather than by code. Nothing exercises it.
 *   The whole of `src/` does not contain the string `enforce_member_active_on_paid`,
 *   and the audit's own sweeps cannot see it: they read TypeScript.
 *
 * ── WHAT WAS CHECKED BEFORE WRITING THIS, AND CAME BACK CLEAN ───────────────
 *
 *   Three ways the application could collide with it, each followed to the end:
 *
 *   1. THE ADMIN STATUS SETTER. `_updateMemberStatusAction` writes
 *      `membershipStatus` unconditionally — no check-then-write, whatever it is
 *      handed. But its type is `"active" | "approved" | "suspended"`, so it
 *      cannot produce `pending` and cannot trip the guard.
 *
 *   2. THE TWO SYNTHESISE-FROM-PAYMENT PATHS. `_dashboard.ts` and
 *      `_coop_identity.ts` both merge `membershipStatus: "pending"` onto
 *      `doc(userId)` after a completed payment, and the dashboard carries a note
 *      recording that this once demoted an ACTIVE member on a mere page load —
 *      "a read endpoint should not be able to do that". Its sibling has no such
 *      guard, which is this audit's most repeated shape and looked like a
 *      finding. IT IS NOT: `_coop_identity.ts` has a FALLBACK 2 that reads
 *      `doc(userId)` directly, so a row at that id is always found first and the
 *      merge only ever inserts. The trigger never blocks an insert.
 *
 *   3. THE COLUMN. The trigger reads `NEW.status`, a native column, while the
 *      application writes `membershipStatus` into `raw_data` — a guard on a
 *      field nobody writes would be #624 at the database level. It is not:
 *      `native_column_map` mirrors BOTH `membershipStatus` and `status` onto
 *      the native `status` column, so the trigger sees what the app writes.
 *
 *   So the guard is a correct backstop against a direct database edit or a
 *   future code change, and none of its refusals is reachable today. That is
 *   the honest finding, and it is written down here because the next person to
 *   wonder should not have to follow all three again.
 *
 * ── AND ITS ESCAPE HATCH EXISTS ONLY IN SQL ─────────────────────────────────
 *
 *   When the guard fires it tells the operator to set `statusChangeReason`. That
 *   string appears NOWHERE in this repository outside the trigger's own body —
 *   no action writes it, no schema declares it, no screen offers it. So the one
 *   documented way through the rule is a thing the application cannot do.
 *
 *   Recorded rather than built: adding a writer for a path nothing currently
 *   takes would be inventing a feature, and the note is what the next person
 *   needs. What IS fixed is that the rule is now executed and pinned, so a
 *   schema rebuild that loses the trigger, or an edit that widens it, fails here
 *   instead of silently.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { Client } from 'pg';
import { dbDescribe, PG_URL } from '@/lib/testing/pg-harness';

let client: Client | null = null;

beforeAll(async () => {
    if (!PG_URL) return;
    client = new Client({ connectionString: PG_URL, connectionTimeoutMillis: 5000 });
    await client.connect();
});

afterAll(async () => {
    await client?.end().catch(() => {});
});

/** A member row at `status`, replacing any earlier one. */
async function member(id: string, status: string, raw: Record<string, unknown> = {}): Promise<void> {
    await client!.query(
        `insert into cooperative_members (id, user_id, status, raw_data)
         values ($1, $1, $2, $3::jsonb)
         on conflict (id) do update set status = excluded.status, raw_data = excluded.raw_data`,
        [id, status, JSON.stringify({ membershipStatus: status, ...raw })],
    );
}

/** A processed payment of the given type, against this member's user id. */
async function payment(id: string, userId: string, type: string): Promise<void> {
    await client!.query(
        `insert into processed_payments (id, user_id, amount, reference, raw_data)
         values ($1, $2, 1000, $1, $3::jsonb)
         on conflict (id) do update set raw_data = excluded.raw_data`,
        [id, userId, JSON.stringify({ type, reference: id })],
    );
}

/** Move a member to `status`, optionally carrying a reason. */
const moveTo = (id: string, status: string, reason?: string) =>
    client!.query(
        `update cooperative_members
            set status = $2,
                raw_data = raw_data || $3::jsonb
          where id = $1`,
        [id, status, JSON.stringify({
            membershipStatus: status,
            ...(reason === undefined ? {} : { statusChangeReason: reason }),
        })],
    );

const statusOf = async (id: string) => (
    await client!.query('select status from cooperative_members where id = $1', [id])
).rows[0]?.status;

beforeEach(async () => {
    if (!client) return;
    await client.query(`delete from cooperative_members where id like '654-%'`);
    await client.query(`delete from processed_payments where id like '654-%'`);
});

// ─────────────────────────────────────────────────────────────────────────────
dbDescribe('#654 — the trigger is attached, which is half of whether it exists', () => {
    it('IT IS ON cooperative_members, ENABLED, AND FIRES ON BOTH WRITES', async () => {
        /*
         *   A trigger FUNCTION without its trigger is a rule that governs
         *   nothing — #618, #623 and #624 are all that shape, and a schema
         *   rebuild that loses one line here would look exactly like success.
         *
         *   `tgenabled = 'O'` is "enabled, origin": it fires on ordinary writes.
         *   'D' would be disabled and everything else in this file would still
         *   pass if the assertions were only about the function's body.
         */
        const { rows } = await client!.query(`
            select c.relname as tbl, t.tgenabled as enabled,
                   pg_get_triggerdef(t.oid) as def
              from pg_trigger t
              join pg_class c on c.oid = t.tgrelid
              join pg_proc p on p.oid = t.tgfoid
             where p.proname = 'enforce_member_active_on_paid' and not t.tgisinternal`);

        expect(rows.length).toBe(1);
        expect({ tbl: rows[0].tbl, enabled: rows[0].enabled })
            .toEqual({ tbl: 'cooperative_members', enabled: 'O' });
        expect(rows[0].def).toMatch(/BEFORE INSERT OR UPDATE/);
        expect(rows[0].def).toMatch(/FOR EACH ROW/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
dbDescribe('#654 — a paid-up member is not quietly demoted', () => {
    it('REFUSES active -> pending WHEN A CONTRIBUTION IS ON RECORD', async () => {
        //   THE rule. And the row must be untouched: a BEFORE trigger that
        //   raised after a partial write would be worse than none.
        await member('654-a', 'active');
        await payment('654-p1', '654-a', 'contribution');

        await expect(moveTo('654-a', 'pending')).rejects.toThrow(/cannot be set to pending/i);
        expect(await statusOf('654-a')).toBe('active');
    });

    it('AND REFUSES paid -> pending TOO', async () => {
        //   Both starting states are named in the rule; asserting one would let
        //   the other be dropped.
        await member('654-b', 'paid');
        await payment('654-p2', '654-b', 'contribution');

        await expect(moveTo('654-b', 'pending')).rejects.toThrow(/cannot be set to pending/i);
        expect(await statusOf('654-b')).toBe('paid');
    });

    it('AND THE REFUSAL IS A check_violation THAT SAYS WHAT TO DO', async () => {
        /*
         *   The message is the only place the escape hatch is documented, and
         *   it reaches an operator through whatever surfaces database errors.
         *   A code of 'check_violation' is also what lets a caller tell this
         *   apart from a connection failure.
         */
        await member('654-c', 'active');
        await payment('654-p3', '654-c', 'contribution');

        const err = await moveTo('654-c', 'pending').catch((e) => e);

        expect(err.code).toBe('23514');
        expect(String(err.hint)).toMatch(/statusChangeReason/);
        expect(String(err.message)).toMatch(/654-c/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
dbDescribe('#654 — and it refuses only what it claims to', () => {
    it('AN INSERT AT pending IS NEVER BLOCKED — the control', async () => {
        /*
         *   Applications begin at `pending`, so a guard that read INSERTs too
         *   would stop anybody joining the cooperative at all. Every refusal
         *   above is satisfied by a trigger that blocks everything; this is what
         *   says it does not.
         */
        await payment('654-p4', '654-d', 'contribution');
        await member('654-d', 'pending');

        expect(await statusOf('654-d')).toBe('pending');
    });

    it('AND AN EXPLICIT REASON PERMITS THE CHANGE', async () => {
        //   The documented way through, for refunds, reversals and corrections.
        await member('654-e', 'active');
        await payment('654-p5', '654-e', 'contribution');

        await moveTo('654-e', 'pending', 'refunded after duplicate charge');

        expect(await statusOf('654-e')).toBe('pending');
    });

    it('AND A BLANK REASON IS NOT A REASON', async () => {
        //   `NULLIF(TRIM(...), '')` — whitespace must not open the door, or the
        //   hatch is "send any value at all".
        await member('654-f', 'active');
        await payment('654-p6', '654-f', 'contribution');

        await expect(moveTo('654-f', 'pending', '   ')).rejects.toThrow(/cannot be set to pending/i);
        expect(await statusOf('654-f')).toBe('active');
    });

    it('AND ONLY A CONTRIBUTION COUNTS AS HAVING PAID DUES', async () => {
        /*
         *   Stated in the trigger and worth pinning: wallet funding, a
         *   marketplace purchase and an academy fee are money, and none of them
         *   is evidence that cooperative membership was paid for. A guard that
         *   counted any payment would freeze members who had only ever bought a
         *   bag of maize.
         */
        await member('654-g', 'active');
        await payment('654-p7', '654-g', 'wallet_funding');
        await payment('654-p8', '654-g', 'academy_registration');

        await moveTo('654-g', 'pending');

        expect(await statusOf('654-g')).toBe('pending');
    });

    it("AND ANOTHER MEMBER'S CONTRIBUTION IS NOT THIS ONE'S", async () => {
        //   The lookup is by user_id. Without that it would freeze every member
        //   the moment anybody paid dues.
        await member('654-h', 'active');
        await payment('654-p9', 'somebody-else', 'contribution');

        await moveTo('654-h', 'pending');

        expect(await statusOf('654-h')).toBe('pending');
    });

    it('AND A MOVE TO ANY OTHER STATUS IS OUT OF SCOPE', async () => {
        /*
         *   `suspended` is the one the admin screen actually produces, and it
         *   must not be caught by a rule about demotion to pending — an admin
         *   suspending a paid-up member for cause would otherwise be refused
         *   with a message about refunds.
         */
        await member('654-i', 'active');
        await payment('654-p10', '654-i', 'contribution');

        await moveTo('654-i', 'suspended');

        expect(await statusOf('654-i')).toBe('suspended');
    });

    it('AND A MEMBER WHO WAS NEVER active OR paid MAY GO TO pending', async () => {
        //   OLD.status decides scope. A `revision_required` application going
        //   back to pending is ordinary administration.
        await member('654-j', 'revision_required');
        await payment('654-p11', '654-j', 'contribution');

        await moveTo('654-j', 'pending');

        expect(await statusOf('654-j')).toBe('pending');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
dbDescribe('#654 — the escape hatch the application cannot reach', () => {
    it('statusChangeReason IS THE ONLY WAY THROUGH, AND ONLY SQL KNOWS IT', () => {
        /*
         *   Not a behaviour test — a record. The trigger's message tells an
         *   operator to set a field that no action writes, no schema declares
         *   and no screen offers. The rule therefore has a documented remedy
         *   that cannot be performed through the product.
         *
         *   It is left alone rather than "fixed": nothing in the application can
         *   currently trip the guard (see the header), so building a writer for
         *   it would be inventing a feature rather than repairing one. What
         *   matters is that the next person meeting this error is not the first
         *   to discover that the hint is unactionable.
         *
         *   Asserted as a fact about the repository so that it stops being true
         *   the day somebody adds one — at which point this test fails and asks
         *   them to delete it.
         */
        const { execSync } = require('child_process') as typeof import('child_process');
        //   The application, not its tests. The first version of this swept all
        //   of `src/` and found THIS FILE, which names the field in its own
        //   prose — the same trap as #651's YAML comment satisfying an assertion
        //   about the step beneath it, one turn later. A sweep has to exclude
        //   the thing doing the sweeping.
        const hits = execSync(
            `grep -rl statusChangeReason src/ supabase/ | grep -v __tests__ || true`,
            { cwd: process.cwd(), encoding: 'utf8' },
        ).trim().split('\n').filter(Boolean).sort();

        expect(hits).toEqual([
            //   #660 committed the generated single-file deploy, which is the
            //   migrations concatenated — so every migration's mention of this
            //   field appears a second time in it. Listing it here is honest
            //   (the string IS in the repository twice) but it would also make
            //   the aggregate a place a NEW writer could hide, since this test
            //   only checks the set of filenames. The assertion below closes
            //   that: the generated file may only repeat lines a migration
            //   already has.
            'supabase/deploy.sql',
            'supabase/migrations/008_fix_member_status_trigger.sql',
            'supabase/schema.sql',
        ]);
    });

    it('AND THE GENERATED DEPLOY ONLY REPEATS WHAT A MIGRATION ALREADY SAYS', () => {
        /*
         *   The control on the line above. Adding a filename to an expected
         *   list is the cheapest possible way to make a sweep green again, and
         *   it is how a sweep stops sweeping: `deploy.sql` is 33 migrations
         *   long, and "it is allowed to mention the field" would let anything
         *   at all be written into it.
         *
         *   So the aggregate is held to containment rather than to permission —
         *   every line of it that names the field must be a line some migration
         *   also has. That is the actual property of a generated file, and it
         *   fails the moment somebody hand-edits the deploy or regenerates it
         *   from a source that is not in `supabase/migrations/`.
         */
        const { readFileSync, readdirSync } = require('fs') as typeof import('fs');
        const { join } = require('path') as typeof import('path');

        const root = process.cwd();
        const lines = (text: string) =>
            text.split('\n').map((l) => l.trim()).filter((l) => l.includes('statusChangeReason'));

        const fromMigrations = new Set<string>();
        for (const file of readdirSync(join(root, 'supabase/migrations')).filter((f) => f.endsWith('.sql'))) {
            for (const line of lines(readFileSync(join(root, 'supabase/migrations', file), 'utf8'))) {
                fromMigrations.add(line);
            }
        }

        const deployLines = lines(readFileSync(join(root, 'supabase/deploy.sql'), 'utf8'));

        //   A positive control on the comparison itself: an empty deploy file,
        //   or one this test failed to read, would satisfy "every line is
        //   accounted for" while checking nothing.
        expect(deployLines.length).toBeGreaterThan(0);
        expect(deployLines.filter((l) => !fromMigrations.has(l))).toEqual([]);
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   The trigger function itself, replaced in the live database with
 *   CREATE OR REPLACE and restored from migration 008 afterwards.
 *
 *     MUTANT                                                        RESULT
 *     THE RULE: the demotion guard stops refusing                     KILLED
 *     'paid' drops out of the guarded starting states                 KILLED
 *     it catches every status change, not just to pending             KILLED
 *     a blank reason opens the door                                   KILLED
 *     any payment counts as cooperative dues                          KILLED
 *     the contribution lookup ignores whose it is                     KILLED
 *
 *     NO-OP — CANNOT BE KILLED, AND SHOULD NOT BE FAKED
 *     the `TG_OP <> 'UPDATE'` early return is deleted                 SURVIVED
 *
 *   That last one survived and then turned out not to be a mutant at all. With
 *   the early return gone, an INSERT still falls straight through the NEXT
 *   guard — `OLD.status IS NULL` is true on an insert — so the function behaves
 *   identically. Verified directly against the database rather than reasoned
 *   about: an insert at `pending`, with a contribution on record, under the
 *   mutated function, succeeds.
 *
 *   So `TG_OP <> 'UPDATE'` is belt-and-braces rather than load-bearing. It is
 *   left exactly where it is — it states the intent plainly and costs nothing —
 *   and no test is contrived to "cover" it, because a test that cannot fail is
 *   the thing this audit spends most of its time removing. The third time a
 *   surviving mutant has turned out to be a no-op (#649, #652's ordering run,
 *   here), and each time the useful answer was to check the mutant before
 *   changing the test.
 */
