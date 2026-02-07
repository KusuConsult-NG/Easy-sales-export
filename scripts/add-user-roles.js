/**
 * Quick script to add admin roles to a user account
 * Run with: node scripts/add-user-roles.js <user-email>
 */

const admin = require('firebase-admin');
const serviceAccount = require('../service-account-key.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

async function addRolesToUser(email) {
    try {
        // Find user by email
        const usersRef = db.collection('users');
        const snapshot = await usersRef.where('email', '==', email).limit(1).get();

        if (snapshot.empty) {
            console.error(`❌ User with email ${email} not found`);
            return;
        }

        const userDoc = snapshot.docs[0];
        const userId = userDoc.id;

        // Add comprehensive roles
        await userDoc.ref.update({
            roles: [
                "general_user",
                "admin",
                "super_admin"
            ],
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log(`✅ Successfully added admin roles to user: ${email}`);
        console.log(`   User ID: ${userId}`);
        console.log(`   Roles: general_user, admin, super_admin`);

    } catch (error) {
        console.error('❌ Error adding roles:', error);
    } finally {
        process.exit();
    }
}

const email = process.argv[2];
if (!email) {
    console.error('Usage: node scripts/add-user-roles.js <user-email>');
    process.exit(1);
}

addRolesToUser(email);
