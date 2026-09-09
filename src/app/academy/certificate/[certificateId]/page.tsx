/**
 * Academy certificate — the server half. See #543 / #545.
 *
 * The course and the member's progress are the two reads this screen makes;
 * they were already parallel in the client and are fetched here instead.
 *
 * A signed-out visitor gets a null seed and the client's own effect performs
 * the redirect to sign-in that it always did.
 */

import { auth } from "@/lib/auth";
import { getCourseByIdAction, getUserProgressAction } from "@/app/actions/academy";
import CertificateClient from "./CertificateClient";

/**
 *   #549 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function CertificatePage({ params }: { params: Promise<{ certificateId: string }> }) {
    const { certificateId: courseId } = await params;

    const session = await auth().catch(() => null);
    const userId = session?.user?.id;

    const [courseReq, progressReq] = userId
        ? await Promise.all([
            getCourseByIdAction(courseId).catch(() => null),
            getUserProgressAction(userId, courseId).catch(() => null),
        ])
        : [null, null];

    //   Both or neither: the client skips its whole load when seeded, so a
    //   half-seed would render a certificate with no progress behind it.
    const initial = courseReq && progressReq
        ? { course: (courseReq.data ?? null) as any, progress: (progressReq.data ?? null) as any }
        : null;

    return <CertificateClient initial={initial} />;
}
