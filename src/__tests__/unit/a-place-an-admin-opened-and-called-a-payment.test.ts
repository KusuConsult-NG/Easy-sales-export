/**
 * @jest-environment node
 */

/**
 *   A PLACE AN ADMIN OPENED, RECORDED AS A PAYMENT.
 *
 *   THE OWNER: "fix the admin approval writing paymentStatus completed without
 *   a payment."
 *
 *   Two admin doors wrote `paymentStatus: "completed"` for a place nobody paid
 *   for. Neither function's body mentions `amount`, `reference`,
 *   `processed_payments` or `verifyPaystackPayment` — approval simply WAS
 *   payment. A Paystack reconciliation of the whole cohort found six accounts
 *   marked completed with no transaction behind them, three of whose only trace
 *   at Paystack is an abandoned checkout.
 *
 *   A third door, _ac_admin_review's updateAcademyApplicationPaymentAction, has
 *   always taken the amount as an argument and written `paymentVerifiedBy` and
 *   `paymentVerifiedAt` beside the status. The shape existed; the two doors
 *   below skipped it.
 *
 *   ── THE RISK THIS FILE IS MOSTLY ABOUT ────────────────────────────────────
 *
 *   Changing the stored value is the easy half. The dangerous half is that five
 *   separate readers ask "has this learner paid?" and they did not agree with
 *   each other — one of them is the module gate. A reader left behind does not
 *   fail loudly; it quietly treats a learner an admin deliberately let in as
 *   unpaid, and either locks them out or sends them a demand for money.
 *
 *   So most of what follows is not about the write. It is one case per reader.
 */

import { readFileSync } from "fs";
import { join } from "path";

import {
    ACADEMY_GRANTED_STATUSES,
    ACADEMY_PAID_STATUSES,
    ADMIN_GRANT_SOURCE,
    academyGrantFields,
    isAcademyEntitled,
    isAcademyGranted,
    isAcademyPaid,
} from "@/lib/academy-entitlement";

const ADMIN = "src/app/actions/admin/_academy.ts";
const GATE = "src/lib/module-access-check.ts";
const STATUS_ACTION = "src/app/actions/academy/_payment.ts";
const SMS = "src/app/actions/sms-broadcast.ts";
const IN_APP = "src/app/actions/in-app-broadcast.ts";
const ADMIN_SCREEN = "src/app/admin/academy/applications/page.tsx";
const METRICS = "src/services/userMetrics.service.ts";

/**
 * Source with comments AND import lines stripped.
 *
 *   THE IMPORT LINE IS WHY THIS EXISTS. The reader assertions below first read
 *   plain source and checked for "isAcademyEntitled" — which the import
 *   statement satisfies on its own. Reverting a reader's actual call back to
 *   `=== "completed"` left the import in place, so the mutant SURVIVED and the
 *   test claimed a reader was wired when it was not. Found by mutating exactly
 *   that, which is the point of mutating one reader rather than trusting six
 *   greps.
 */
function codeBody(rel: string): string {
    return codeOnly(rel)
        .split("\n")
        .filter((l) => !/^\s*import\b/.test(l))
        .join("\n");
}

/** Source with comments stripped — a rule a comment can satisfy is not a rule. */
function codeOnly(rel: string): string {
    return readFileSync(join(process.cwd(), rel), "utf-8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .filter((l) => !l.trim().startsWith("//"))
        .map((l) => l.replace(/\s\/\/.*$/, ""))
        .join("\n");
}

describe("the two questions are no longer one question", () => {
    it("separates money from a grant", () => {
        expect(isAcademyPaid("completed")).toBe(true);
        expect(isAcademyPaid("paid")).toBe(true);

        expect(isAcademyPaid("waived")).toBe(false);
        expect(isAcademyGranted("waived")).toBe(true);
        expect(isAcademyGranted("completed")).toBe(false);
    });

    it("but both open the module", () => {
        expect(isAcademyEntitled("completed")).toBe(true);
        expect(isAcademyEntitled("waived")).toBe(true);
    });

    it("and neither opens it for somebody who has done nothing", () => {
        for (const nothing of ["pending", "unpaid", "failed", "abandoned", "", null, undefined, 0]) {
            expect(isAcademyEntitled(nothing)).toBe(false);
        }
    });

    it("reads the spellings a JSONB round-trip and a careless caller produce", () => {
        expect(isAcademyEntitled("  Completed ")).toBe(true);
        expect(isAcademyEntitled("WAIVED")).toBe(true);
    });

    it("keeps `successful`, which two readers accepted before this module", () => {
        //   Nothing writes it — pinned below — but sms-broadcast and
        //   in-app-broadcast both accepted it. Unifying on the narrower set
        //   would have REMOVED an acceptance they relied on, and the cost of
        //   being wrong in that direction is a paid learner refused.
        expect(isAcademyPaid("successful")).toBe(true);
    });

    it("and nothing in the codebase actually writes `successful`", () => {
        for (const rel of [ADMIN, STATUS_ACTION, "src/infrastructure/payments/service.ts"]) {
            expect(codeOnly(rel)).not.toContain('paymentStatus: "successful"');
        }
    });
});

describe("what an admin grant records", () => {
    const grant = academyGrantFields("admin-7", "NOW");

    it("is a grant, not a completed payment", () => {
        expect(grant.paymentStatus).toBe("waived");
        expect(grant.paymentStatus).not.toBe("completed");
        expect(ACADEMY_GRANTED_STATUSES).toContain(grant.paymentStatus);
        expect(ACADEMY_PAID_STATUSES).not.toContain(grant.paymentStatus as never);
    });

    it("names who decided and when — the shape _ac_admin_review already had", () => {
        expect(grant.grantedBy).toBe("admin-7");
        expect(grant.grantedAt).toBe("NOW");
        expect(grant.entitlementSource).toBe(ADMIN_GRANT_SOURCE);
    });

    it("states that nobody verified a payment, rather than leaving it absent", () => {
        //   Explicitly null so a stale value from an earlier write cannot
        //   survive and make a grant look like a verified transfer.
        expect(grant).toHaveProperty("paymentVerifiedBy", null);
        expect(grant).toHaveProperty("paymentVerifiedAt", null);
    });

    it("carries a zero amount, so it adds nothing to revenue", () => {
        //   userMetrics sums `Number(app.paymentAmount) || 0` over everything it
        //   counts. An explicit 0 says "no money"; an absent field says "nobody
        //   has written this yet".
        expect(grant.paymentAmount).toBe(0);
        expect(Number(grant.paymentAmount) || 0).toBe(0);
    });
});

describe("neither admin door claims a payment any more", () => {
    it("_academy.ts no longer writes paymentStatus completed anywhere", () => {
        expect(codeOnly(ADMIN)).not.toContain('paymentStatus": "completed"');
        expect(codeOnly(ADMIN)).not.toContain('paymentStatus: "completed"');
    });

    it("and both doors write the shared grant fields instead", () => {
        const src = codeOnly(ADMIN);

        //   Two user-document writes (approval, manual enrolment) and two
        //   application writes (existing applications, the created one).
        const dotted = src.split("academyGrantRegistration(").length - 1;
        const flat = src.split("academyGrantFields(").length - 1;

        expect(dotted).toBeGreaterThanOrEqual(2);
        expect(flat).toBeGreaterThanOrEqual(2);
    });

    it("and the grant records the acting admin, not a constant", () => {
        expect(codeOnly(ADMIN)).toContain("academyGrantRegistration(session.user.id)");
        expect(codeOnly(ADMIN)).toContain("academyGrantFields(session.user.id");
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//   ONE CASE PER READER. A reader left on the old literal does not fail
//   loudly — it decides a granted learner has not paid.

describe("no reader is left behind", () => {
    it.each([
        ["the module gate", GATE],
        ["checkAcademyPaymentStatusAction", STATUS_ACTION],
        ["the SMS broadcast audience", SMS],
        ["the in-app broadcast audience", IN_APP],
        ["the admin applications screen", ADMIN_SCREEN],
        ["the student count", METRICS],
    ])("%s asks the shared rule", (_label, rel) => {
        //   codeBody, not codeOnly: the import alone must not satisfy this.
        expect(codeBody(rel)).toContain("isAcademyEntitled(");
    });

    it.each([
        ["the module gate", GATE],
        ["checkAcademyPaymentStatusAction", STATUS_ACTION],
        ["the SMS broadcast audience", SMS],
        ["the in-app broadcast audience", IN_APP],
        ["the admin applications screen", ADMIN_SCREEN],
        ["the student count", METRICS],
    ])("%s no longer decides it with a bare literal", (_label, rel) => {
        //   The other half: a reader can call the shared rule in one place and
        //   still keep an old `=== "completed"` beside it. Academy's own checks
        //   must all go through the rule. (The cooperative branches in the two
        //   broadcast files are matched on `m.paymentStatus` and asserted
        //   untouched below, so they are excluded here.)
        const academyChecks = codeBody(rel)
            .split("\n")
            .filter((l) => /paymentStatus\s*===?\s*["'\`]completed/.test(l))
            //   The cooperative readers are excluded by name, not by accident:
            //   `m.paymentStatus` in the two broadcast files and
            //   `memberDocData.paymentStatus` in the gate's Layer 2.6 belong to
            //   the cooperative rule, which has its own vocabulary and its own
            //   ₦10,000 flat fee. They are asserted untouched below.
            .filter((l) => !l.includes("m.paymentStatus"))
            .filter((l) => !l.includes("memberDocData.paymentStatus"));

        expect(academyChecks).toEqual([]);
    });

    it("the gate no longer carries its own list of settled spellings", () => {
        //   Four copies of one vocabulary is how the five readers drifted apart.
        expect(codeOnly(GATE)).not.toContain('["completed", "paid"]');
    });

    it("the broadcasts no longer carry theirs", () => {
        for (const rel of [SMS, IN_APP]) {
            expect(codeOnly(rel)).not.toContain('["completed", "paid", "successful"]');
        }
    });

    it("and an unpaid-applicant broadcast still cannot reach a granted learner", () => {
        //   Those audiences query `paymentStatus in ["pending","unpaid","failed"]`.
        //   "waived" is not among them, so a grant is excluded by the query
        //   itself — but only while that list stays free of it.
        for (const rel of [SMS, IN_APP]) {
            const src = codeOnly(rel);
            expect(src).toContain('["pending", "unpaid", "failed"]');
            expect(src).not.toContain('"waived"');
        }
    });

    it("the cooperative readers are untouched — this is an Academy change", () => {
        //   sms-broadcast and in-app-broadcast each have a cooperative branch
        //   testing `m.paymentStatus !== "completed"`. Academy's vocabulary must
        //   not have been applied to it.
        for (const rel of [SMS, IN_APP]) {
            expect(codeOnly(rel)).toContain('m.paymentStatus !== "completed"');
        }
    });
});

describe("revenue counts money and only money", () => {
    it("a grant is not paid, however entitled it makes the learner", () => {
        const grant = academyGrantFields("admin-7", "NOW");

        expect(isAcademyEntitled(grant.paymentStatus)).toBe(true);
        expect(isAcademyPaid(grant.paymentStatus)).toBe(false);
    });

    it("so the two predicates cannot be collapsed into one", () => {
        //   If a refactor ever makes isAcademyPaid and isAcademyEntitled agree,
        //   the distinction this whole change exists for is gone.
        const disagreeOn = ["waived"].filter(
            (s) => isAcademyEntitled(s) !== isAcademyPaid(s),
        );

        expect(disagreeOn).toEqual(["waived"]);
    });
});
