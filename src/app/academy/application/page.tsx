/**
 * The Academy application — the server half. See #543 / #545.
 *
 * Its mount effect walks a chain of up to three reads, and EVERY branch of that
 * chain makes the first two: the application status, and the payment status. So
 * those two are made here, and two round trips go from every path a learner can
 * take through this screen.
 *
 * WHAT IS DELIBERATELY LEFT IN THE BROWSER: the application itself. Which
 * branches read it depends on `?edit=true`, on the payment answer, and on
 * whether a submitted application exists — a careful ordering that #316 is
 * written all over, because on this screen reading "could not tell" as "unpaid"
 * asks a learner who has already paid to pay again. Seeding it would mean
 * restating that ordering on the server, and two copies of one contract is the
 * defect this whole audit keeps finding. The third round trip stays where the
 * rule lives.
 */

import {
    checkAcademyPaymentStatusAction,
    checkAcademyStatusAction,
} from "@/app/actions/academy";
import { rawSeed } from "@/lib/server-seed";
import AcademyApplicationClient from "./AcademyApplicationClient";

/**
 *   #562 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function AcademyApplicationPage() {
    //   Independent of each other, so together rather than one after the other.
    const [statusResult, paymentResult] = await Promise.all([
        checkAcademyStatusAction().catch(() => null),
        checkAcademyPaymentStatusAction().catch(() => null),
    ]);

    const status = rawSeed("academy application status", statusResult);
    const payment = rawSeed("academy payment status", paymentResult);

    //   All or nothing. Seeding the status without the payment would leave the
    //   client holding half a chain, and on THIS screen the missing half is the
    //   one #316 is about.
    const complete = status !== null && payment !== null;

    return (
        <AcademyApplicationClient
            initial={complete && status && payment ? { status, payment } : null}
        />
    );
}
