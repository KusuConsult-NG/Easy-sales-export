const admin = require('firebase-admin');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined;

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey,
        }),
    });
}

const db = admin.firestore();
const auth = admin.auth();
const COLLECTIONS = { USERS: 'users' };

const accounts = [
    // WAVE
    { email: 'easysaleswave@gmail.com', password: 'WAVE@2026', type: 'admin', role: 'wave_admin' },
    { email: 'waveuser02@gmail.com', password: 'WAVE@2026', type: 'user' },
    // Cooperative
    { email: 'easysalescooperative@gmail.com', password: 'Cooperative@2026', type: 'admin', role: 'cooperative_admin' },
    { email: 'cooperativeuser02@gmail.com', password: 'Cooperative@2026', type: 'user' },
    // Marketplace
    { email: 'easysalesmarketplace@gmail.com', password: 'Marketplace@2026', type: 'admin', role: 'marketplace_admin' },
    { email: 'marketplaceuser04@gmail.com', password: 'Marketplace@2026', type: 'user' },
    // Exportwindow
    { email: 'easysalesexportwindow@gmail.com', password: 'Exportwindow@2026', type: 'admin', role: 'export_admin' },
    { email: 'exportwindowuser@gmail.com', password: 'Exportwindow@2026', type: 'user' },
    // Farmnation
    { email: 'easysalesfarmnation@gmail.com', password: 'Farmnation@2026', type: 'admin', role: 'farmnation_admin' },
    { email: 'farmnationuser@gmail.com', password: 'Farmnation@2026', type: 'user' },
    // Academy
    { email: 'academy.easysalesexport1@gmail.com', password: '@2025Easysales!', type: 'admin', role: 'academy_admin' },
    { email: 'academyuser02@gmail.com', password: '@2025Easysales!', type: 'user' }
];

async function run() {
    for (const acc of accounts) {
        let userRecord;
        try {
            userRecord = await auth.getUserByEmail(acc.email);
            await auth.updateUser(userRecord.uid, { password: acc.password });
            console.log(`Updated user: ${acc.email}`);
        } catch (e) {
            if (e.code === 'auth/user-not-found') {
                userRecord = await auth.createUser({
                    email: acc.email,
                    password: acc.password,
                    emailVerified: true
                });
                console.log(`Created user: ${acc.email}`);
            } else {
                console.error(`Error with ${acc.email}:`, e);
                continue;
            }
        }

        const roles = acc.type === 'admin' ? [acc.role, "admin_dashboard_access"] : ["user"];
        
        // Also set custom claims (useful for JWT checks)
        if (acc.type === 'admin') {
            await auth.setCustomUserClaims(userRecord.uid, { admin: true, role: acc.role, roles });
        }

        const name = acc.type === 'admin' ? `Admin (${acc.role})` : `Test User (${acc.email.split('@')[0]})`;

        await db.collection(COLLECTIONS.USERS).doc(userRecord.uid).set({
            email: acc.email,
            emailAddress: acc.email,
            fullName: name,
            name: name,
            roles: roles,
            role: acc.type === 'admin' ? acc.role : 'user', // legacy fields
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            createdAt: admin.firestore.FieldValue.serverTimestamp() // might overwrite but fine for setup script
        }, { merge: true });
        
        console.log(`Set Firestore roles for ${acc.email} -> ${roles.join(', ')}`);
    }
    
    console.log("All accounts provisioned successfully.");
    process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
