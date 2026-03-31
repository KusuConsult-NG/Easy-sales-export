import { getAdminDb } from "../src/lib/firebase-admin";

function normalisePhone(raw: string | undefined | null): string | null {
    if (!raw) return null;
    let p = String(raw).replace(/\D/g, "");
    if (p.startsWith("0")) p = "234" + p.slice(1);
    // require at least 10 chars (e.g. 234 + 10 digits = 13, but sometimes missing leading zeros?)
    if (p.length < 10) return null;
    return p;
}

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
    const recipients = new Map<string, {name: string, phone: string}>();
    const add = (phone: string, name: string) => {
        const p = normalisePhone(phone);
        if (p && !recipients.has(p)) recipients.set(p, { name, phone: p });
    };

    const snap = await db.collection("failedPayments").get();
    const uMap = await resolveUsers(db, snap.docs.map(d => d.data().userId));
    
    for (const d of snap.docs) {
        const f = d.data();
        if (!f.userId) continue;
        const u = uMap.get(f.userId);
        if (!u) continue;
        if (u.phone || u.phoneNumber) {
            add(u.phone || u.phoneNumber, f.customerName || u.fullName || u.name || "User");
        }
    }

    console.log(`SMS Recipients size: ${recipients.size}`);
    
    // Check in-app logic
    const inAppRecipients = new Map<string, {name: string, userId: string}>();
    const addInApp = (userId: string, name: string) => {
        if (userId && !inAppRecipients.has(userId)) inAppRecipients.set(userId, { name, userId });
    };
    
    for (const d of snap.docs) {
        const f = d.data();
        if (!f.userId) continue;
        addInApp(f.userId, f.customerName || "User");
    }
    
    console.log(`In-App Recipients size: ${inAppRecipients.size}`);
}

run().catch(console.error);
