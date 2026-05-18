/**
 * reset-all-admins.ts
 */
import { adminAuth, db } from "../src/lib/firebase-admin";

const admins = [
    { email: 'easysaleswave@gmail.com', pass: 'WAVE@2026', role: 'wave_admin' },
    { email: 'easysalesmarketplace@gmail.com', pass: 'Marketplace@2026', role: 'marketplace_admin' },
    { email: 'easysalesexportwindow@gmail.com', pass: 'Exportwindow@2026', role: 'export_admin' },
    { email: 'easysalesfarmnation@gmail.com', pass: 'Farmnation@2026', role: 'farm_nation_admin' },
    { email: 'academy.easysalesexport1@gmail.com', pass: '@2025Easysales!', role: 'academy_admin' }
];

async function run() {
    for (const a of admins) {
        try {
            const user = await adminAuth.getUserByEmail(a.email);
            // 1. Reset password
            await adminAuth.updateUser(user.uid, { password: a.pass });
            
            // 2. Set Custom Claims
            await adminAuth.setCustomUserClaims(user.uid, {
                [a.role]: true,
                role: a.role
            });
            
            // 3. Update Firestore
            await db.collection('users').doc(user.uid).set({
                roles: [a.role, 'admin'],
                isAdmin: true
            }, { merge: true });
            
            console.log('✅ Fully provisioned & password reset:', a.email);
        } catch(e: any) {
            console.error('❌ Failed for', a.email, '->', e.message);
        }
    }
}
run().catch(console.error).finally(()=>process.exit(0));
