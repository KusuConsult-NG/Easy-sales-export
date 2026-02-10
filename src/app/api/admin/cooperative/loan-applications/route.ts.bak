import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { collection, getDocs, query, orderBy, doc, getDoc } from "firebase/firestore";

/**
 * API Route: Get All Loan Applications (Admin Only)
 */
export async function GET(request: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            );
        }

        // Check if user is admin
        const userRef = doc(db, "users", session.user.id);
        const userDoc = await getDoc(userRef);

        if (!userDoc.exists() || userDoc.data().role !== "admin") {
            return NextResponse.json(
                { success: false, message: "Admin access required" },
                { status: 403 }
            );
        }

        // Get all loan applications
        const applicationsRef = collection(db, "loan_applications");
        const q = query(applicationsRef, orderBy("appliedAt", "desc"));
        const snapshot = await getDocs(q);

        const applications = await Promise.all(
            snapshot.docs.map(async (appDoc) => {
                const data = appDoc.data();

                // Get user details
                const userRef = doc(db, "users", data.userId);
                const userDoc = await getDoc(userRef);
                const userData = userDoc.exists() ? userDoc.data() : {};

                return {
                    id: appDoc.id,
                    ...data,
                    userName: userData.name || userData.email || "Unknown User",
                    userEmail: userData.email || "",
                    appliedAt: data.appliedAt?.toDate?.() || new Date(),
                };
            })
        );

        return NextResponse.json({
            success: true,
            applications
        });
    } catch (error) {
        console.error("Failed to fetch loan applications:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
