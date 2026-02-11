"use server";

import { db } from "@/lib/firebase";
import { doc, setDoc, updateDoc, increment, serverTimestamp, getDoc } from "firebase/firestore";
import { auth } from "@/lib/auth";
import { COLLECTIONS } from "@/lib/types/firestore";

/**
 * One-time setup action to create a test cooperative and add the current user as a member
 */
export async function setupTestCooperativeAction() {
    try {
        const session = await auth();
        if (!session?.user) {
            return { error: "You must be logged in", success: false };
        }

        const userId = session.user.id;
        const cooperativeId = "coop-ezichi-farmers";

        // Check if cooperative already exists
        const cooperativeRef = doc(db, COLLECTIONS.COOPERATIVES, cooperativeId);
        const cooperativeDoc = await getDoc(cooperativeRef);

        if (!cooperativeDoc.exists()) {
            // Create the cooperative
            await setDoc(cooperativeRef, {
                id: cooperativeId,
                name: "Ezichi Farmers Cooperative",
                description: "A cooperative society for farmers in the Easy Sales Export community",
                memberCount: 0,
                totalSavings: 0,
                totalLoans: 0,
                monthlyTarget: 50000,
                interestRate: 5,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                status: "active",
            });
        }

        // FIXED: Use cooperative_members collection (not subcollection) to match getMembershipAction
        const memberRef = doc(db, COLLECTIONS.COOPERATIVE_MEMBERS, `${cooperativeId}_${userId}`);
        const memberDoc = await getDoc(memberRef);

        if (memberDoc.exists()) {
            return { error: "You are already a member of this cooperative", success: false };
        }

        // Add user as member with initial savings
        const initialSavings = 100000; // ₦100,000 for testing
        await setDoc(memberRef, {
            userId,
            cooperativeId,
            savingsBalance: initialSavings,
            loanBalance: 0,
            memberSince: serverTimestamp(),
            monthlyTarget: 50000,
            status: "active",
        });

        // Update cooperative totals
        await updateDoc(cooperativeRef, {
            memberCount: increment(1),
            totalSavings: increment(initialSavings),
        });

        // Update user document with cooperativeId
        const userRef = doc(db, COLLECTIONS.USERS, userId);
        const userDoc = await getDoc(userRef);

        if (userDoc.exists()) {
            await updateDoc(userRef, {
                cooperativeId,
                updatedAt: serverTimestamp(),
            });
        }

        return {
            error: null,
            success: true,
            message: "Successfully set up test cooperative! Refresh the page to see your membership.",
        };
    } catch (error: any) {
        console.error("Setup test cooperative error:", error);
        return { error: `Failed to setup cooperative: ${error.message}`, success: false };
    }
}
