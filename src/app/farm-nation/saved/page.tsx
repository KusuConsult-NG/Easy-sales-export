/**
 * Saved properties — the server half. See #543 / #545.
 */

import { getSavedPropertiesAction, type SavedPropertyRecord } from "@/app/actions/saved-items";
import SavedPropertiesClient from "./SavedPropertiesClient";
import { seedOrNull } from "@/lib/server-seed";

/**
 *   #551 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function SavedPropertiesPage() {
    const data = seedOrNull("saved properties", await getSavedPropertiesAction().catch(() => null));
    const initial = (data?.properties as SavedPropertyRecord[] | undefined) ?? null;

    return <SavedPropertiesClient initial={initial} />;
}
