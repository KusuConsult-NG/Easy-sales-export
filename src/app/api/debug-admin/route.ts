import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAdminDb, getAdminAuth } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { invalidateUserCache } from "@/lib/user-cache";

export async function GET(req: Request) {
    const session = await auth();

    if (!session?.user?.id) {
        return NextResponse.json({ error: "Not logged in! Please sign in first at /auth/login" }, { status: 401 });
    }

    const { id, email } = session.user;
    
    try {
        const adminDb = getAdminDb();
        const adminAuth = getAdminAuth();

        // 1. Upgrade in Firestore
        await adminDb.collection(COLLECTIONS.USERS).doc(id).set({
            role: "super_admin",
            roles: ["super_admin"]
        }, { merge: true });

        // 2. Add to admin_users table
        await adminDb.collection('admin_users').doc(id).set({
            email,
            role: "super_admin",
            permissions: ['*'],
            grantedAt: new Date(),
            grantedBy: 'debug-api',
        }, { merge: true });

        // 3. Set custom auth claims
        await adminAuth.setCustomUserClaims(id, {
            role: "super_admin",
            admin: true,
            superAdmin: true,
        });

        // 4. Invalidate Redis Cache instantly
        await invalidateUserCache(id);

        return NextResponse.json({ 
            success: true, 
            message: `Successfully upgraded ${email} to super_admin! Redis cache cleared.`,
            action: "Next step: Please go to /dashboard, click 'Sign Out', and then sign back in! You will then have access to /admin"
        });

    } catch (error: any) {
        console.error("Debug admin err:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
