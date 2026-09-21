/**
 * @jest-environment node
 */

/**
 *   THE PRICE WENT UP UNDER PEOPLE WHO HAD ALREADY PAID.
 *
 *   THE OWNER: "keep the discount and ensure that this change in price doesn't
 *   affect the ones who had paid before (25k, 50k and 100k) but ensure that all
 *   those paying now are paying the new prices."
 *
 *   ── WHY THIS WAS ALREADY BROKEN, BEFORE ANY PRICE CHANGED ─────────────────
 *
 *   checkAcademyPayment compared what a learner paid against
 *   ACADEMY_CONFIG.plans[plan].fee — TODAY'S figure — with no notion of when
 *   the money moved. The current list is ₦45,000 / ₦90,000 / ₦270,000 and the
 *   Paystack reconciliation of every Academy payment ever settled found
 *   ₦25,000, ₦50,000 and ₦100,000. So the comparison was already answering
 *   "underpaid" for real, settled, fully reconciled registrations — a ₦25,000
 *   Foundation learner measured against ₦45,000 is ₦20,000 short of a price
 *   that did not exist when they paid.
 *
 *   It has not bitten yet only because fulfilment ran months ago. It bites the
 *   moment anything re-verifies an old reference: a refreshed callback URL, a
 *   retried webhook, a reconciliation pass. Both fulfilment paths throw or
 *   refuse on that verdict.
 *
 *   ── WHAT THE FIX IS NOT ───────────────────────────────────────────────────
 *
 *   It is NOT a price change. ACADEMY_CONFIG is untouched and the discount
 *   stays — the owner asked for both, and the last test in this file pins it,
 *   because "keep the discount" is the kind of instruction a later tidy-up
 *   silently reverses.
 *
 *   ── WHY THE TEN REAL PAYMENTS ARE IN HERE BY NAME ─────────────────────────
 *
 *   Every case below is an amount and a date that a human actually paid,
 *   reconciled against api.paystack.co. A rule about who keeps their place is
 *   worth testing against the people it decides for, not against invented
 *   numbers that happen to suit it.
 */

import { readFileSync } from "fs";
import { join } from "path";

import {
    ACADEMY_PRICES_EFFECTIVE_FROM,
    LEGACY_ACADEMY_PLAN_FEES,
    academyPlanFee,
    academyPlanFeeOn,
    checkAcademyPayment,
    isLegacyAcademyPayment,
} from "@/lib/academy-plan";
import { ACADEMY_CONFIG } from "@/lib/constants";

// ─────────────────────────────────────────────────────────────────────────────
//   THE PEOPLE. Amounts and settlement dates from the Paystack reconciliation.

const SETTLED_BEFORE_THE_RISE = [
    { who: "Samuel Olawunmi", amount: 100_000, plan: "elite", paidAt: "2026-02-28" },
    { who: "Obi Petrus Chisomaga", amount: 25_000, plan: "foundation", paidAt: "2026-03-02" },
    { who: "Ibrahim Abdulkareem", amount: 100_000, plan: "elite", paidAt: "2026-03-17" },
    { who: "Ogungbuyi Ajoke Rhoda", amount: 100_000, plan: "elite", paidAt: "2026-03-17" },
    { who: "Aminat Ajibola", amount: 100_000, plan: "elite", paidAt: "2026-03-25" },
    { who: "Maryam Muhammad", amount: 50_000, plan: "standard", paidAt: "2026-04-03" },
    { who: "Sanusi Ruth Adenike", amount: 50_000, plan: "standard", paidAt: "2026-04-04" },
    { who: "Ipaye Oladipo Michael", amount: 25_000, plan: "foundation", paidAt: "2026-04-13" },
    { who: "Adedayo Oluwo", amount: 100_000, plan: "elite", paidAt: "2026-05-05" },
] as const;

/** The first payment at the current list, and the only one so far. */
const SETTLED_AFTER_THE_RISE = {
    who: "Fatima Ibrahim Almustapha",
    amount: 90_000,
    plan: "standard",
    paidAt: "2026-06-06",
} as const;

describe("a price rise must not reach backwards", () => {
    it.each(SETTLED_BEFORE_THE_RISE)(
        "$who — ₦$amount for $plan on $paidAt is still settled",
        ({ amount, plan, paidAt }) => {
            const verdict = checkAcademyPayment(amount, plan, paidAt);

            expect(verdict.ok).toBe(true);
            expect(verdict).toMatchObject({ grandfathered: true });
        },
    );

    it("and every one of them would be refused without the settlement date", () => {
        //   The positive control for the whole file. If this passes as well,
        //   the dated rule is doing nothing and the tests above prove nothing.
        const refused = SETTLED_BEFORE_THE_RISE.filter(
            ({ amount, plan }) => !checkAcademyPayment(amount, plan).ok,
        );

        //   ₦100,000 clears today's Standard fee but not today's Elite fee, and
        //   ₦25,000/₦50,000 clear neither of theirs — so it is not all nine.
        //   What matters is that it is not ZERO, which is what it would be if
        //   the old and new lists happened to agree.
        expect(refused.length).toBeGreaterThan(0);
        expect(refused.map((r) => r.who)).toContain("Obi Petrus Chisomaga");
    });

    it("Fatima paid the current price in June and is not grandfathered", () => {
        const verdict = checkAcademyPayment(
            SETTLED_AFTER_THE_RISE.amount,
            SETTLED_AFTER_THE_RISE.plan,
            SETTLED_AFTER_THE_RISE.paidAt,
        );

        expect(verdict.ok).toBe(true);
        expect(verdict).toMatchObject({ grandfathered: false, fee: ACADEMY_CONFIG.plans.standard.fee });
    });
});

describe("but everybody paying now pays the new price", () => {
    it.each(["foundation", "standard", "elite"] as const)(
        "a %s payment at the OLD price today is refused",
        (plan) => {
            const verdict = checkAcademyPayment(LEGACY_ACADEMY_PLAN_FEES[plan], plan, "2026-09-21");

            expect(verdict.ok).toBe(false);
            expect(verdict).toMatchObject({
                reason: "underpaid",
                fee: ACADEMY_CONFIG.plans[plan].fee,
                grandfathered: false,
            });
        },
    );

    it("charges the current price at checkout, with no date in the question", () => {
        //   academyPlanFee is what the initiate path multiplies into kobo. It
        //   must never answer the legacy figure, or a new learner is charged
        //   ₦25,000 for a ₦45,000 plan.
        expect(academyPlanFee("foundation")).toBe(ACADEMY_CONFIG.plans.foundation.fee);
        expect(academyPlanFee("standard")).toBe(ACADEMY_CONFIG.plans.standard.fee);
        expect(academyPlanFee("elite")).toBe(ACADEMY_CONFIG.plans.elite.fee);

        expect(academyPlanFee("foundation")).not.toBe(LEGACY_ACADEMY_PLAN_FEES.foundation);
    });
});

describe("an unproven date is never a discount", () => {
    it.each([
        ["omitted", undefined],
        ["null", null],
        ["empty string", ""],
        ["whitespace", "   "],
        ["not a date", "sometime last year"],
        ["NaN", Number.NaN],
        ["an invalid Date", new Date("nonsense")],
    ])("%s falls through to today's price", (_label, paidAt) => {
        expect(isLegacyAcademyPayment(paidAt)).toBe(false);
        expect(academyPlanFeeOn("foundation", paidAt)).toBe(ACADEMY_CONFIG.plans.foundation.fee);

        //   And the consequence: the old price is not enough.
        expect(checkAcademyPayment(LEGACY_ACADEMY_PLAN_FEES.foundation, "foundation", paidAt).ok)
            .toBe(false);
    });

    it("accepts the shapes a real caller actually passes", () => {
        //   The webhook holds a Date; the interactive path holds Paystack's
        //   ISO-8601 `paid_at` string. Both must reach the same verdict, or the
        //   two paths that race each other disagree about the same payment.
        const asString = "2026-03-02T10:15:00.000Z";
        const asDate = new Date(asString);

        expect(isLegacyAcademyPayment(asString)).toBe(true);
        expect(isLegacyAcademyPayment(asDate)).toBe(true);
        expect(isLegacyAcademyPayment(asDate.getTime())).toBe(true);

        expect(checkAcademyPayment(25_000, "foundation", asString).ok).toBe(true);
        expect(checkAcademyPayment(25_000, "foundation", asDate).ok).toBe(true);
    });
});

describe("the boundary", () => {
    it("the effective instant itself is the NEW price, not the old one", () => {
        //   `<`, not `<=`. A payment stamped at the exact moment the list
        //   changed belongs to the new list.
        expect(isLegacyAcademyPayment(new Date(ACADEMY_PRICES_EFFECTIVE_FROM))).toBe(false);
        expect(isLegacyAcademyPayment(new Date(ACADEMY_PRICES_EFFECTIVE_FROM - 1))).toBe(true);
    });

    it("sits in the gap between the last old payment and the first new one", () => {
        //   This is what makes the chosen date defensible rather than arbitrary:
        //   nothing settled between them, so every real payment is classified
        //   the same way for any cutoff in the gap.
        const lastOld = Date.parse("2026-05-05T23:59:59Z");
        const firstNew = Date.parse("2026-06-06T00:00:00Z");

        expect(ACADEMY_PRICES_EFFECTIVE_FROM).toBeGreaterThan(lastOld);
        expect(ACADEMY_PRICES_EFFECTIVE_FROM).toBeLessThanOrEqual(firstNew);
    });
});

describe("the owner asked for the discount to stay", () => {
    it.each(["foundation", "standard", "elite"] as const)(
        "%s still shows a fee below a struck-through original",
        (plan) => {
            const { fee, originalFee } = ACADEMY_CONFIG.plans[plan];

            expect(typeof fee).toBe("number");
            expect(typeof originalFee).toBe("number");
            expect(fee).toBeLessThan(originalFee);
        },
    );

    it("and the current prices are untouched by this change", () => {
        //   Pinned literally. The grandfather clause is not a licence to adjust
        //   the live price list, and a diff that changes these should have to
        //   change this line too.
        expect(ACADEMY_CONFIG.plans.foundation.fee).toBe(45_000);
        expect(ACADEMY_CONFIG.plans.standard.fee).toBe(90_000);
        expect(ACADEMY_CONFIG.plans.elite.fee).toBe(270_000);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//   AND THE WIRING, WHICH THE RULE ABOVE CANNOT SEE.
//
//   Everything above tests lib/academy-plan in isolation, so all of it passes
//   just as happily when a fulfilment path forgets to pass the date — and a
//   path that forgets judges a 2026-03 payment at 2026-09 prices, which is the
//   whole defect back again. Both call sites are server code needing a Paystack
//   response, a session and a database to invoke, so this reads them, the way
//   academy-payment-amount.test.ts already pins the same two call sites.
//
//   Comments are stripped first. A rule that a comment can satisfy is not a
//   rule — the sentence "we pass paidAt here" would otherwise pass this test.

const INTERACTIVE = "src/app/actions/academy/_payment.ts";
const WEBHOOK = "src/infrastructure/payments/service.ts";

function codeOnly(rel: string): string {
    return readFileSync(join(process.cwd(), rel), "utf-8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .filter((l) => !l.trim().startsWith("//"))
        .map((l) => l.replace(/\s\/\/.*$/, ""))
        .join("\n");
}

/** The arguments of the first checkAcademyPayment call, balanced-paren aware. */
function checkCallArgs(rel: string): string[] {
    const src = codeOnly(rel);
    const at = src.indexOf("checkAcademyPayment(");
    expect(at).toBeGreaterThan(-1);

    let depth = 0;
    let end = -1;
    const from = at + "checkAcademyPayment".length;
    for (let i = from; i < src.length; i++) {
        if (src[i] === "(") depth++;
        else if (src[i] === ")") {
            depth--;
            if (depth === 0) { end = i; break; }
        }
    }
    expect(end).toBeGreaterThan(from);

    return src.slice(from + 1, end).split(",").map((a) => a.trim()).filter(Boolean);
}

describe("both fulfilment paths hand over the settlement date", () => {
    it("the webhook passes its own paidAt parameter", () => {
        const args = checkCallArgs(WEBHOOK);

        expect(args).toHaveLength(3);
        expect(args[2]).toBe("paidAt");
    });

    it("the interactive path passes Paystack's paid_at", () => {
        const args = checkCallArgs(INTERACTIVE);

        expect(args).toHaveLength(3);
        expect(args[2]).toContain("paid_at");
    });

    it("and the webhook's paidAt is a real parameter, not an undeclared name", () => {
        //   `paidAt` reaching the check means nothing if the signature dropped
        //   it — it would be a TypeScript error, but this file is the one that
        //   would have to notice.
        expect(codeOnly(WEBHOOK)).toContain("processAcademyRegistration(reference: string, amount: number, userId: string, plan: string, paidAt?: Date)");
    });
});
