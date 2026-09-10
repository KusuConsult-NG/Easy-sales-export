/**
 * The export product catalogue — the server half. See #545 / #578.
 *
 * This screen fetched its own application over HTTP on mount, and rendered a
 * full-screen spinner and nothing else until the round trip came back:
 *
 *     if (catalogLoading) return <Loader2 className="animate-spin" />;
 *
 * It is the shop window for international buyers, whose connections are the
 * slowest on the platform, and it was blank until three round trips had
 * finished — the HTML, the bundle, and then the catalogue.
 *
 * It reads through the same function the route uses, so the allow-list that
 * keeps a seller's internal id out of a public response has one definition and
 * two callers. See lib/export-catalog-reader.
 *
 * A FAILED READ SEEDS NULL, and the client then fetches exactly as it did
 * before. The seed is an optimisation; it is never a new way for the screen to
 * be empty.
 */

import { logger } from "@/lib/logger";
import { readPublicExportCatalog } from "@/lib/export-catalog-reader";
import type { ExportProduct } from "@/contexts/ExportCartContext";
import ExportBuyerClient from "./ExportBuyerClient";

/**
 *   #578 EXPLICITLY DYNAMIC — the catalogue is a live list of what an admin has
 *   approved, and a prerender would freeze it at build time.
 */
export const dynamic = "force-dynamic";

export default async function ExportBuyerPage() {
    const products = await readPublicExportCatalog().catch((error) => {
        logger.error("[export-catalog] read failed; the client will fetch", error);
        return null;
    });

    /**
     *   AN EMPTY CATALOGUE IS A SEED, NOT A MISSING ONE — #579.
     *
     *   `[]` and `null` mean different things to the client: the first is "the
     *   owner has nothing listed", the second is "nobody could tell". Coercing
     *   an empty array to null here would put the screen into the state it
     *   reserves for a failure and send it off to re-ask a question that has
     *   already been answered.
     */
    return <ExportBuyerClient initial={products as ExportProduct[] | null} />;
}
