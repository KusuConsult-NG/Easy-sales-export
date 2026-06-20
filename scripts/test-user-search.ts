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

async function testSearch(query: string) {
    console.log(`\nTesting search for: "${query}"`);
    const q = query.trim().toLowerCase();
    const userIds = new Set<string>();

    const start = Date.now();

    // 1. Try email search
    const emailSnap = await db.collection("users")
        .where("email", "==", q)
        .limit(20)
        .get();
    emailSnap.docs.forEach(doc => userIds.add(doc.id));
    console.log(`Email query found: ${emailSnap.docs.length} users`);

    // 2. Try phone search
    const phoneSnap = await db.collection("users")
        .where("phone", "==", query)
        .limit(20)
        .get();
    phoneSnap.docs.forEach(doc => userIds.add(doc.id));
    console.log(`Phone query (phone) found: ${phoneSnap.docs.length} users`);

    const phoneNumberSnap = await db.collection("users")
        .where("phoneNumber", "==", query)
        .limit(20)
        .get();
    phoneNumberSnap.docs.forEach(doc => userIds.add(doc.id));
    console.log(`Phone query (phoneNumber) found: ${phoneNumberSnap.docs.length} users`);

    // 3. Try name prefix query (case-sensitive / capitalized for Firestore since name fields are stored capitalized)
    // We can try capitalizing the first letter of search terms
    const capitalizedQ = query.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
    
    const nameSnap = await db.collection("users")
        .where("fullName", ">=", capitalizedQ)
        .where("fullName", "<=", capitalizedQ + "\uf8ff")
        .limit(20)
        .get();
    nameSnap.docs.forEach(doc => userIds.add(doc.id));
    console.log(`Name prefix query (fullName) found: ${nameSnap.docs.length} users`);

    const firstNameSnap = await db.collection("users")
        .where("firstName", ">=", capitalizedQ)
        .where("firstName", "<=", capitalizedQ + "\uf8ff")
        .limit(20)
        .get();
    firstNameSnap.docs.forEach(doc => userIds.add(doc.id));
    console.log(`Name prefix query (firstName) found: ${firstNameSnap.docs.length} users`);

    console.log(`Total unique user IDs found: ${userIds.size} (Took ${Date.now() - start}ms)`);
    console.log("Found user IDs:", Array.from(userIds));
}

async function main() {
    await testSearch("Tupshak");
    await testSearch("nanretfrancis500@gmail.com");
}

main();
