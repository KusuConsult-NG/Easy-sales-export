/**
 * @jest-environment node
 */

/**
 *   A LEDGER THAT DISAGREED WITH THE BANK, IN THREE DIFFERENT WAYS.
 *
 *   THE OWNER: "fix the three ledger defects."
 *
 *   A Paystack reconciliation of every Academy payment ever settled turned up
 *   three separate faults in `processed_payments`, and they are the only three
 *   shapes a row and a transaction can fail to line up in:
 *
 *     THEIRS, NOT OURS   Maryam Muhammad settled ₦50,000 on 2026-04-03 against
 *                        `j559i4zu6j`. No ledger row exists. The platform took
 *                        her money and never wrote it down.
 *
 *     OURS, NOT THEIRS   `TEST_E2E_REF_123456`, ₦50,000, academy_registration —
 *                        the output of the isTestRef mock removed in cc50b3b8,
 *                        written when the e2e suite ran against production as a
 *                        real user. Paystack has never heard of it.
 *
 *     BOTH, DISAGREEING  Five references spanning February to May, every one
 *                        stamped 2026-07-06 in the ledger. Five payments on one
 *                        day is an import, not a busy Monday.
 *
 *   ── THE THIRD ONE HAS A CAUSE THE OTHER TWO DO NOT ────────────────────────
 *
 *   A ledger row has never carried a settlement date. claim_payment_once takes
 *   no such parameter, so `created_at` is the moment the INSERT ran — equal to
 *   settlement only for a webhook processed live, and equal to the import date
 *   for anything replayed. Every fulfilment path already RECEIVED Paystack's
 *   `paid_at` and wrote it to the user document and the application; only the
 *   ledger row went without. That is a code defect and it is fixed here.
 *
 *   The other two are facts about six rows in a live database. No code change
 *   removes them; what code can do is stop producing them and make them
 *   findable, which is what the reconciliation below is.
 */

import {
    ADMIN_VERIFIED_PREFIX,
    DATE_DRIFT_TOLERANCE_MS,
    dateRepairs,
    koboToNaira,
    reconcile,
    type LedgerRow,
    type PaystackTransaction,
} from "@/lib/paystack-reconciliation";
import { SETTLEMENT_DATE_KEY, settledAt, settledWithin, settlementMetadata } from "@/lib/payment-settlement";

// ─────────────────────────────────────────────────────────────────────────────
//   THE REAL RECONCILIATION. Amounts, references and dates as Paystack
//   reported them, and as the ledger had them.

const tx = (
    reference: string,
    naira: number,
    paid_at: string,
    email = "learner@example.com",
    status = "success",
): PaystackTransaction => ({
    reference,
    amount: naira * 100,
    status,
    paid_at,
    created_at: paid_at,
    customer: { email },
});

const row = (
    reference: string,
    amount: number,
    created_at: string,
    extra: LedgerRow["raw_data"] = {},
): LedgerRow => ({
    reference,
    amount,
    created_at,
    raw_data: { type: "academy_registration", status: "completed", ...extra },
});

/** The five whose ledger date is the import and whose real date is Paystack's. */
const IMPORT_STAMPED = [
    { reference: "bl9tqf24ts", naira: 100_000, real: "2026-05-05", stamped: "2026-07-06" },
    { reference: "a3croruf0m", naira: 100_000, real: "2026-02-28", stamped: "2026-07-06" },
    { reference: "y6c3who31k", naira: 50_000, real: "2026-04-04", stamped: "2026-07-06" },
    { reference: "h7ee5dkxvg", naira: 25_000, real: "2026-03-02", stamped: "2026-07-06" },
    { reference: "4z0brfa7xb", naira: 25_000, real: "2026-04-13", stamped: "2026-07-06" },
] as const;

/** Two the ledger dated correctly, so the comparison is not reporting everything. */
const AGREED = [
    { reference: "0fx2jk9au6", naira: 100_000, date: "2026-03-17" },
    { reference: "9rxmg02tb2", naira: 100_000, date: "2026-03-17" },
] as const;

function theRealCohort() {
    const transactions: PaystackTransaction[] = [
        ...IMPORT_STAMPED.map((r) => tx(r.reference, r.naira, r.real)),
        ...AGREED.map((r) => tx(r.reference, r.naira, r.date)),
        //   Theirs, not ours.
        tx("j559i4zu6j", 50_000, "2026-04-03", "maryamswtie1@gmail.com"),
        //   An abandoned attempt — three of the six admin-approved accounts have
        //   one, and it is NOT money the ledger is missing.
        tx("abandoned01", 45_000, "2026-06-01", "nessamccabe5+1@gmail.com", "abandoned"),
    ];

    const ledger: LedgerRow[] = [
        ...IMPORT_STAMPED.map((r) => row(r.reference, r.naira, r.stamped)),
        ...AGREED.map((r) => row(r.reference, r.naira, r.date)),
        //   Ours, not theirs.
        row("TEST_E2E_REF_123456", 50_000, "2026-07-10"),
        //   And a row that is MEANT to have no transaction.
        row(`${ADMIN_VERIFIED_PREFIX}app-991`, 50_000, "2026-08-02", {
            type: "academy_registration",
            status: "completed",
            source: "admin_verified",
        }),
    ];

    return reconcile(transactions, ledger);
}

describe("money Paystack has and the ledger does not", () => {
    it("finds Maryam's ₦50,000, which the platform took and never wrote down", () => {
        const result = theRealCohort();

        expect(result.missingFromLedger).toHaveLength(1);
        expect(result.missingFromLedger[0]).toEqual({
            reference: "j559i4zu6j",
            amount: 50_000,
            settledAt: "2026-04-03",
            email: "maryamswtie1@gmail.com",
        });
    });

    it("and does NOT accuse an abandoned checkout of being unrecorded money", () => {
        //   Three of the six admin-approved accounts have exactly this and
        //   nothing else at Paystack. Reporting them would be an accusation
        //   about a payment nobody made.
        const result = theRealCohort();

        expect(result.missingFromLedger.map((m) => m.reference)).not.toContain("abandoned01");
        expect(result.counts.paystack).toBe(IMPORT_STAMPED.length + AGREED.length + 1);
    });
});

describe("a row Paystack has never heard of", () => {
    it("finds the fabricated TEST_E2E_REF_123456", () => {
        const result = theRealCohort();

        expect(result.missingFromPaystack).toHaveLength(1);
        expect(result.missingFromPaystack[0]).toMatchObject({
            reference: "TEST_E2E_REF_123456",
            amount: 50_000,
            type: "academy_registration",
            adminVerified: false,
        });
    });

    it("and keeps an admin-verified row out of that bucket", () => {
        //   Nobody charged a card, so Paystack has nothing and never will.
        //   Reporting it every run would bury the one row that is fabricated.
        const result = theRealCohort();

        expect(result.adminVerified.map((a) => a.reference)).toEqual([`${ADMIN_VERIFIED_PREFIX}app-991`]);
        expect(result.missingFromPaystack.map((m) => m.reference))
            .not.toContain(`${ADMIN_VERIFIED_PREFIX}app-991`);
    });
});

describe("rows in both, disagreeing about when", () => {
    it("finds all five import-stamped dates and none of the correct ones", () => {
        const result = theRealCohort();

        expect(result.dateDisagreements.map((d) => d.reference).sort())
            .toEqual(IMPORT_STAMPED.map((r) => r.reference).sort());

        for (const agreed of AGREED) {
            expect(result.dateDisagreements.map((d) => d.reference)).not.toContain(agreed.reference);
        }
    });

    it("reports the drift, worst first, and a3croruf0m is the worst", () => {
        //   2026-02-28 recorded as 2026-07-06 — over four months out.
        const result = theRealCohort();

        expect(result.dateDisagreements[0].reference).toBe("a3croruf0m");
        expect(result.dateDisagreements[0].driftDays).toBeGreaterThan(120);
        expect(result.dateDisagreements[0].paystackDate).toContain("2026-02-28");
    });

    it("tolerates a day, so a webhook processed just after midnight is not drift", () => {
        const result = reconcile(
            [tx("sameish", 1000, "2026-03-01T23:50:00Z")],
            [row("sameish", 1000, "2026-03-02T00:10:00Z")],
        );

        expect(result.dateDisagreements).toEqual([]);
        expect(DATE_DRIFT_TOLERANCE_MS).toBe(86_400_000);
    });

    it("and the only automated repair is the date, nothing else", () => {
        const repairs = dateRepairs(theRealCohort());

        expect(repairs).toHaveLength(IMPORT_STAMPED.length);
        for (const r of repairs) {
            expect(Object.keys(r).sort()).toEqual(["paidAt", "reference"]);
        }
    });
});

describe("the ledger row now carries when the money moved", () => {
    it("prefers the processor's date over the write date", () => {
        //   THE ORDER IS THE WHOLE FIX. Reading created_at first would keep the
        //   five rows on their import stamp for ever, even once paidAt is set.
        const when = settledAt({
            created_at: "2026-07-06T00:00:00Z",
            raw_data: { paidAt: "2026-02-28T09:00:00Z" },
        });

        expect(when?.toISOString()).toBe("2026-02-28T09:00:00.000Z");
    });

    it("falls back to the write date for a row written before this existed", () => {
        const when = settledAt({ created_at: "2026-07-06T00:00:00Z" });

        expect(when?.toISOString()).toBe("2026-07-06T00:00:00.000Z");
    });

    it("reads a Firestore-style timestamp, which is what the compat layer returns", () => {
        const when = settledAt({ createdAt: { toDate: () => new Date("2026-05-05T12:00:00Z") } });

        expect(when?.toISOString()).toBe("2026-05-05T12:00:00.000Z");
    });

    it("and answers null rather than today when there is no date at all", () => {
        expect(settledAt({})).toBeNull();
        expect(settledAt(null)).toBeNull();
        expect(settledAt({ created_at: "not a date" })).toBeNull();
        expect(settledAt({ createdAt: { toDate: () => { throw new Error("boom"); } } })).toBeNull();
    });

    it("so an undated row is left OUT of a monthly bucket, not silently counted", () => {
        const from = new Date("2026-03-01T00:00:00Z");
        const to = new Date("2026-04-01T00:00:00Z");

        expect(settledWithin({ raw_data: { paidAt: "2026-03-17T00:00:00Z" } }, from, to)).toBe(true);
        expect(settledWithin({ raw_data: { paidAt: "2026-04-13T00:00:00Z" } }, from, to)).toBe(false);
        expect(settledWithin({}, from, to)).toBe(false);
    });
});

describe("what a new ledger row records", () => {
    it("carries the settlement date under the key the readers look for", () => {
        const meta = settlementMetadata(new Date("2026-04-03T10:00:00Z"));

        expect(meta).toEqual({ [SETTLEMENT_DATE_KEY]: "2026-04-03T10:00:00.000Z" });
        expect(SETTLEMENT_DATE_KEY).toBe("paidAt");
    });

    it("accepts the shapes the fulfilment paths actually hold", () => {
        //   The webhook has a Date; Paystack's verify response has an ISO string.
        const iso = "2026-04-03T10:00:00.000Z";

        expect(settlementMetadata(iso)).toEqual({ paidAt: iso });
        expect(settlementMetadata(new Date(iso))).toEqual({ paidAt: iso });
        expect(settlementMetadata(Date.parse(iso))).toEqual({ paidAt: iso });
    });

    it("writes NO key at all for a date it cannot read", () => {
        //   Not `{ paidAt: null }`. A key present-but-null reads as the epoch to
        //   anything that coerces it, which is a worse lie than having no date.
        for (const unusable of [undefined, null, "", "   ", "whenever", Number.NaN, new Date("nonsense")]) {
            expect(settlementMetadata(unusable)).toEqual({});
        }
    });
});

describe("the counts, so a clean run is distinguishable from a broken one", () => {
    it("matches everything when the two sides agree", () => {
        const clean = reconcile(
            [tx("aaa", 1000, "2026-03-01"), tx("bbb", 2000, "2026-03-02")],
            [row("aaa", 1000, "2026-03-01"), row("bbb", 2000, "2026-03-02")],
        );

        expect(clean.missingFromLedger).toEqual([]);
        expect(clean.missingFromPaystack).toEqual([]);
        expect(clean.dateDisagreements).toEqual([]);
        expect(clean.counts).toEqual({ paystack: 2, ledger: 2, matched: 2 });
    });

    it("matches on the reference regardless of case or stray space", () => {
        const result = reconcile(
            [tx("AbC123", 1000, "2026-03-01")],
            [row("  abc123 ", 1000, "2026-03-01")],
        );

        expect(result.counts.matched).toBe(1);
        expect(result.missingFromLedger).toEqual([]);
        expect(result.missingFromPaystack).toEqual([]);
    });

    it("converts Paystack's kobo to the naira the ledger stores", () => {
        expect(koboToNaira(5_000_000)).toBe(50_000);
        expect(koboToNaira("2500000")).toBe(25_000);
        expect(koboToNaira(undefined)).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//   AND THE WIRING. Everything above tests two pure modules, all of which
//   passes just as happily when no fulfilment path passes a date and the
//   revenue reader still buckets on created_at — which is the defect intact.

import { readFileSync } from "fs";
import { join } from "path";

const LEDGER = "src/lib/wallet-ledger.ts";
const SERVICE = "src/infrastructure/payments/service.ts";
const REPORTS = "src/app/actions/academy/_ac_admin_reports.ts";
const ADMIN_REVIEW = "src/app/actions/academy/_ac_admin_review.ts";

/** Comments AND imports stripped — an import alone must not satisfy a rule. */
function codeBody(rel: string): string {
    return readFileSync(join(process.cwd(), rel), "utf-8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .filter((l) => !l.trim().startsWith("//") && !/^\s*import\b/.test(l))
        .map((l) => l.replace(/\s\/\/.*$/, ""))
        .join("\n");
}

describe("the settlement date actually reaches the row", () => {
    it("claimPaymentOnce takes a paidAt and folds it into raw_data", () => {
        const src = codeBody(LEDGER);

        expect(src).toContain("paidAt");
        expect(src).toContain("settlementMetadata(paidAt)");
    });

    it("and every webhook fulfilment hands its own paidAt over", () => {
        //   Each process*() already had `paidAt?: Date` and wrote it to the user
        //   document and the application. The ledger row was the one place it
        //   never reached.
        const src = codeBody(SERVICE);

        const calls = src.split("claimPaymentOnce({").length - 1;
        const withDate = src.split(/\n\s*paidAt\n/).length - 1;

        expect(calls).toBeGreaterThanOrEqual(10);
        expect(withDate).toBe(calls);
    });

    it("the revenue reader buckets on settlement, not on the write date", () => {
        const src = codeBody(REPORTS);

        expect(src).toContain("settledAt(p)");
        expect(src).not.toContain("p.createdAt?.toDate");
    });
});

describe("money an admin verifies reaches the ledger too", () => {
    it("the admin-verified path writes a row, which it never did", () => {
        const src = codeBody(ADMIN_REVIEW);

        expect(src).toContain("claimPaymentOnce({");
        expect(src).toContain("admin-verified:");
    });

    it("but only when nothing is there already, so nothing double-counts", () => {
        //   If the webhook also fulfilled this learner, a second row doubles the
        //   money in every total. The admin row is a fallback, never an addition.
        const src = codeBody(ADMIN_REVIEW);

        expect(src).toContain("existing.empty");
        expect(src).toContain(COLLECTIONS_PROCESSED);

        //   ACROSS EVERY PROFILE THE PERSON OWNS. A bare
        //   `where("userId", "==", …)` misses a split account's other row, so
        //   the guard would find nothing and write the duplicate it exists to
        //   prevent. The academy sweep catches this too; it is asserted here as
        //   well because it is this guard's whole correctness, not a
        //   module-wide style rule.
        expect(src).toContain("filterByOwner(");
        expect(src).toContain("ownedProfileIdsFor(applicantUserId)");
        expect(src).not.toContain('.where("userId", "==", applicantUserId)');
    });

    it("and only for a status that means money actually arrived", () => {
        const src = codeBody(ADMIN_REVIEW);

        expect(src).toContain("isSettledAdminPayment(paymentStatus)");
        //   The same rule stamps paymentVerifiedAt/By, so the row and the stamps
        //   cannot disagree about whether this was settled.
        expect(src.split("isSettledAdminPayment(paymentStatus)").length - 1).toBeGreaterThanOrEqual(3);
    });
});

/** Spelled once so the assertion above cannot pass on a different collection. */
const COLLECTIONS_PROCESSED = "COLLECTIONS.PROCESSED_PAYMENTS";
