/**
 * Cooperative member directory — the server half. See #543 / #545.
 */

import { getDirectoryMembersAction } from "@/app/actions/cooperative";
import CooperativeDirectoryClient from "./CooperativeDirectoryClient";

/**
 *   #549 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function CooperativeDirectoryPage() {
    const result = await getDirectoryMembersAction().catch(() => null);
    const initial = result?.success && result.data?.members
        ? (result.data.members as any[])
        : null;

    return <CooperativeDirectoryClient initial={initial} />;
}
