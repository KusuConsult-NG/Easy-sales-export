import fs from 'fs';
import path from 'path';

// Load .env.production.local manually
try {
    const envPath = path.resolve(__dirname, '../.env.production.local');
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
        console.log("Loaded .env.production.local successfully.");
    }
} catch (e) {
    console.error("Failed to load environment:", e);
}

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

async function testWithSettings(preferRest: boolean) {
    console.log(`\n--- Testing with preferRest = ${preferRest} ---`);
    
    // Reset any existing apps to avoid initialization conflicts
    const apps = getApps();
    for (const app of apps) {
        await app.delete();
    }
    
    let privateKey = process.env.FIREBASE_PRIVATE_KEY!;
    if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
        privateKey = privateKey.slice(1, -1);
    }
    if (privateKey.includes('\\n')) {
        privateKey = privateKey.replace(/\\n/g, '\n');
    }

    const app = initializeApp({
        credential: cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: privateKey,
        })
    });

    const db = getFirestore(app);
    db.settings({ preferRest, ignoreUndefinedProperties: true });

    try {
        console.log("Sending query to Firestore...");
        const start = Date.now();
        const snap = await db.collection("error_observability_traces").limit(1).get();
        console.log(`Query succeeded in ${Date.now() - start}ms. Found ${snap.size} documents.`);
    } catch (error: any) {
        console.error("Query failed:", error);
    } finally {
        await app.delete();
    }
}

async function main() {
    await testWithSettings(true);
    await testWithSettings(false);
}

main().catch(console.error);
