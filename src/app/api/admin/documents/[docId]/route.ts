export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { requireAdmin } from "@/lib/require-admin";
import { getAdminDb } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";

/**
 * GET /api/admin/documents/[docId] — RETIRED. It could never serve anything.
 *
 * #431. This reads COLLECTIONS.DOCUMENT_UPLOADS ("_document_uploads"), and that
 * table has NO WRITER ANYWHERE IN THIS REPOSITORY and no migration creating it.
 * Its header called it "the Firestore fallback upload path"; that path does not
 * exist. Every request could only ever 404.
 *
 * It was not unreachable, though — the admin seller-review screen linked to it
 * three times, once per KYC document, building the URL from a string the submit
 * route wrote as `placeholder_<filename>` instead of storing the file. So the
 * only callers were three "View Document" links that always failed, on the
 * screen where a seller's identity is approved or rejected. Both halves are
 * fixed at their own doors: the submit route stores the documents, and the
 * screen links to what was stored.
 *
 * THREE THINGS WERE WRONG WITH IT BEYOND BEING DEAD, and they are fixed rather
 * than preserved, because a retired endpoint that is one flag away from being
 * live must not be revived in this state:
 *
 *   1. IT STATED THE ADMIN RULE BY HAND —
 *      ["admin", "super_admin", "cooperative_manager", "superadmin"] — read off
 *      `session.user.roles`, the JWT claim, which is stale for up to eight
 *      hours after a revocation. That is exactly the class #364 swept out of
 *      fifteen API routes and #356 out of requireAdmin itself; this route was
 *      missed by both. It asks requireAdmin now, which re-reads the roles from
 *      the database and checks the permission matrix.
 *
 *   2. IT SERVED CALLER-STORED BYTES WITH CALLER-STORED MIME, INLINE.
 *      `Content-Type: data.mimeType` with `Content-Disposition: inline` on the
 *      admin origin is a stored-XSS shape: whoever wrote the row chooses what
 *      the admin's browser executes. Unreachable today only because nothing
 *      writes the collection. The response is `attachment` with a fixed
 *      octet-stream type if this is ever revived.
 *
 *   3. ITS catch SWALLOWED THE ERROR — no logger, so a failure here was
 *      invisible. #308's class.
 *
 * RETIRED, NOT DELETED, per the treatment #379 and #386 established: the
 * implementation is kept and refuses by default. Set
 * LEGACY_DOCUMENT_FALLBACK=enabled to revive it, which is only sensible once
 * something writes the collection.
 */

const LEGACY_FLAG = "LEGACY_DOCUMENT_FALLBACK";
const ENABLED_VALUE = "enabled";

/** Read at call time, not module load, so reviving it needs no redeploy. */
export function legacyDocumentFallbackEnabled(): boolean {
    return process.env[LEGACY_FLAG] === ENABLED_VALUE;
}

export const RETIRED_MESSAGE =
    "This document viewer is retired: nothing writes _document_uploads. "
    + "Seller verification documents are stored on the verification record itself.";

export async function GET(
    _req: Request,
    { params }: { params: Promise<{ docId: string }> }
) {
    try {
        const { docId } = await params;

        // The permission gate comes FIRST, before the retirement notice, so the
        // refusal does not become a way for an unauthenticated caller to learn
        // anything about this endpoint.
        const authCheck = await requireAdmin("users:read");
        if ("error" in authCheck) {
            return NextResponse.json({ error: authCheck.error }, { status: 403 });
        }

        if (!legacyDocumentFallbackEnabled()) {
            return NextResponse.json({ error: RETIRED_MESSAGE }, { status: 410 });
        }

        const db = getAdminDb();
        const docSnap = await db.collection(COLLECTIONS.DOCUMENT_UPLOADS).doc(docId).get();

        if (!docSnap.exists) {
            return NextResponse.json({ error: "Document not found" }, { status: 404 });
        }

        const data = docSnap.data()!;
        const buffer = Buffer.from(String(data.base64 ?? ""), "base64");
        const fileName = typeof data.fileName === "string" ? data.fileName : "document";

        return new Response(buffer, {
            headers: {
                // Fixed type, and an attachment rather than inline. The stored
                // mimeType is NOT honoured: see (2) above.
                "Content-Type": "application/octet-stream",
                "Content-Disposition": `attachment; filename="${fileName.replace(/[^\w.\-]/g, "_")}"`,
                "Content-Length": String(buffer.byteLength),
                "Cache-Control": "private, no-store",
            },
        });
    } catch (error) {
        logger.error("[admin/documents] failed", {
            error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
