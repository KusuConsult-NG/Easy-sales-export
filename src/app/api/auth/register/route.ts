import { NextResponse } from "next/server";
import { db, adminAuth } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";

export async function POST(req: Request) {
    // 1. Block entirely in production environments
    if (
        process.env.NODE_ENV === "production" ||
        process.env.VERCEL_ENV === "production" ||
        process.env.RAILWAY_ENVIRONMENT === "production"
    ) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    try {
        const body = await req.json();
        const { email, password, firstName, lastName, phone, role } = body;

        if (!email || !password || !firstName || !lastName || !phone) {
            return NextResponse.json(
                { error: "Missing required fields (email, password, firstName, lastName, phone)" },
                { status: 400 }
            );
        }

        // 2. Check if the user already exists in Firebase Auth
        try {
            const existingUser = await adminAuth.getUserByEmail(email);
            if (existingUser) {
                return NextResponse.json(
                    { error: "An account with this email already exists." },
                    { status: 409 }
                );
            }
        } catch (err: any) {
            if (err.code !== "auth/user-not-found") {
                return NextResponse.json(
                    { error: "Database error during duplicate check: " + err.message },
                    { status: 500 }
                );
            }
        }

        // 3. Check if phone number already exists in Firestore users collection
        const phoneCheck = await db.collection(COLLECTIONS.USERS)
            .where("phone", "==", phone)
            .limit(1)
            .get();
        if (!phoneCheck.empty) {
            return NextResponse.json(
                { error: "An account with this phone number already exists." },
                { status: 409 }
            );
        }

        // 4. Create Firebase Auth user
        const userRecord = await adminAuth.createUser({
            email,
            password,
            displayName: `${firstName} ${lastName}`.trim(),
            emailVerified: true,
        });

        // 5. Build canonical user profile
        const userRoles = role ? [role] : ["general_user"];
        const userProfile = {
            uid: userRecord.uid,
            fullName: `${firstName} ${lastName}`.trim(),
            firstName,
            lastName,
            email,
            phone,
            roles: userRoles,
            isVerified: true,
            verified: true,
            profileComplete: false,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        };

        // 6. Write to Firestore with rollback capability
        try {
            await db.collection(COLLECTIONS.USERS).doc(userRecord.uid).set(userProfile, { merge: true });
        } catch (firestoreError: any) {
            // Delete created auth user on database failure to prevent orphaned auth accounts
            try {
                await adminAuth.deleteUser(userRecord.uid);
            } catch (rollbackError) {
                console.error(`[auth-seed] CRITICAL: Failed to rollback user ${userRecord.uid}:`, rollbackError);
            }
            return NextResponse.json(
                { error: "Failed to create user profile: " + firestoreError.message },
                { status: 500 }
            );
        }

        return NextResponse.json(
            { success: true, uid: userRecord.uid },
            { status: 201 }
        );
    } catch (error: any) {
        return NextResponse.json(
            { error: error.message || "Internal server error" },
            { status: 500 }
        );
    }
}
