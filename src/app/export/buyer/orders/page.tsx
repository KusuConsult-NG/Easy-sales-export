/**
 * A buyer's own export orders — the screen that did not exist. See #585.
 *
 * export_orders was written by the checkout and read by the admin list, the
 * payment verification and a cron. The person who paid could not see their own
 * order anywhere on the platform: the confirmation screen sent them to
 * /dashboard, whose Active Orders tile counts marketplace orders only.
 *
 * Server-rendered from the start rather than added to #545's ledger — the rows
 * are session-scoped and there is nothing here the browser could ask for that
 * this render cannot supply.
 */

import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { readMyExportOrders } from "@/lib/export-orders-reader";
import MyExportOrdersClient from "./MyExportOrdersClient";

/**
 *   #585 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function MyExportOrdersPage() {
    const session = await auth().catch(() => null);
    const userId = session?.user?.id;

    if (!userId) {
        redirect("/auth/login?callbackUrl=/export/buyer/orders");
    }

    const orders = await readMyExportOrders(userId).catch((error) => {
        //   A read that failed is not "no orders". The screen says so rather
        //   than showing an empty list to somebody who has just paid.
        logger.error("[export-orders] read failed", error);
        return null;
    });

    return <MyExportOrdersClient orders={orders} />;
}
