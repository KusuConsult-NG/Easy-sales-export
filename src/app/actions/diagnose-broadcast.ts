"use server";

import { getAdminDb } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { requireAdmin } from "@/lib/require-admin";
import { dataLayerTarget } from "@/lib/env-validator";

/**
 * Quick diagnostic action to check if the broadcast system can read users.
 * Call from any admin page or browser console via fetch.
 */
export async function diagnoseBroadcastAction(): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const sessionResult = await requireAdmin("announcements:manage");
        if ('error' in sessionResult) return { success: false as const, usersCollectionName: COLLECTIONS.USERS, totalUserDocs: 0, usersWithEmail: 0, sampleFields: [], error: sessionResult.error, data: null };

        const db = getAdminDb();
        const collectionName = COLLECTIONS.USERS;
        
        // Get a small sample of users
        const snap = await db.collection(collectionName).limit(5).get();
        
        let sampleFields: string[] = [];
        snap.forEach((doc) => {
            if (sampleFields.length === 0) {
                sampleFields = Object.keys(doc.data());
            }
        });

        // 1. Check total users count using aggregation (fast)
        const totalCountSnapshot = await db.collection(collectionName).count().get();
        const totalUserDocs = totalCountSnapshot.data().count;

        // 2. Check users with email count (fast)
        const emailCountSnapshot = await db.collection(collectionName).where("email", ">", "").count().get();
        const usersWithEmail = emailCountSnapshot.data().count;

        return { 
            error: null, 
            success: true as const, 
            // #511's second door. This read FIREBASE_PROJECT_ID, which nothing
            // sets — Firebase is shimmed to Supabase — so the one field naming
            // WHICH database the counts below came from said "(not set)" on
            // every call. dataLayerTarget() names the project the reads
            // actually went to, from the NEXT_PUBLIC_ URL. No key is exposed.
            projectId: dataLayerTarget(),
            usersCollectionName: collectionName, 
            totalUserDocs, 
            usersWithEmail, 
            sampleFields, 
            data: null 
        };
    } catch (error: any) { return { success: false as const, usersCollectionName: COLLECTIONS.USERS, totalUserDocs: 0, usersWithEmail: 0, sampleFields: [], error: error.message, data: null };
    }
}
