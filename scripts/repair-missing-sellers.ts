import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { db } from '../src/lib/firebase-admin';

async function repair() {
    const snap = await db.collection("seller_verifications").get();
    
    // Get latest status for each user
    const userStatusMap = new Map<string, { status: string, id: string }>();
    snap.docs.forEach(d => {
        const data = d.data();
        const existing = userStatusMap.get(data.userId);
        // If there are multiple, pending takes precedence? Or approved? Let's say approved > pending > rejected
        if (!existing || data.status === 'approved' || (data.status === 'pending' && existing.status !== 'approved')) {
            userStatusMap.set(data.userId, { status: data.status, id: d.id });
        }
    });

    const userIdsArr = Array.from(userStatusMap.keys());
    let repaired = 0;

    for (let i = 0; i < userIdsArr.length; i += 50) {
        const chunk = userIdsArr.slice(i, i + 50);
        const uRefs = chunk.map(id => db.collection("users").doc(id));
        const uDocs = await db.getAll(...uRefs);
        
        const batch = db.batch();
        let batchCount = 0;

        uDocs.forEach(doc => {
            if (doc.exists) {
                const data = doc.data() as any;
                const mReg = data.serviceRegistrations?.marketplace;
                
                const isMatched = (
                    data.marketplaceAccountType === "seller" || 
                    data.marketplaceAccountType === "both" || 
                    (data.roles && data.roles.includes("seller")) ||
                    data.isSeller ||
                    data.sellerVerificationStatus ||
                    (mReg && (mReg.accountType === "seller" || mReg.accountType === "both" || mReg.sellerCategory))
                );

                if (!isMatched) {
                    // Repair this user
                    const mappedInfo = userStatusMap.get(doc.id)!;
                    batch.update(doc.ref, {
                        isSeller: true,
                        sellerVerificationStatus: mappedInfo.status,
                        sellerVerificationId: mappedInfo.id,
                        updatedAt: new Date()
                    });
                    batchCount++;
                    repaired++;
                }
            }
        });

        if (batchCount > 0) {
            await batch.commit();
        }
    }
    
    console.log(`Repaired ${repaired} missing seller profiles in USERS collection.`);
}

repair().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
