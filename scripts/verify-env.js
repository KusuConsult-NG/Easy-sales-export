const fs = require('fs');
const path = require('path');

// Try to load .env.local
try {
    const envLocalPath = path.resolve(process.cwd(), '.env.local');
    if (fs.existsSync(envLocalPath)) {
        require('dotenv').config({ path: envLocalPath });
    }
} catch (e) {
    console.log("Could not load .env.local via dotenv");
}

console.log("Checking Environment Variables...");

const requiredPublic = [
    "NEXT_PUBLIC_FIREBASE_API_KEY",
    "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
    "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
    "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
    "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
    "NEXT_PUBLIC_FIREBASE_APP_ID"
];

const requiredServer = [
    "FIREBASE_PROJECT_ID",
    "FIREBASE_CLIENT_EMAIL",
    "FIREBASE_PRIVATE_KEY",
    "NEXTAUTH_SECRET",
    "NEXTAUTH_URL",
];

console.log("\n--- Client-Side Variables ---");
requiredPublic.forEach(key => {
    const val = process.env[key];
    console.log(`${key}: ${val ? "✅ Present" : "❌ MISSING"} ${val ? `(Value starts with: ${val.substring(0, 5)}...)` : ""}`);
});

console.log("\n--- Server-Side Variables ---");
requiredServer.forEach(key => {
    const val = process.env[key];
    console.log(`${key}: ${val ? "✅ Present" : "❌ MISSING"} ${val ? `(Value starts with: ${val.substring(0, 5)}...)` : ""}`);
});

if (process.env.FIREBASE_PRIVATE_KEY) {
    console.log(`\nFIREBASE_PRIVATE_KEY Check:`);
    console.log(`Length: ${process.env.FIREBASE_PRIVATE_KEY.length}`);
    console.log(`Contains actual newline characters: ${process.env.FIREBASE_PRIVATE_KEY.includes('\n')}`);
    console.log(`Contains escaped newline literal (\\n): ${process.env.FIREBASE_PRIVATE_KEY.includes('\\n')}`);
}

console.log("\nDone.");
