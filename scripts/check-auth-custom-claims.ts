import { adminAuth } from "../src/lib/firebase-admin";

const CUSTOM_ADMINS = [
    "steviekusu@gmail.com",
    "easysalesexportwindow@gmail.com",
    "kusuconsult@gmail.com",
    "easysalescooperative@gmail.com",
    "easysalesmarketplace@gmail.com",
    "academy.easysalesexport1@gmail.com",
    "easysaleswave@gmail.com",
    "easysalesfarmnation@gmail.com"
];

async function checkAuthClaims() {
    console.log("=== Checking Firebase Auth Custom Claims ===");
    for (const email of CUSTOM_ADMINS) {
        try {
            const user = await adminAuth.getUserByEmail(email);
            console.log(`Email: ${email}`);
            console.log(`  UID: ${user.uid}`);
            console.log(`  Disabled: ${user.disabled}`);
            console.log(`  Email Verified: ${user.emailVerified}`);
            console.log(`  Custom Claims:`, JSON.stringify(user.customClaims || {}, null, 2));
        } catch (e: any) {
            console.log(`Email: ${email}`);
            console.log(`  FAILED: ${e.message}`);
        }
        console.log("-----------------------------------");
    }
    process.exit(0);
}

checkAuthClaims().catch(console.error);
