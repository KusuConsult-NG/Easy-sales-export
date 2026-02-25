import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAdminDb } from "@/lib/firebase-admin";

/**
 * Serves documents stored via the Firestore fallback upload path.
 * Only accessible by authenticated users who own the document, or admins.
 *
 * GET /api/admin/documents/[docId]
 */
export async function GET(
    _req: Request,
    { params }: { params: Promise<{ docId: string }> }
) {
    try {
        const { docId } = await params;
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const db = getAdminDb();
        const docSnap = await db.collection("_document_uploads").doc(docId).get();

        if (!docSnap.exists) {
            return NextResponse.json({ error: "Document not found" }, { status: 404 });
        }

        const data = docSnap.data()!;

        // Only the owner or an admin can access
        const userRole = (session.user as any).role;
        const isAdmin = ["admin", "super_admin", "cooperative_manager"].includes(userRole);
        if (data.userId !== session.user.id && !isAdmin) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        // Return the file as a proper binary response
        const buffer = Buffer.from(data.base64, "base64");
        const mimeType = data.mimeType || "application/octet-stream";
        const fileName = data.fileName || "document";

        return new Response(buffer, {
            headers: {
                "Content-Type": mimeType,
                "Content-Disposition": `inline; filename="${fileName}"`,
                "Content-Length": String(buffer.byteLength),
                "Cache-Control": "private, max-age=3600",
            },
        });

    } catch (error) {
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
