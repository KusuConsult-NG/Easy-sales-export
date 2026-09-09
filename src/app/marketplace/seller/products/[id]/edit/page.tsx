/**
 * Editing one product — the server half. See #543 / #545.
 *
 * One read, keyed on the id in the route, and it was made after the page had
 * already been sent, downloaded and hydrated — so a seller opening their own
 * listing to change a price waited four steps for a form they could have been
 * handed filled in.
 *
 * The RESULT is passed down rather than the product: the client turns it into
 * roughly twenty pieces of form state, deciding whether the title and unit are
 * preset options or custom ones and unpacking three pricing tiers, and that
 * derivation stays in one place. See EditProductClient.
 */

import { getProductByIdAction } from "@/app/actions/marketplace";
import { rawSeed } from "@/lib/server-seed";
import EditProductClient from "./EditProductClient";

/**
 *   #560 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function EditProductPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    const initial = rawSeed("product for editing", await getProductByIdAction(id).catch(() => null));

    return <EditProductClient initial={initial} />;
}
