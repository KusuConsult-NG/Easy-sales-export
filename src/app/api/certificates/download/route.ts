import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";

/**
 * GET - Download certificate
 */
export async function GET(request: NextRequest) {
    try {
        const session = await auth();

        if (!session?.user) {
            return NextResponse.json(
                { success: false, error: "Unauthorized" },
                { status: 401 }
            );
        }

        const { searchParams } = new URL(request.url);
        const id = searchParams.get("id");

        if (!id) {
            return NextResponse.json(
                { success: false, error: "Certificate ID required" },
                { status: 400 }
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

        // Access control: user can only download own certificates
        if (certData.userId !== session.user.id &&
            !session.user.roles?.includes("admin") &&
            !session.user.roles?.includes("super_admin")) {
            return NextResponse.json(
                { success: false, error: "Access denied" },
                { status: 403 }
            );
        }

        // Redirect to Firebase Storage URL for download
        return NextResponse.redirect(certData.fileUrl);
    } catch (error: any) {
        console.error("Download error:", error);
        return NextResponse.json(
            { success: false, error: "Download failed" },
            { status: 500 }
        );
    }
}
