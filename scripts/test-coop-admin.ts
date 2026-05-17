import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { db } from '../src/lib/firebase-admin';

async function test() {
    // Replicate how the admin dashboard fetches cooperative members
    const paymentsSnap = await db.collection("processedPayments")
        .where("type", "==", "cooperative_membership_registration")
        .where("status", "==", "completed")
        .get();
        
    const paidUserIds = new Set(paymentsSnap.docs.map(doc => doc.data().userId));
    console.log("Unique paid users in processedPayments:", paidUserIds.size);
}

test().then(() => process.exit(0)).catch(console.error);
