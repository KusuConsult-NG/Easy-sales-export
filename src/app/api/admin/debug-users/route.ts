export const dynamic = 'force-dynamic';
import { NextResponse } from "next/server";
import { getUsersAction } from "@/app/actions/admin";
import { requireSession } from "@/lib/session-guard";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";

// This route is for debugging only — completely disabled in production
export async function GET() {
    // Block entirely in production
    if (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production') {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Require authenticated admin session even in dev/staging
    const session = (await requireSession()).session;
    if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
    const roles: string[] = userDoc.data()?.roles || [];
    if (!roles.includes('admin') && !roles.includes('super_admin')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    try {
        const result = await getUsersAction({ limit: 5 });
        return NextResponse.json(result);
    } catch (error: any) {
        // Never expose stack traces
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
