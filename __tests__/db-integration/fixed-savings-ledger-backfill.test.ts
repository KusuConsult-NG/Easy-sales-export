/**
 * The fixed-savings cooperative-ledger backfill, actually run.
 *
 * WHY THIS EXISTS
 * ---------------
 * Creating a fixed savings plan debits cooperative_members.savingsBalance and
 * was supposed to write a cooperative-ledger entry recording where the money
 * went. That entry did not exist. Unlike a withdrawal the debit does not move the
 * money into lockedBalance, so it left the member's held total lower with nothing
 * accounting for it.
 *
 * forensics.ts reconciles savingsBalance + lockedBalance against completed
 * cooperative_transactions rows, so every member holding a fixed savings plan
 * reported as a balance mismatch — permanently and correctly. A reconciliation
 * check that always fails for a whole class of member is a check nobody reads,
 * and that is the real damage: it hides the mismatches that matter.
 *
 * The route is fixed. scripts/backfill-fixed-savings-ledger.ts repairs the plans
 * that predate the fix, and this executes it for real against the local Postgres.
 *
 * WHAT IS ASSERTED
 * ----------------
 *   1. report mode writes NOTHING
 *   2. --apply writes exactly one ledger row per plan that lacks one
 *   3. a plan that ALREADY has its row is left alone (not rewritten)
 *   4. the row matches what the live route writes — same id, type, amount,
 *      currency, cooperativeId — because a backfilled row that grouped
 *      differently would reconcile in one place and not the other
 *   5. the entry is dated from the PLAN, not from the backfill run
 *   6. a malformed plan is skipped rather than guessed at
 *   7. running --apply repeatedly changes nothing
 *
 * (4) and (5) are the ones a unit test could not give: they are about agreement
 * with a different file's behaviour and about not corrupting history.
 */

import { supabaseAdmin } from "@/lib/supabase";
import { execFileSync } from "child_process";

declare const maybeDescribe: jest.Describe;

const PREFIX = "jest-fixsav-";
const MEMBER = `${PREFIX}member`;
const COOP_ID = `${PREFIX}coop-42`;

const PLAN_MISSING = `${PREFIX}plan-missing`;      // needs backfilling
const PLAN_PRESENT = `${PREFIX}plan-present`;      // already has its row
const PLAN_BAD_AMOUNT = `${PREFIX}plan-bad-amount`; // must be skipped
const PLAN_NO_MEMBER = `${PREFIX}plan-no-member`;   // must be skipped

const AMOUNT_MISSING = 250_000;
const AMOUNT_PRESENT = 90_000;
const PLAN_START = "2026-02-11T09:30:00.000Z";

const ref = (planId: string) => `fixsav_${planId}`;

async function cleanup() {
    await supabaseAdmin.from("document_collections").delete().like("id", `${PREFIX}%`);
    await supabaseAdmin.from("document_collections").delete().like("id", `fixsav_${PREFIX}%`);
    await supabaseAdmin.from("cooperative_members").delete().like("id", `${PREFIX}%`);
}

async function seedFixture() {
    // The member, carrying a non-default cooperativeId so we can prove the
    // backfill reads it rather than always writing "default".
    await supabaseAdmin.from("cooperative_members").insert({
        id: MEMBER,
        user_id: MEMBER,
        status: "active",
        raw_data: { userId: MEMBER, cooperativeId: COOP_ID, savingsBalance: 10_000 },
    });

    await supabaseAdmin.from("document_collections").insert([
        {
            id: PLAN_MISSING,
            collection_name: "fixed_savings_plans",
            raw_data: {
                memberId: MEMBER,
                amount: AMOUNT_MISSING,
                startDate: PLAN_START,
                durationMonths: 6,
                status: "active",
            },
        },
        {
            id: PLAN_PRESENT,
            collection_name: "fixed_savings_plans",
            raw_data: {
                memberId: MEMBER,
                amount: AMOUNT_PRESENT,
                startDate: PLAN_START,
                durationMonths: 12,
                status: "active",
            },
        },
        {
            id: PLAN_BAD_AMOUNT,
            collection_name: "fixed_savings_plans",
            raw_data: { memberId: MEMBER, amount: 0, startDate: PLAN_START, status: "active" },
        },
        {
            id: PLAN_NO_MEMBER,
            collection_name: "fixed_savings_plans",
            raw_data: { amount: 5_000, startDate: PLAN_START, status: "active" },
        },
        // PLAN_PRESENT's ledger row already exists, written the way the live
        // route writes it (no backfill markers).
        {
            id: ref(PLAN_PRESENT),
            collection_name: "cooperative_transactions",
            raw_data: {
                id: ref(PLAN_PRESENT),
                userId: MEMBER,
                cooperativeId: COOP_ID,
                type: "fixed_savings_lock",
                amount: AMOUNT_PRESENT,
                currency: "NGN",
                reference: ref(PLAN_PRESENT),
                status: "completed",
            },
        },
    ]);
}

async function ledgerRow(reference: string): Promise<Record<string, any> | null> {
    const { data } = await supabaseAdmin
        .from("document_collections")
        .select("raw_data")
        .eq("collection_name", "cooperative_transactions")
        .eq("id", reference)
        .maybeSingle();
    return (data?.raw_data as Record<string, any>) ?? null;
}

async function ledgerRowCount(): Promise<number> {
    const { data } = await supabaseAdmin
        .from("document_collections")
        .select("id")
        .eq("collection_name", "cooperative_transactions")
        .like("id", `fixsav_${PREFIX}%`);
    return (data ?? []).length;
}

function runBackfill(apply: boolean): string {
    const args = ["tsx", "scripts/backfill-fixed-savings-ledger.ts", ...(apply ? ["--apply"] : [])];
    return execFileSync("npx", args, {
        encoding: "utf-8",
        cwd: process.cwd(),
        env: process.env,
        timeout: 120_000,
    });
}

maybeDescribe("the fixed-savings ledger backfill, executed for real", () => {
    beforeAll(async () => {
        await cleanup();
        await seedFixture();
    });

    afterAll(cleanup);

    it("report mode identifies the gap and writes nothing", async () => {
        const before = await ledgerRowCount();

        const output = runBackfill(false);

        expect(output).toContain("Report only");
        expect(output).toContain(PLAN_MISSING);
        // The one that already has its row must NOT be listed as missing.
        expect(output).toContain("already have a ledger row: 1");
        expect(output).toContain("MISSING a ledger row:      1");

        expect(await ledgerRowCount()).toBe(before);
        expect(await ledgerRow(ref(PLAN_MISSING))).toBeNull();
    });

    it("reports malformed plans as skipped rather than guessing", () => {
        const output = runBackfill(false);

        expect(output).toContain("SKIPPED");
        expect(output).toContain(PLAN_BAD_AMOUNT);
        expect(output).toContain(PLAN_NO_MEMBER);
        // And they are never counted as work to do.
        expect(output).toContain("MISSING a ledger row:      1");
    });

    it("--apply writes the missing row", async () => {
        runBackfill(true);

        const row = await ledgerRow(ref(PLAN_MISSING));
        expect(row).not.toBeNull();
        expect(Number(row!.amount)).toBe(AMOUNT_MISSING);
    });

    it("the row matches what the live route writes", async () => {
        // Agreement with create-fixed-savings/route.ts. A row that grouped under
        // a different cooperative, or carried a different type, would reconcile
        // in one place and not the other.
        const row = (await ledgerRow(ref(PLAN_MISSING)))!;

        expect(row.type).toBe("fixed_savings_lock");
        expect(row.status).toBe("completed");
        expect(row.currency).toBe("NGN");
        expect(row.userId).toBe(MEMBER);
        expect(row.reference).toBe(ref(PLAN_MISSING));
        expect(row.id).toBe(ref(PLAN_MISSING));
        // Read from the member, not hardcoded to "default".
        expect(row.cooperativeId).toBe(COOP_ID);
    });

    it("dates the entry from the plan, not from the backfill run", async () => {
        // A ledger records when money moved. Stamping these with today's date
        // would make every historical lock look like it happened this afternoon
        // and break any period-based reconciliation the row exists to satisfy.
        const row = (await ledgerRow(ref(PLAN_MISSING)))!;

        expect(row.date).toBe(PLAN_START);
        // Provenance is recorded separately, and is not the date.
        expect(typeof row.backfilledAt).toBe("string");
        expect(row.backfilledAt).not.toBe(PLAN_START);
    });

    it("writes no balances — it only records a debit that already happened", async () => {
        const { data } = await supabaseAdmin
            .from("cooperative_members")
            .select("raw_data")
            .eq("id", MEMBER)
            .single();

        expect(Number((data!.raw_data as Record<string, any>).savingsBalance)).toBe(10_000);
    });

    it("leaves the pre-existing row untouched", async () => {
        // It was written by the route, so it has no backfill markers. If the
        // backfill had rewritten it, it would.
        const row = (await ledgerRow(ref(PLAN_PRESENT)))!;

        expect(row.backfilledAt).toBeUndefined();
        expect(row.backfillSource).toBeUndefined();
        expect(Number(row.amount)).toBe(AMOUNT_PRESENT);
    });

    it("running --apply again writes nothing new", async () => {
        // The deterministic id is the whole idempotency guarantee: the row's
        // existence is the check, so there is no stamp to lose and no window in
        // which a crash causes a second write.
        const countBefore = await ledgerRowCount();
        const rowBefore = await ledgerRow(ref(PLAN_MISSING));

        const output = runBackfill(true);

        expect(await ledgerRowCount()).toBe(countBefore);
        expect(output).toContain("Every plan already has its cooperative-ledger row");
        // Identical content, including the original backfilledAt — not re-stamped.
        expect(await ledgerRow(ref(PLAN_MISSING))).toEqual(rowBefore);
    });

    it("and a third run is still a no-op", async () => {
        const before = await ledgerRowCount();
        runBackfill(true);
        expect(await ledgerRowCount()).toBe(before);
    });
});
