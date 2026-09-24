import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";

/**
 * POST /api/notifications/subscribe
 * Saves a Firebase Cloud Messaging registration token to the user's profile.
 * Body: { token: string }
 */
export async function POST(req: NextRequest) {
    const session = (await requireSession()).session;
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let token: string;
    try {
        const body = await req.json();
        token = body.token as string;
        if (!token || typeof token !== "string" || token.length < 10) {
            return NextResponse.json({ error: "Invalid token" }, { status: 400 });
        }
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    /*
     *   `set(..., { merge: true })`, NOT `update()`.
     *
     *   The adapter's own warning names this exact case: "update() on missing
     *   document — no rows will be affected. Use set(data, { merge: true }) if
     *   the document may not exist yet." It keeps the write a no-op rather than
     *   throwing, deliberately, so the caller is told nothing.
     *
     *   A signed-in member CAN be without a USERS row — /api/onboarding/complete
     *   handles precisely that case three routes over, creating the document
     *   when it finds none. For them this returned `{ success: true }` and
     *   saved no token, so the browser believed it had subscribed to push
     *   notifications and none would ever arrive. Reported success over a write
     *   that did not happen is the shape this audit keeps finding.
     *
     *   Merging rather than setting, so nothing else on the row is disturbed.
     */
    await db.collection(COLLECTIONS.USERS).doc(session.user.id).set({
        fcmToken: token,
        fcmTokenUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return NextResponse.json({ success: true });
}

/**
 * DELETE /api/notifications/subscribe
 * Removes the FCM token (user opts out of push notifications).
 */
export async function DELETE(_req: NextRequest) {
    const session = (await requireSession()).session;
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    //   `update()` here is right, unlike the POST above: a member with no row
    //   has no token stored, so a no-op IS the correct outcome of asking for it
    //   to be removed. Creating a row in order to delete a field from it would
    //   be the odd behaviour.
    await db.collection(COLLECTIONS.USERS).doc(session.user.id).update({
        fcmToken: FieldValue.delete(),
        fcmTokenUpdatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ success: true });
}
