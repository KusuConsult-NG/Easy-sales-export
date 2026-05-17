import { getAdminDb } from './src/lib/firebase-admin';
import { COLLECTIONS } from './src/lib/types/firestore';

const db = getAdminDb();

async function resolveUsers(db: any, userIds: string[]) {
    const uniqueIds = [...new Set(userIds)].filter(Boolean);
    const uMap = new Map();
    const chunks = [];
    for (let i = 0; i < uniqueIds.length; i += 30) chunks.push(uniqueIds.slice(i, i + 30));
    
    for (const chunk of chunks) {
        if (!chunk.length) continue;
        const uSnap = await db.collection(COLLECTIONS.USERS).where('__name__', 'in', chunk).get();
        for (const doc of uSnap.docs) uMap.set(doc.id, doc.data());
    }
    return uMap;
}

async function run() {
    const stream = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).select("userId", "state", "address", "phone", "phoneNumber", "firstName", "lastName", "name", "membershipStatus", "status").get();
    const userIds: string[] = [];
    const members: any[] = [];
    for (const d of (await stream).docs) {
        const m: any = d.data();
        members.push(m);
        if (m.userId) userIds.push(m.userId);
    }
    
    const uMap = await resolveUsers(db, userIds);
    let count = 0;
    for (const m of members) {
        const uData = m.userId ? uMap.get(m.userId) : null;
        const phone = m.phone || m.phoneNumber || (uData ? uData.phone || uData.phoneNumber : null);
        if (phone) count++;
    }
    console.log('Total cooperative members with phones:', count);
}
run();
