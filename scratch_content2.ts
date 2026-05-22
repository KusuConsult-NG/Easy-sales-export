import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
if (!privateKey) throw new Error("No private key");

initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: privateKey,
  })
});

const db = getFirestore();

function sanitizeForSerialization(obj: unknown): unknown {
    if (obj === null || obj === undefined) return obj;
    // Firestore Timestamp
    if (typeof obj === "object" && typeof (obj as any).toDate === "function") {
        return (obj as any).toDate().toISOString();
    }
    if (obj instanceof Date) return obj.toISOString();
    if (Array.isArray(obj)) return obj.map(sanitizeForSerialization);
    if (typeof obj === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
            out[k] = sanitizeForSerialization(v);
        }
        return out;
    }
    return obj;
}

async function test() {
    const pendingItems: any[] = [];
    const landQuery = db.collection("land_listings").where("status", "==", "pending_verification").limit(5);
    const landSnap = await landQuery.get();
    
    landSnap.forEach((doc) => {
        try {
            const data = doc.data();
            pendingItems.push({
                id: doc.id,
                type: "land",
                title: data.title || "Untitled Land",
                submittedBy: data.ownerName || data.ownerEmail || data.ownerId || "Unknown Owner",
                submittedAt: (data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt || Date.now())).toISOString(),
                status: "pending",
                description: `${data.size} ${data.unit} at ${data.state}, ${data.lga}`,
                metadata: sanitizeForSerialization(data) as Record<string, unknown>,
            });
        } catch (e: any) {
            console.error("Error processing doc", doc.id, e.message);
        }
    });
    
    console.log("Successfully fetched", pendingItems.length, "items");
}
test().catch(console.error);
