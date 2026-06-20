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
    console.log("Searching recent error traces...");
    const snap = await db.collection("error_observability_traces")
        .orderBy("createdAt", "desc")
        .limit(100)
        .get();

    console.log(`Analyzing ${snap.size} traces:`);
    let count = 0;
    snap.docs.forEach((doc) => {
        const data = doc.data();
        const affectedModule = String(data.affectedModule || "").toLowerCase();
        const rootCause = String(data.rootCause || "").toLowerCase();
        const queryOrAction = String(data.queryOrAction || "").toLowerCase();
        
        const matches = affectedModule.includes("product") || affectedModule.includes("land") || affectedModule.includes("market") ||
                        rootCause.includes("product") || rootCause.includes("land") || rootCause.includes("market") ||
                        queryOrAction.includes("product") || queryOrAction.includes("land") || queryOrAction.includes("market");
                        
        if (matches) {
            count++;
            console.log(`\n[Trace Match #${count}] ID: ${doc.id}`);
            console.log(`Timestamp: ${data.timestamp}`);
            console.log(`Module: ${data.affectedModule}`);
            console.log(`Root Cause: ${data.rootCause}`);
            console.log(`Query/Args: ${data.queryOrAction}`);
        }
    });
    console.log(`\nFound ${count} matching traces.`);
}

main().catch(console.error);
