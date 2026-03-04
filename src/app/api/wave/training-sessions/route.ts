export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAdminDb } from "@/lib/firebase-admin";
import { logger } from "@/lib/logger";

export async function GET() {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const db = getAdminDb();
        const snap = await db.collection("wave_training_sessions")
            .orderBy("scheduledAt", "asc")
            .get();

        const sessions = snap.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            // Convert Firestore Timestamp → ISO string for client
            scheduledAt: doc.data().scheduledAt?.toDate?.()?.toISOString() ?? doc.data().scheduledAt,
        }));

        return NextResponse.json({ success: true, sessions });
    } catch (error) {
        logger.error("GET /api/wave/training-sessions error:", error);
        return NextResponse.json({ success: true, sessions: [] }); // Graceful fallback
    }
}

export async function POST(req: Request) {
    try {
        const session = await auth();
        const isAdmin = session?.user?.roles?.includes("admin") || session?.user?.roles?.includes("super_admin");
        if (!isAdmin) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
        }

        const body = await req.json();
        const { title, description, scheduledAt, durationMinutes, roomName } = body;

        if (!title || !scheduledAt || !durationMinutes) {
            return NextResponse.json({ error: "title, scheduledAt, and durationMinutes are required" }, { status: 400 });
        }

        const db = getAdminDb();
        const ref = await db.collection("wave_training_sessions").add({
            title,
            description: description || "",
            scheduledAt: new Date(scheduledAt),
            durationMinutes: Number(durationMinutes),
            roomName: roomName || `wave-training-${Date.now()}`,
            isActive: true,
            createdAt: new Date(),
            createdBy: session!.user.id,
        });

        return NextResponse.json({ success: true, id: ref.id });
    } catch (error) {
        logger.error("POST /api/wave/training-sessions error:", error);
        return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
    }
}
