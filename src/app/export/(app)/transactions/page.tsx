/**
 * Export transactions — the server half. See #543 / #545.
 *
 * The RAW action result is handed over; the client turns each investment into
 * an investment row and a return row and sorts them, which stays in one place.
 */

import { getMyExportInvestmentsAction } from "@/app/actions/export";
import ExportTransactionsClient from "./ExportTransactionsClient";

/**
 *   #546 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function ExportTransactionsPage() {
    const result = await getMyExportInvestmentsAction().catch(() => null);

    return <ExportTransactionsClient initial={result} />;
}
