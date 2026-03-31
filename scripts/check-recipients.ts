import { getAdminDb } from "../src/lib/firebase-admin";

async function resolveUsers(db: FirebaseFirestore.Firestore, userIds: string[]) {
    const compact = Array.from(new Set(userIds.filter(Boolean)));
    const map = new Map<string, any>();
    for (let i = 0; i < compact.length; i += 100) {
        const batch = compact.slice(i, i + 100).map((id) => db.collection("users").doc(id));
        if (batch.length === 0) continue;
        const snaps = await db.getAll(...batch);
        for (const snap of snaps) {
            if (snap.exists) map.set(snap.id, snap.data());
        }
    }
    return map;
}

async function run() {
    const db = getAdminDb();
    
    const recipients = new Map<string, {name: string, email: string}>();
    const add = (email: string, name: string) => {
        if (email && !recipients.has(email)) recipients.set(email, { name, email });
    };

    const snap = await db.collection("failedPayments").get();
    const uMap = await resolveUsers(db, snap.docs.map(d => d.data().userId));
    
    let dbCount = 0;
    let customerEmailCount = 0;
    let uEmailCount = 0;
    
    for (const d of snap.docs) {
        const f = d.data();
        const u = f.userId ? uMap.get(f.userId) : null;
        
        dbCount++;
        
        const email = f.customerEmail;
        if (email) {
            add(email, f.customerName || "User");
            customerEmailCount++;
        } else if (u && (u.email || u.emailAddress)) {
            add(u.email || u.emailAddress, u.fullName || u.name || "User");
            uEmailCount++;
        }
    }

    console.log(`dbCount: ${dbCount}`);
    console.log(`customerEmailCount: ${customerEmailCount}`);
    console.log(`uEmailCount: ${uEmailCount}`);
    console.log(`Recipients size: ${recipients.size}`);
}

run().catch(console.error);
