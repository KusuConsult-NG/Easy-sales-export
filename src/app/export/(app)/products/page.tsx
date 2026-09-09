/**
 * A member's own export products — the server half. See #543 / #545.
 */

import { getUserExportProductsAction } from "@/app/actions/export-products";
import MyExportProductsClient from "./MyExportProductsClient";

/**
 *   #547 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function MyExportProductsPage() {
    const res = await getUserExportProductsAction().catch(() => null);
    const initial = res?.success && res.data ? (res.data as any[]) : null;

    return <MyExportProductsClient initial={initial} />;
}
