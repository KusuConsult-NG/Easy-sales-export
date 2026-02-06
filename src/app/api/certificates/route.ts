import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, storage } from "@/lib/firebase";
import { collection, query, where, getDocs, addDoc, deleteDoc, doc, Timestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { COLLECTIONS } from "@/lib/types/firestore";

/**
 * GET - List user's certificates
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

        const certificatesQuery = query(
            collection(db, "user_certificates"),
            where("userId", "==", session.user.id)
        );

        const snapshot = await getDocs(certificatesQuery);
        const certificates = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            uploadedAt: doc.data().uploadedAt?.toDate(),
        }));

        return NextResponse.json({
            success: true,
            certificates,
        });
    } catch (error: any) {
        console.error("Cert fetch error:", error);
        return NextResponse.json(
            { success: false, error: "Failed to fetch certificates" },
            { status: 500 }
        );
    }
}
