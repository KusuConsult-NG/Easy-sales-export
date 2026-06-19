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

// Now import from firebase-admin. This should trigger the registration log!
import { db } from "../src/lib/firebase-admin";

async function runTest() {
    try {
        console.log("\n--- Test 1: Single Doc Get ---");
        const docSnap = await db.collection("error_observability_traces").doc("nonexistent").get();
        console.log("Get doc success. Exists:", docSnap.exists);

        console.log("\n--- Test 2: Query Get ---");
        const querySnap = await db.collection("error_observability_traces").limit(1).get();
        console.log("Query success. Size:", querySnap.size);

        console.log("\n--- Test 3: Write ---");
        await db.collection("error_observability_traces_test").doc("temp_doc").set({ val: 42 });
        console.log("Write success.");

        console.log("\n--- Test 4: Delete ---");
        await db.collection("error_observability_traces_test").doc("temp_doc").delete();
        console.log("Delete success.");
    } catch (error: any) {
        console.error("Test failed:", error);
    }
}

runTest().catch(console.error);
