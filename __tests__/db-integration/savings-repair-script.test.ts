/**
 * The savings-balance repair, actually run.
 *
 * WHY THIS EXISTS
 * ---------------
 * scripts/repair-savings-balance.ts corrects cooperative members whose
 * savingsBalance was never credited because their contribution was confirmed by
 * the browser redirect rather than the Paystack webhook. It was written, reviewed
 * and never executed anywhere. An unrun repair script is an untested one, and
 * this one moves money: it calls apply_increments against cooperative_members.
 *
 * The pure planning functions in src/lib/savings-repair-plan.ts have unit tests.
 * Those cannot catch the things that actually go wrong with a script like this —
 * whether the RPC it calls exists, whether p_id matches the row it means to
 * credit, whether savingsBalance lands in raw_data where the application reads
 * it, and above all whether running it TWICE double-credits.
 *
 * So this executes the real script as a subprocess, against the real local
 * Postgres, and inspects the rows afterwards.
 *
 * WHAT IS ASSERTED
 * ----------------
 *   1. report mode writes NOTHING
 *   2. --apply credits savingsBalance by exactly the repairable amount
 *   3. a STRANDED payment — claimed but with no ledger row — is NOT credited
 *   4. --apply a second time changes nothing (the idempotency guarantee)
 *
 * (3) is the one worth having. The script deliberately refuses to repair a
 * payment whose fulfilment never completed, because crediting savingsBalance
 * there would leave totalContributions short and convert one inconsistency into
 * another. Nothing but a real run proves it actually declines.
 */

import { supabaseAdmin } from "@/lib/supabase";
import { execFileSync } from "child_process";

declare const maybeDescribe: jest.Describe;

const PREFIX = "jest-repair-";
const MEMBER = `${PREFIX}member-1`;
const REF_REPAIRABLE = `${PREFIX}ref-with-ledger`;
const REF_STRANDED = `${PREFIX}ref-no-ledger`;

const STARTING_BALANCE = 1000;
const REPAIRABLE_AMOUNT = 5000;
const STRANDED_AMOUNT = 7000;

async function cleanup() {
    await supabaseAdmin.from("processed_payments").delete().like("id", `${PREFIX}%`);
    await supabaseAdmin.from("transactions").delete().like("id", `${PREFIX}%`);
    await supabaseAdmin.from("cooperative_members").delete().like("id", `${PREFIX}%`);
}

/**
 * The member, one repairable contribution, and one stranded one.
 *
 * The member row's `id` is the user id, because that is what the script passes
 * as apply_increments' p_id — a mismatch there would credit nothing and is
 * exactly the kind of thing only a real run catches.
 */
async function seedFixture() {
    await supabaseAdmin.from("cooperative_members").insert({
        id: MEMBER,
        user_id: MEMBER,
        status: "active",
        raw_data: {
            userId: MEMBER,
            savingsBalance: STARTING_BALANCE,
            // Short by both contributions: this is the state the defect left.
            totalContributions: STARTING_BALANCE + REPAIRABLE_AMOUNT + STRANDED_AMOUNT,
        },
    });

    const base = {
        type: "cooperative_contribution",
        source: "client_verify",
        userId: MEMBER,
        processedAt: new Date().toISOString(),
    };

    await supabaseAdmin.from("processed_payments").insert([
        {
            id: REF_REPAIRABLE,
            user_id: MEMBER,
            amount: REPAIRABLE_AMOUNT,
            reference: REF_REPAIRABLE,
            raw_data: { ...base, amount: REPAIRABLE_AMOUNT },
        },
        {
            id: REF_STRANDED,
            user_id: MEMBER,
            amount: STRANDED_AMOUNT,
            reference: REF_STRANDED,
            raw_data: { ...base, amount: STRANDED_AMOUNT },
        },
    ]);

    // The unified-ledger row exists ONLY for the repairable one. Its presence is
    // how the script knows the totalContributions credit ran, so its absence is
    // what makes the other payment stranded.
    await supabaseAdmin.from("transactions").insert({
        id: REF_REPAIRABLE,
        user_id: MEMBER,
        amount: REPAIRABLE_AMOUNT,
        type: "cooperative_contribution",
        status: "completed",
        raw_data: { userId: MEMBER, amount: REPAIRABLE_AMOUNT },
    });
}

async function savingsBalance(): Promise<number> {
    const { data, error } = await supabaseAdmin
        .from("cooperative_members")
        .select("raw_data")
        .eq("id", MEMBER)
        .single();
    if (error) throw new Error(`reading member: ${error.message}`);
    return Number((data!.raw_data as Record<string, unknown>).savingsBalance);
}

async function repairStamp(reference: string): Promise<string | undefined> {
    const { data, error } = await supabaseAdmin
        .from("processed_payments")
        .select("raw_data")
        .eq("id", reference)
        .single();
    if (error) throw new Error(`reading payment ${reference}: ${error.message}`);
    return (data!.raw_data as Record<string, string>).savingsBalanceRepairedAt;
}

/** Run the real script, returning its stdout. */
function runRepair(apply: boolean): string {
    const args = ["tsx", "scripts/repair-savings-balance.ts", ...(apply ? ["--apply"] : [])];
    return execFileSync("npx", args, {
        encoding: "utf-8",
        cwd: process.cwd(),
        // The script loads .env.development.local itself; inherit the rest.
        env: process.env,
        timeout: 120_000,
    });
}

maybeDescribe("the savings-balance repair script, executed for real", () => {
    beforeAll(async () => {
        await cleanup();
        await seedFixture();
    });

    afterAll(cleanup);

    it("report mode finds the work and writes nothing", async () => {
        const before = await savingsBalance();

        const output = runRepair(false);

        // It saw both, and classified them differently.
        expect(output).toContain("1 have a ledger row");
        expect(output).toContain("1 have none");
        expect(output).toContain("Report only");
        expect(output).toContain(REF_STRANDED);

        // The whole point of report mode.
        expect(await savingsBalance()).toBe(before);
        expect(await repairStamp(REF_REPAIRABLE)).toBeUndefined();
    });

    it("--apply credits exactly the repairable amount", async () => {
        runRepair(true);

        // 1000 + 5000. NOT 1000 + 5000 + 7000: the stranded payment is excluded.
        expect(await savingsBalance()).toBe(STARTING_BALANCE + REPAIRABLE_AMOUNT);
    });

    it("stamps the repaired payment, so a later run can tell", async () => {
        const stamp = await repairStamp(REF_REPAIRABLE);

        expect(typeof stamp).toBe("string");
        expect(Number.isNaN(Date.parse(stamp!))) .toBe(false);
    });

    it("leaves the stranded payment untouched and unstamped", async () => {
        // It needs a person: crediting savingsBalance when totalContributions was
        // never credited either would turn one inconsistency into a different one.
        expect(await repairStamp(REF_STRANDED)).toBeUndefined();
    });

    it("running --apply again does NOT double-credit", async () => {
        // THE test. The stamp checked first in parseAffectedRow is the entire
        // idempotency guarantee; without it every member is credited twice.
        const afterFirstApply = await savingsBalance();

        const output = runRepair(true);

        expect(await savingsBalance()).toBe(afterFirstApply);
        // Nothing left to do, because the only repairable row is stamped and the
        // stranded one is never eligible.
        expect(output).toMatch(/No unrepaired client-verified contributions|0 have a ledger row/);
    });

    it("and a third run is still a no-op", async () => {
        const before = await savingsBalance();
        runRepair(true);
        expect(await savingsBalance()).toBe(before);
    });
});
