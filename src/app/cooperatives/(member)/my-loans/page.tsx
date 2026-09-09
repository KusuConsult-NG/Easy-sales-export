/**
 * A member's cooperative loans — the server half. See #543 / #545.
 *
 * #547 left this screen on the ledger because its load is a CHAIN: the
 * membership, then that member's applications keyed on the membership's
 * userId, then a repayment schedule per disbursed loan. Seeding only the first
 * link would have saved one round trip out of 2+N and introduced exactly the
 * failure the ledger warns about — a seed present while the rest still fetches.
 *
 * So the whole chain is walked here. The schedules are keyed by loan id and the
 * client's derivation — outstanding balance, next instalment, the flattened
 * schedule rows — stays where it was.
 *
 * A break anywhere passes null for everything: the client then walks the chain
 * itself exactly as it did before, rather than being handed a half-answer.
 */

import { getMembershipAction, getUserLoanApplicationsAction, getRepaymentScheduleAction } from "@/app/actions/cooperative";
import { rawSeed } from "@/lib/server-seed";
import MyLoansClient from "./MyLoansClient";

/**
 *   #555 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function MyLoansPage() {
    const membershipRes = rawSeed(
        "cooperative membership", await getMembershipAction().catch(() => null),
    );

    const membership = membershipRes?.success ? membershipRes.data?.membership : null;

    //   The membership row carries `userId`, and that is the argument — the
    //   client's own comment records why a membership DOCUMENT id silently
    //   returns an empty list here.
    const applications = membership
        ? await getUserLoanApplicationsAction(
            (membership as any).userId || (membership as any).id,
        ).catch(() => null)
        : null;

    //   One schedule per disbursed loan, in parallel rather than in sequence.
    const disbursed = (applications ?? []).filter((l: any) => l.status === "disbursed");
    const scheduleResults = await Promise.all(
        disbursed.map((l: any) =>
            getRepaymentScheduleAction(l.id || "").catch(() => null)),
    );

    const schedules: Record<string, any> = {};
    disbursed.forEach((l: any, i: number) => {
        if (scheduleResults[i]) schedules[l.id || ""] = scheduleResults[i];
    });

    //   All or nothing. A partial chain is the failure this conversion was
    //   held back for.
    const complete = membershipRes !== null
        && applications !== null
        && scheduleResults.every(Boolean);

    return (
        <MyLoansClient
            initial={complete ? { membershipRes, loanApplications: applications, schedules } : null}
        />
    );
}
