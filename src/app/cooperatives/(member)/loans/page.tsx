/**
 * Cooperative loans — the server half. See #543 / #545 / #570.
 *
 * THREE fetches back to this same application on mount: the membership check,
 * the loan products, and this member's own applications. All three happened
 * after the page had been rendered, downloaded and hydrated.
 *
 * All three now read through the same functions the routes use, so the findings
 * those endpoints carry have one definition each and more than one caller:
 * #488's membership lookup, the isActive toggle nothing read, and the two
 * collections a loan application can be filed into.
 *
 * The membership ANSWER is passed down whole rather than flattened, because
 * #570 is about the difference between "not a member" and "could not tell" —
 * and that reading now lives in exactly one function, shared with the savings
 * screen that had the same defect.
 */

import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import {
    readActiveLoanProducts,
    readCooperativeMembership,
    readMyLoanApplications,
} from "@/lib/cooperative-readers";
import LoansClient from "./LoansClient";

/**
 *   #570 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function LoansPage() {
    const session = await auth().catch(() => null);
    const userId = session?.user?.id;

    if (!userId) {
        //   Nothing decided here that the routes do not decide themselves.
        return <LoansClient initial={null} />;
    }

    //   Independent of each other, so together rather than one after another.
    const [membership, products, applications] = await Promise.all([
        readCooperativeMembership(userId).catch((error) => {
            logger.error("[loans] membership read failed; the client will fetch", error);
            return null;
        }),
        readActiveLoanProducts().catch((error) => {
            logger.error("[loans] products read failed; the client will fetch", error);
            return null;
        }),
        readMyLoanApplications(userId).catch((error) => {
            logger.error("[loans] applications read failed; the client will fetch", error);
            return null;
        }),
    ]);

    //   All or nothing, in one expression — see #562. A borrower seeded with
    //   products and no membership answer would be shown the join panel over
    //   the top of a loan they are repaying.
    const initial = membership !== null && products !== null && applications !== null
        ? {
            membership: { isMember: membership.isMember, status: membership.status },
            products,
            applications,
        }
        : null;

    return <LoansClient initial={initial} />;
}
