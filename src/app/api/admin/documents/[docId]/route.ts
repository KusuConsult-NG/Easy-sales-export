export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session-guard";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { getAdminDb } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";

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
        const session = (await requireSession()).session;
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const db = getAdminDb();
        const docSnap = await db.collection(COLLECTIONS.DOCUMENT_UPLOADS).doc(docId).get();

        if (!docSnap.exists) {
            return NextResponse.json({ error: "Document not found" }, { status: 404 });
        }

        const data = docSnap.data()!;

        /**
         * WHO MAY READ SOMEBODY ELSE'S IDENTITY DOCUMENT.
         *
         * This is the raw file a member uploaded for KYC — an ID card, a
         * passport photograph, a proof of address — served as bytes. The owner
         * may always read their own; the question is which admin may read
         * anyone's.
         *
         * It was decided by a hand-rolled list:
         *
         *     ["admin", "super_admin", "cooperative_manager", "superadmin"]
         *
         * `cooperative_manager` IS NOT A ROLE. It appears in no permission
         * table, in no role union, and nowhere else in this repository — a name
         * that has never matched anything, sitting in the guard on identity
         * documents. `superadmin` is the legacy spelling of super_admin and
         * does match, so the list's real effect is {admin, super_admin}.
         *
         * Named through the matrix now, so it cannot drift again — this was the
         * fourth hardcoded role list this audit has found deciding an
         * authorization question that admin-permissions.ts already answers.
         *
         * `users:export` is chosen because its holder set is EXACTLY the
         * list's real effect — "held by super_admin and admin only —
         * deliberately NOT by support, moderator, or any module admin" — so
         * this change removes the dead name and the drift without widening
         * who can read a stranger's passport photograph.
         *
         * The matrix's own note argues `users:read` covers "reading one
         * member's record to answer their support ticket", and every admin role
         * holds it. That is the wider alternative and it is a policy decision,
         * not a defect fix: adopting it would hand every module admin the
         * identity documents of every member. Left to the owner.
         */
        if (data.userId !== session.user.id
            && !hasAdminPermission(session.user.roles, "users:export")) {
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
