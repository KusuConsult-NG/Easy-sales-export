require('dotenv').config({ path: '.env.production.local' });
const admin = require('firebase-admin');

async function run() {
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;
    if (privateKey.startsWith('"') && privateKey.endsWith('"')) privateKey = privateKey.slice(1, -1);
    // Fixed parsing issue in my previous scripts to be safe
    if (privateKey.includes('\\n')) privateKey = privateKey.replace(/\\n/g, '\n');

    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: privateKey,
        })
    });

    const db = admin.firestore();
    const email = "steviekusu@gmail.com";
    
    // Simulate what getPostLoginRedirect does (since we can't easily mock auth() globally)
    const userSnapshot = await db.collection("users").where('email', '==', email).limit(1).get();
    if(userSnapshot.empty) {
        console.log("User not found!");
        return;
    }
    
    const userData = userSnapshot.docs[0].data();
    const userRoles = userData.roles || ['general_user'];
    const serviceRegistrations = userData.serviceRegistrations || {};

    const approvedModules = Object.entries(serviceRegistrations).filter(([_, reg]) => reg?.status === 'approved');
    
    if (approvedModules.length > 0) {
        console.log("Redirect -> Primary App (Approved)");
        return;
    }

    const pendingModules = Object.entries(serviceRegistrations).filter(([_, reg]) =>
        reg?.status === 'pending' || reg?.status === 'under_review' || reg?.status === 'pending_review'
    );

    if (pendingModules.length > 0) {
        const [moduleKey, _] = pendingModules[0];
        const pendingPageMap = {
            'wave': '/wave/application/review-pending',
            'export': '/export/onboarding/pending',
            'marketplace': '/marketplace/onboarding/pending',
            'cooperatives': '/cooperatives/onboarding/pending',
            'farmNation': '/farm-nation/onboarding/pending',
            'farm_nation': '/farm-nation/onboarding/pending',
            'academy': '/academy/application/pending',
        };
        const pendingPage = pendingPageMap[moduleKey] || '/auth/get-started';
        console.log(`Redirect -> ${pendingPage} (Pending application found for ${moduleKey})`);
        return;
    }

    console.log(`Redirect -> /auth/get-started (No applications found)`);
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
