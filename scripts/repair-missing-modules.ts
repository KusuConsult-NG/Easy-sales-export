import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { db } from '../src/lib/firebase-admin';

const MODULES_TO_SYNC = [
    { collection: "wave_applications", key: "wave" },
    { collection: "academy_applications", key: "academy" },
    { collection: "farm_nation_applications", key: "farm_nation" },
    { collection: "export_applications", key: "export" },
];

async function run() {
    console.log("Starting remaining module synchronization...");
    let totalRepaired = 0;

    for (const mod of MODULES_TO_SYNC) {
        console.log(`Processing collection: ${mod.collection} -> regs.${mod.key}`);
        const snap = await db.collection(mod.collection).get();
        
        const userStatusMap = new Map<string, any>();
        snap.docs.forEach(doc => {
            const data = doc.data();
            const userId = data.userId;
            if (userId) {
                userStatusMap.set(userId, {
                    status: data.status || data.membershipStatus || "pending",
                    id: doc.id
                });
            }
        });

        const userIds = Array.from(userStatusMap.keys());
        console.log(`Found ${userIds.length} unique users in ${mod.collection}`);
        
        let moduleRepaired = 0;
        
        // Use chunks of 30 to avoid timeout
        for (let i = 0; i < userIds.length; i += 30) {
            try {
                const chunk = userIds.slice(i, i + 30);
                const uRefs = chunk.map(id => db.collection("users").doc(id));
                const uDocs = await db.getAll(...uRefs);
                
                const batch = db.batch();
                let batchCount = 0;
                
                uDocs.forEach(doc => {
                    if (doc.exists) {
                        const data = doc.data() as any;
                        const regs = data.serviceRegistrations || {};
                        const mReg = regs[mod.key] || regs[mod.key.replace("_", "")] || null;
                        const mappedInfo = userStatusMap.get(doc.id);
                        
                        if (!mReg || mReg.status !== mappedInfo.status) {
                            const newRegs = { ...regs };
                            newRegs[mod.key] = {
                                ...mReg,
                                status: mappedInfo.status,
                                applicationId: mappedInfo.id,
                                onboardedAt: mReg?.onboardedAt || new Date().toISOString()
                            };
                            
                            batch.update(doc.ref, { 
                                serviceRegistrations: newRegs,
                                updatedAt: new Date()
                            });
                            batchCount++;
                            moduleRepaired++;
                        }
                    }
                });
                
                if (batchCount > 0) {
                    await batch.commit();
                }
            } catch(e: any) {
                console.log(`Error at chunk ${i}: ${e.message}`);
                // Sleep and retry
                await new Promise(r => setTimeout(r, 2000));
            }
        }
        
        console.log(`Repaired ${moduleRepaired} users for module ${mod.key}`);
        totalRepaired += moduleRepaired;
    }

    console.log(`\nSynchronization complete! Total repaired profiles: ${totalRepaired}`);
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
