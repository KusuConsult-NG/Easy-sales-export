import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { doc, updateDoc } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";

/**
 * Disable MFA
 */
export async function POST(request: NextRequest) {
    try {
        const session = await auth();

        if (!session?.user) {
            return NextResponse.json(
                { success: false, error: "Unauthorized" },
                { status: 401 }
            );
        }

        // Disable MFA and clear secrets
        await updateDoc(doc(db, COLLECTIONS.USERS, session.user.id), {
            mfaEnabled: false,
            totpSecret: null,
            mfaRecoveryCodes: null,
            updatedAt: new Date(),
        });

        return NextResponse.json({
            success: true,
            message: "MFA disabled",
        });
    } catch (error: any) {
        console.error("MFA disable error:", error);
        return NextResponse.json(
            { success: false, error: "Failed to disable MFA" },
            { status: 500 }
        );
    }
}
