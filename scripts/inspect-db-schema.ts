import fs from 'fs';
import path from 'path';

// Load .env.local manually
try {
    const envPath = path.resolve(__dirname, '../.env.local');
    if (fs.existsSync(envPath)) {
        const envConfig = fs.readFileSync(envPath, 'utf8');
        envConfig.split('\n').forEach(line => {
            const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
            if (match) {
                const key = match[1];
                let value = match[2] || '';
                if (value.startsWith('"') && value.endsWith('"')) {
                    value = value.substring(1, value.length - 1);
                } else if (value.startsWith("'") && value.endsWith("'")) {
                    value = value.substring(1, value.length - 1);
                }
                value = value.replace(/\\n/g, '\n');
                process.env[key] = value;
            }
        });
    }
} catch (e) {
    console.error("Failed to load .env.local:", e);
}

import { db } from "../src/lib/firebase-admin";

async function main() {
    const collections = [
        "users",
        "cooperative_members",
        "wave_applications",
        "farm_nation_applications",
        "academy_applications",
        "seller_verifications"
    ];

    for (const col of collections) {
        try {
            const snap = await db.collection(col).limit(5).get();
            console.log(`\n=== Collection: ${col} ===`);
            console.log(`Total returned (limit 5): ${snap.docs.length}`);
            
            const countSnap = await db.collection(col).count().get();
            console.log(`Total count in DB: ${countSnap.data().count}`);
            
            snap.docs.forEach((doc, idx) => {
                const data = doc.data();
                console.log(`Doc #${idx + 1} (${doc.id}):`);
                console.log(` - fields: ${Object.keys(data).join(', ')}`);
                console.log(` - createdAt: ${data.createdAt ? (data.createdAt.toDate ? data.createdAt.toDate().toISOString() : data.createdAt) : 'MISSING'}`);
                console.log(` - submittedAt: ${data.submittedAt ? (data.submittedAt.toDate ? data.submittedAt.toDate().toISOString() : data.submittedAt) : 'MISSING'}`);
                console.log(` - status: ${data.status || data.membershipStatus || data.verificationStatus || 'MISSING'}`);
                console.log(` - userId: ${data.userId || 'MISSING'}`);
            });
        } catch (e: any) {
            console.error(`Error inspecting collection ${col}:`, e.message);
        }
    }
}

main();
