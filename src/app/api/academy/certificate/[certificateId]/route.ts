import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";

/**
 * API Route: Get Certificate Data
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ certificateId: string }> }
) {
    try {
        const { certificateId } = await params;
        const certificateRef = doc(db, "certificates", certificateId);
        const certificateDoc = await getDoc(certificateRef);

        if (!certificateDoc.exists()) {
            return NextResponse.json(
                { success: false, message: "Certificate not found" },
                { status: 404 }
            );
        }

        const certificate = {
            id: certificateDoc.id,
            ...certificateDoc.data(),
            completionDate: certificateDoc.data().completionDate?.toDate?.() || new Date(),
            issuedAt: certificateDoc.data().issuedAt?.toDate?.() || new Date(),
        };

        return NextResponse.json({
            success: true,
            certificate
        });
    } catch (error) {
        console.error("Failed to fetch certificate:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
