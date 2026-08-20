export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { normaliseLoanApplication } from "@/lib/loan-application-location";

/**
 * API Route: Get User's Loan Applications
 */
export async function GET(request: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            );
        }

        const userId = session.user.id;

        // A MEMBER'S OWN APPLICATION DID NOT APPEAR IN THEIR OWN LIST.
        //
        // The page that calls this — /cooperatives/loans — submits through
        // applyForLoanAction, which files into cooperative_loans and keys the
        // borrower `memberId`. This read loan_applications by `userId`, so an
        // application filed on that very page was never in the list rendered
        // underneath the form. The member saw "submitted" and then nothing,
        // indefinitely.
        //
        // Same split the admin queue was fixed for; this is the member's half.
        // See lib/loan-application-location.ts.
        const [generalSnap, coopSnap] = await Promise.all([
            db.collection(COLLECTIONS.LOAN_APPLICATIONS)
                .where("userId", "==", userId)
                .orderBy("appliedAt", "desc")
                .get(),
            db.collection(COLLECTIONS.COOPERATIVE_LOANS)
                .where("memberId", "==", userId)
                .get(),
        ]);

        const applications = [
            ...generalSnap.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                appliedAt: doc.data().appliedAt?.toDate?.() || new Date(),
            })),
            ...coopSnap.docs.map(doc => ({
                ...normaliseLoanApplication(doc.data(), COLLECTIONS.COOPERATIVE_LOANS),
                id: doc.id,
                appliedAt: doc.data().appliedAt?.toDate?.() || doc.data().createdAt?.toDate?.() || new Date(),
            })),
        ].sort((a: any, b: any) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime());

        return NextResponse.json({
            success: true,
            applications
        });
    } catch (error) {
        logger.error("Failed to fetch loan applications:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
