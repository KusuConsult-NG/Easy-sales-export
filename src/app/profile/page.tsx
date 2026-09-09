/**
 * /profile — the server half.
 *
 *   #541 THE PROFILE WAS FETCHED AFTER THE PAGE HAD ALREADY APPEARED.
 *
 *   This screen was a single "use client" page that fetched on mount, so a user
 *   saw an empty form, waited for the JS bundle, waited for hydration, and only
 *   then waited for their own details to arrive.
 *
 *   It matters more here than on most screens: #529 established that a user
 *   with an incomplete profile is REDIRECTED here and cannot leave until they
 *   save. This is the first thing many users see after signing in, and it was
 *   the slowest way to show it to them.
 *
 *   The rendering has not moved — ProfileClient is the same component, with the
 *   same effect doing the same derivation. All that changed is that the first
 *   answer arrives with the HTML instead of a round trip later.
 *
 *   `.catch(() => null)` deliberately: a failed server read must not turn a
 *   working screen into an error page. The client falls back to fetching, which
 *   is exactly what it used to do.
 */

import { getUserProfileAction } from "@/app/actions/profile";
import ProfileClient from "./ProfileClient";

/**
 *   #543 EXPLICITLY DYNAMIC.
 *
 *   These pages read a session, so Next cannot prerender them. It found that
 *   out by TRYING at build time: the attempt threw "Dynamic server usage …
 *   used `headers`", the `.catch(() => null)` below absorbed it, and the route
 *   was correctly marked dynamic anyway.
 *
 *   The behaviour was right and the build log was wrong — several screenfuls of
 *   stack traces naming a normal outcome as a fault. That is exactly the "log
 *   that cries wolf on the normal path" #366 recorded in hub-guard, where the
 *   real exception goes unread because the noise is routine.
 *
 *   Saying it up front stops the probe and the noise with it.
 */
export const dynamic = "force-dynamic";


export default async function ProfilePage() {
    const initialProfile = await getUserProfileAction().catch(() => null);

    return <ProfileClient initialProfile={initialProfile} />;
}
