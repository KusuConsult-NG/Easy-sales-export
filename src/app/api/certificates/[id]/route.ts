import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, storage } from "@/lib/firebase";
import { doc, getDoc, deleteDoc } from "firebase/firestore";
import { ref, deleteObject } from "firebase/storage";

/**
 * DELETE - Delete certificate
 */
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const session = await auth();

        if (!session?.user) {
            return NextResponse.json(
                { success: false, error: "Unauthorized" },
                { status: 401 }
            );
        }

        const certDoc = await getDoc(doc(db, "user_certificates", id));

        if (!certDoc.exists()) {
            return NextResponse.json(
                { success: false, error: "Certificate not found" },
                { status: 404 }
            );
        }

        const certData = certDoc.data();

        // Access control
        if (certData.userId !== session.user.id &&
            !session.user.roles?.includes("admin") &&
            !session.user.roles?.includes("super_admin")) {
            return NextResponse.json(
                { success: false, error: "Access denied" },
                { status: 403 }
            );
        }

        // Delete from storage
        const fileRef = ref(storage, certData.fileUrl);
        await deleteObject(fileRef);

        // Delete from Firestore
        await deleteDoc(doc(db, "user_certificates", id));

        return NextResponse.json({
            success: true,
            message: "Certificate deleted",
        });
    } catch (error: any) {
        console.error("Delete error:", error);
        return NextResponse.json(
            { success: false, error: "Delete failed" },
            { status: 500 }
        );
    }
}
