import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session-guard";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "firebase-admin/firestore";

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

    await db.collection(COLLECTIONS.USERS).doc(session.user.id).update({
        fcmToken: token,
        fcmTokenUpdatedAt: FieldValue.serverTimestamp(),
    });

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

    await db.collection(COLLECTIONS.USERS).doc(session.user.id).update({
        fcmToken: FieldValue.delete(),
        fcmTokenUpdatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ success: true });
}
