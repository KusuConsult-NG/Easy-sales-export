"use server";

import { db } from "@/lib/firebase-admin";
import { logger } from '@/lib/logger';
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";

/**
 * One-time setup action to create a test cooperative and add the current user as a member
 */
export async function setupTestCooperativeAction() {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;

        const userId = session.user.id;
        const cooperativeId = "coop-ezichi-farmers";

        // Check if cooperative already exists
        const cooperativeRef = db.collection(COLLECTIONS.COOPERATIVES).doc(cooperativeId);
        const cooperativeDoc = await cooperativeRef.get();

        if (!cooperativeDoc.exists) {
            // Create the cooperative
            await cooperativeRef.set({
                id: cooperativeId,
                name: "Ezichi Farmers Cooperative",
                description: "A cooperative society for farmers in the Easy Sales Export community",
                memberCount: 0,
                totalSavings: 0,
                totalLoans: 0,
                monthlyTarget: 50000,
                interestRate: 5,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                status: "active",
            });
        }

        // FIXED: Use cooperative_members collection (not subcollection) to match getMembershipAction
        const memberRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(`${cooperativeId}_${userId}`);
        const memberDoc = await memberRef.get();

        if (memberDoc.exists) {
            return { error: "You are already a member of this cooperative", success: false };
        }

        // Add user as member with initial savings
        const initialSavings = 100000; // ₦100,000 for testing
        await memberRef.set({
            userId,
            cooperativeId,
            savingsBalance: initialSavings,
            loanBalance: 0,
            memberSince: FieldValue.serverTimestamp(),
            monthlyTarget: 50000,
            status: "active",
        });

        // Update cooperative totals
        await cooperativeRef.update({
            memberCount: FieldValue.increment(1),
            totalSavings: FieldValue.increment(initialSavings),
        });

        // Update user document with cooperativeId
        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const userDoc = await userRef.get();

        if (userDoc.exists) {
            await userRef.update({
                cooperativeId,
                updatedAt: FieldValue.serverTimestamp(),
            });
        }

        return {
            error: null,
            success: true,
            message: "Successfully set up test cooperative! Refresh the page to see your membership.",
        };
    } catch (error: any) {
        logger.error("Setup test cooperative error:", error);
        return { error: `Failed to setup cooperative: ${error.message}`, success: false };
    }
}
