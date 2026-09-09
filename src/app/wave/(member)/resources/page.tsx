/**
 * The WAVE resource library — the server half. See #543 / #545.
 *
 * Two reads made in the browser, one after the other, after the page had
 * already arrived: an eligibility check and then the library itself. Both are
 * made here now, in the same order and with the same gating, so the second is
 * still skipped for a visitor the first sends away.
 *
 * #557 is fixed on the client side of this pair — see WaveResourcesClient. The
 * eligibility answer is passed down whole precisely so that the three states it
 * can hold stay readable there rather than being flattened here.
 */

import { auth } from "@/lib/auth";
import { checkWaveEligibilityAction } from "@/app/actions/wave";
import { getResourcesAction } from "@/app/actions/resource-actions";
import { rawSeed } from "@/lib/server-seed";
import WaveResourcesClient from "./WaveResourcesClient";

/**
 *   #556 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function WaveResourcesPage() {
    const session = await auth().catch(() => null);
    const userId = session?.user?.id;

    const eligibility = userId
        ? rawSeed("wave eligibility", await checkWaveEligibilityAction(userId).catch(() => null))
        : null;

    //   A definite "no" is the only answer that stops the library being read —
    //   the same condition the client redirects on. A FAILED check does not
    //   stop it, because a failed check is not a no (#557).
    const turnedAway = eligibility?.success === true && eligibility.data?.eligible === false;

    const resources = eligibility && !turnedAway
        ? rawSeed("wave resources", await getResourcesAction().catch(() => null))
        : null;

    //   All or nothing: a seed present while the rest still fetches is the
    //   failure the ledger warns about.
    const complete = eligibility !== null && (turnedAway || resources !== null);

    return (
        <WaveResourcesClient
            initial={complete && eligibility ? { eligibility, resources } : null}
        />
    );
}
