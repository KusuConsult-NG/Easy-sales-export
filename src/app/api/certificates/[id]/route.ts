export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { retirementPatch } from "@/lib/record-retirement";

/**
 * DELETE - Delete certificate
 */
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const session = (await requireSession()).session;

        if (!session?.user) {
            return NextResponse.json(
                { success: false, error: "Unauthorized" },
                { status: 401 }
            );
        }

        // Get certificate (Admin SDK)
        const certDoc = await db.collection(COLLECTIONS.USER_CERTIFICATES).doc(id).get();

        if (!certDoc.exists) {
            return NextResponse.json(
                { success: false, error: "Certificate not found" },
                { status: 404 }
            );
        }

        const certData = certDoc.data()!;

        // Access control
        // #364. Was `roles.includes("admin") || roles.includes("super_admin")`,
        // which locked the academy_admin out of the academy's own certificates.
        // The permission is the one ACADEMY_MANAGE already maps certificates to.
        if (certData.userId !== session.user.id &&
            !hasAdminPermission(session.user.roles, "academy:issue_certificates")) {
            return NextResponse.json(
                { success: false, error: "Access denied" },
                { status: 403 }
            );
        }

        /**
         *   #303 THIS DESTROYED THE STORED FILE. IT IS THE ONE IRREVERSIBLE ACT
         *        IN THE CODEBASE, AND THE ONE THE OWNER NAMED.
         *
         *        Two lines used to sit here:
         *
         *            const file = bucket.file(certData.storagePath || certData.fileUrl);
         *            await file.delete();
         *            await db.collection(USER_CERTIFICATES).doc(id).delete();
         *
         *        A certificate is somebody's proof of a qualification. The
         *        storage delete was wrapped in a try/catch that logged a WARNING
         *        and carried on — "file may not exist" — so a failure to remove
         *        the file still removed the row, leaving the file with nothing
         *        recording whose it was. That is #292's shape again, on a
         *        different bucket.
         *
         *        Nothing is deleted now: the file is untouched and the row is
         *        marked. The listing filters retired certificates and the
         *        download route refuses them, so the member sees the same
         *        outcome they did before — the certificate is gone from their
         *        screen — while the artefact survives.
         *
         *        deleteCertificateAction in actions/certificates.ts is the other
         *        door onto this, and it changes with this one.
         */
        await db.collection(COLLECTIONS.USER_CERTIFICATES).doc(id).update({
            ...retirementPatch(session.user.id, certData.status),
            removedByOwner: true,
        });

        return NextResponse.json({
            success: true,
            message: "Certificate removed",
        });
    } catch (error: any) {
        logger.error("Delete error:", error);
        return NextResponse.json(
            { success: false, error: "Delete failed" },
            { status: 500 }
        );
    }
}
