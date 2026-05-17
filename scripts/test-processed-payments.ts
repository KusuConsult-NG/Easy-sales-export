import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { db } from '../src/lib/firebase-admin';

async function test() {
    const paymentsSnap = await db.collection("processedPayments").get();
    console.log(`Total processedPayments: ${paymentsSnap.size}`);
    const paymentsSnap2 = await db.collection("processedPayments").where("type", "==", "cooperative_membership_registration").where("status", "==", "completed").get();
    console.log(`Completed cooperative payments: ${paymentsSnap2.size}`);
}

test().then(() => process.exit(0));
