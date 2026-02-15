/**
 * Set Admin Role Script
 * 
 * Automatically grants admin access to a user by updating their role in Firestore.
 * 
 * Usage: node scripts/set-admin-role.js <email> [role]
 * 
 * Examples:
 *   node scripts/set-admin-role.js admin@example.com super_admin
 *   node scripts/set-admin-role.js user@example.com admin
 * 
 * Roles: super_admin, admin, moderator, support
 */

require('dotenv').config({ path: '.env.local' });
const admin = require('firebase-admin');

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
};

// Valid admin roles
const VALID_ROLES = ['super_admin', 'admin', 'moderator', 'support'];

// Initialize Firebase Admin
if (!admin.apps.length) {
    try {
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
            }),
        });
        console.log(`${colors.green}✓ Firebase Admin initialized${colors.reset}`);
    } catch (error) {
        console.error(`${colors.red}✗ Failed to initialize Firebase Admin:${colors.reset}`, error.message);
        process.exit(1);
    }
}

const db = admin.firestore();

async function setAdminRole(email, role = 'super_admin') {
    try {
        console.log('\n' + '='.repeat(60));
        console.log(`${colors.blue}Setting Admin Role${colors.reset}`);
        console.log('='.repeat(60) + '\n');

        // Validate role
        if (!VALID_ROLES.includes(role)) {
            throw new Error(`Invalid role: ${role}. Must be one of: ${VALID_ROLES.join(', ')}`);
        }

        console.log(`${colors.yellow}Email:${colors.reset} ${email}`);
        console.log(`${colors.yellow}Role:${colors.reset} ${role}`);
        console.log('');

        // Find user by email
        console.log(`${colors.blue}[1/4]${colors.reset} Searching for user...`);
        const usersSnapshot = await db.collection('users')
            .where('email', '==', email)
            .limit(1)
            .get();

        if (usersSnapshot.empty) {
            throw new Error(`User not found with email: ${email}\n\nPlease ensure the user has registered first at: http://localhost:3000/auth/register`);
        }

        const userDoc = usersSnapshot.docs[0];
        const userId = userDoc.id;
        const userData = userDoc.data();

        console.log(`${colors.green}✓ User found: ${userId}${colors.reset}`);
        console.log(`  Name: ${userData.fullName || 'N/A'}`);
        console.log(`  Current Role: ${userData.role || 'None'}`);
        console.log('');

        // Update user role
        console.log(`${colors.blue}[2/4]${colors.reset} Updating user role to '${role}'...`);
        await db.collection('users').doc(userId).update({
            role: role,
            roles: admin.firestore.FieldValue.arrayUnion(role),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        console.log(`${colors.green}✓ Role updated successfully${colors.reset}`);
        console.log('');

        // Set custom claims for enhanced security
        console.log(`${colors.blue}[3/4]${colors.reset} Setting custom auth claims...`);
        try {
            await admin.auth().setCustomUserClaims(userId, {
                role: role,
                admin: true,
                superAdmin: role === 'super_admin',
            });
            console.log(`${colors.green}✓ Custom claims set${colors.reset}`);
        } catch (claimsError) {
            console.log(`${colors.yellow}⚠ Could not set custom claims (user may need to re-login)${colors.reset}`);
        }
        console.log('');

        // Create admin_users entry for tracking
        console.log(`${colors.blue}[4/4]${colors.reset} Creating admin tracking record...`);
        await db.collection('admin_users').doc(userId).set({
            email: email,
            role: role,
            permissions: getPermissionsForRole(role),
            grantedAt: admin.firestore.FieldValue.serverTimestamp(),
            grantedBy: 'system',
        }, { merge: true });

        console.log(`${colors.green}✓ Admin record created${colors.reset}`);
        console.log('');

        // Success message
        console.log('='.repeat(60));
        console.log(`${colors.green}✓ SUCCESS${colors.reset}`);
        console.log('='.repeat(60));
        console.log('');
        console.log(`${colors.green}Admin access granted!${colors.reset}`);
        console.log('');
        console.log(`${colors.yellow}Next steps:${colors.reset}`);
        console.log(`  1. If user is currently logged in, they need to log out and log back in`);
        console.log(`  2. Go to: ${colors.blue}http://localhost:3000/admin${colors.reset}`);
        console.log(`  3. Sign in with: ${colors.green}${email}${colors.reset}`);
        console.log(`  4. Admin dashboard should now be accessible`);
        console.log('');

    } catch (error) {
        console.error(`${colors.red}✗ Error:${colors.reset}`, error.message);
        process.exit(1);
    } finally {
        // Close Firebase connection
        await admin.app().delete();
    }
}

function getPermissionsForRole(role) {
    // Based on admin-permissions.ts
    const permissions = {
        super_admin: ['*'], // Full access
        admin: ['users:*', 'content:*', 'finance:read', 'config:update'],
        moderator: ['content:moderate', 'users:read'],
        support: ['users:read', 'content:read', 'finance:read'],
    };
    return permissions[role] || [];
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log('');
    console.log(`${colors.blue}Set Admin Role Script${colors.reset}`);
    console.log('');
    console.log(`${colors.yellow}Usage:${colors.reset}`);
    console.log(`  node scripts/set-admin-role.js <email> [role]`);
    console.log('');
    console.log(`${colors.yellow}Roles:${colors.reset}`);
    console.log(`  - super_admin  ${colors.green}(Full system access)${colors.reset}`);
    console.log(`  - admin        ${colors.green}(Standard administrative functions)${colors.reset}`);
    console.log(`  - moderator    ${colors.green}(Content moderation only)${colors.reset}`);
    console.log(`  - support      ${colors.green}(Read-only + user assistance)${colors.reset}`);
    console.log('');
    console.log(`${colors.yellow}Examples:${colors.reset}`);
    console.log(`  node scripts/set-admin-role.js admin@example.com super_admin`);
    console.log(`  node scripts/set-admin-role.js user@example.com admin`);
    console.log('');
    process.exit(0);
}

const email = args[0];
const role = args[1] || 'super_admin';

// Run the script
setAdminRole(email, role);
