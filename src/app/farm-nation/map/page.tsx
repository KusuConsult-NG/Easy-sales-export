/**
 * The Farm Nation parcel map — the server half. See #543 / #545 / #562.
 *
 * The second of the two screens that fetched /api/farm-nation/listings from the
 * browser after they had already been rendered. Both now read through the same
 * shared reader the route itself uses, so which listings are public and which
 * fields a stranger may see are defined once and not once per caller.
 *
 * The RAW listings are seeded, not the mapped ones. This screen keeps only the
 * parcels that are purchasable and carry GPS coordinates, and that rule has
 * been wrong twice — see the comment in FarmNationMapClient — so it is not
 * going to be restated here.
 */

import { readPublicLandListings } from "@/lib/land-listings-reader";
import { logger } from "@/lib/logger";
import FarmNationMapClient, { type LandListing } from "./FarmNationMapClient";

/**
 *   #562 EXPLICITLY DYNAMIC — the listings change as admins approve them.
 */
export const dynamic = "force-dynamic";

export default async function FarmNationMapPage() {
    const initial = await readPublicLandListings().catch((error) => {
        logger.error("[farm-nation/map] listings read failed; the client will fetch instead", error);
        return null;
    });

    return <FarmNationMapClient initial={initial as LandListing[] | null} />;
}
