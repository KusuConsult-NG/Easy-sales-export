import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { db } from '../src/lib/firebase-admin';

async function check() {
    console.log("Fetching users from March 8, 2026 to March 24, 2026...");
    
    // JS dates
    const startDate = new Date('2020-03-08T00:00:00Z');
    const endDate = new Date('2027-03-24T23:59:59Z');
    
    // We can fetch all and filter client side to avoid missing index issues
    const snapshot = await db.collection('users').get();
    
    let totalInPeriod = 0;
    let verifiedCount = 0;
    let bvnCount = 0;
    let ninCount = 0;
    let mockVerifiedCount = 0;
    let attemptedBvnCount = 0;
    
    snapshot.forEach(doc => {
        const data = doc.data();
        if (!data.createdAt) return;
        
        const createdAt = data.createdAt.toDate ? data.createdAt.toDate() : new Date(data.createdAt);
        
        if (createdAt >= startDate && createdAt <= endDate) {
            totalInPeriod++;
            const kyc = data.kyc || {};
            
            if (kyc.bvn && kyc.bvn.length > 5) attemptedBvnCount++;

            if (kyc.status === 'verified' || data.kycVerified === true) {
                verifiedCount++;
            }
            if (kyc.bvnVerified === true) {
                bvnCount++;
            }
            if (kyc.ninVerified === true) {
                ninCount++;
            }
            // People add a mock flag or dummy BVN
            if (kyc.bvn === '11111111111' || kyc.nin === '11111111111' || kyc.bvn === '22222222222' || kyc.bvn?.startsWith('123')) {
                mockVerifiedCount++;
            }
        }
    });
    
    console.log(`Found ${totalInPeriod} users registered in this period.`);
    console.log(`Users who submitted a BVN (attempted): ${attemptedBvnCount}`);
    console.log(`Overall KYC Verified: ${verifiedCount}`);
    console.log(`BVN Verified: ${bvnCount}`);
    console.log(`NIN Verified: ${ninCount}`);
    console.log(`Likely Mock/Dummy IDs used: ${mockVerifiedCount}`);
}

check().catch(console.error);
