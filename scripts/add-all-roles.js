/**
 * Add comprehensive roles to user account for full platform access
 * Run with: node scripts/add-all-roles.js <user-email>
 */

const admin = require('firebase-admin');
const serviceAccount = require('../service-account-key.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

async function addAllRolesToUser(email) {
    try {
        console.log(`🔍 Finding user with email: ${email}`);

        // Find user by email
        const usersRef = db.collection('users');
        const snapshot = await usersRef.where('email', '==', email).limit(1).get();

        if (snapshot.empty) {
            console.error(`❌ User with email ${email} not found`);
            process.exit(1);
        }

        const userDoc = snapshot.docs[0];
        const userId = userDoc.id;
        const currentData = userDoc.data();

        console.log(`✅ Found user: ${userId}`);
        console.log(`📋 Current roles: ${JSON.stringify(currentData.roles || [])}`);

        // Add all roles for full platform access
        const allRoles = [
            "general_user",       // Dashboard, Academy
            "buyer",              // Marketplace buying
            "seller",             // Marketplace selling
            "export_participant", // Export Windows
            "cooperative_member", // Cooperatives
            "farmer",             // Farm Nation
            "land_owner",         // Farm Nation
            "investor",           // Farm Nation
        ];

        await userDoc.ref.update({
            roles: allRoles,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log(`\n✅ Successfully updated roles for: ${email}`);
        console.log(`   User ID: ${userId}`);
        console.log(`\n📋 New roles:`);
        allRoles.forEach(role => console.log(`   ✓ ${role}`));
        console.log(`\n🎉 User can now access:`);
        console.log(`   ✓ Dashboard`);
        console.log(`   ✓ Marketplace (buy & sell)`);
        console.log(`   ✓ Export Windows`);
        console.log(`   ✓ Cooperatives`);
        console.log(`   ✓ Farm Nation`);
        console.log(`   ✓ Academy`);

    } catch (error) {
        console.error('❌ Error adding roles:', error);
        process.exit(1);
    } finally {
        process.exit(0);
    }
}

const email = process.argv[2];
if (!email) {
    console.error('❌ Usage: node scripts/add-all-roles.js <user-email>');
    process.exit(1);
}

addAllRolesToUser(email);
