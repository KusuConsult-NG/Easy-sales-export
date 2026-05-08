"use server";

import { getAdminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { requireAdmin } from "@/lib/require-admin";

/**
 * Quick diagnostic action to check if the broadcast system can read users.
 * Call from any admin page or browser console via fetch.
 */
export async function diagnoseBroadcastAction(): Promise<{
    success: true | false;
    projectId?: string;
    usersCollectionName: string;
    totalUserDocs: number;
    usersWithEmail: number;
    sampleFields: string[];
    error?: string;
}> {
    try {
        const sessionResult = await requireAdmin();
        if ('error' in sessionResult) return { 
            success: false as const, 
            usersCollectionName: COLLECTIONS.USERS,
            totalUserDocs: 0,
            usersWithEmail: 0,
            sampleFields: [],
            error: sessionResult.error 
        };

        const db = getAdminDb();
        const collectionName = COLLECTIONS.USERS;
        
        // Get a small sample of users
        const snap = await db.collection(collectionName).limit(5).get();
        
        let usersWithEmail = 0;
        let sampleFields: string[] = [];
        
        snap.forEach((doc) => {
            const data = doc.data();
            if (sampleFields.length === 0) {
                sampleFields = Object.keys(data);
            }
            if (data.email) usersWithEmail++;
        });

        // Get total count
        const countSnap = await db.collection(collectionName).count().get();
        const totalCount = countSnap.data().count;

        return { success: true as const, projectId: process.env.FIREBASE_PROJECT_ID || "(not set)",
            usersCollectionName: collectionName,
            totalUserDocs: totalCount,
            usersWithEmail,
            sampleFields };
    } catch (error: any) {
        return {
            success: false as const,
            usersCollectionName: COLLECTIONS.USERS,
            totalUserDocs: 0,
            usersWithEmail: 0,
            sampleFields: [],
            error: error.message,
        };
    }
}
