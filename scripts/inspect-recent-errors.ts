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

import { db } from "../src/lib/firebase-admin";

async function main() {
    console.log("Fetching recent observability traces from Firestore...");
    const snap = await db.collection("error_observability_traces")
        .orderBy("createdAt", "desc")
        .limit(20)
        .get();

    console.log(`Retrieved ${snap.size} recent traces:`);
    snap.docs.forEach((doc, index) => {
        const data = doc.data();
        console.log(`\n[Trace #${index + 1}] ID: ${doc.id}`);
        console.log(`Timestamp: ${data.timestamp}`);
        console.log(`Module: ${data.affectedModule}`);
        console.log(`Root Cause: ${data.rootCause}`);
        console.log(`Query/Args: ${data.queryOrAction}`);
        if (data.userState) console.log(`User State: ${data.userState}`);
        if (data.sessionContext) console.log(`Session Context: ${JSON.stringify(data.sessionContext)}`);
    });
}

main().catch(console.error);
