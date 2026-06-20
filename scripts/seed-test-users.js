require("dotenv").config({ path: ".env.local" });
const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

let privateKey = process.env.FIREBASE_PRIVATE_KEY;
if (privateKey && privateKey.startsWith('"') && privateKey.endsWith('"')) {
    privateKey = privateKey.slice(1, -1);
}
if (privateKey && privateKey.includes('\\n')) {
    privateKey = privateKey.replace(/\\n/g, '\n');
}

if (!getApps().length) {
    initializeApp({
        credential: cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: privateKey,
        }),
    });
}

const auth = getAuth();
const db = getFirestore();

const testUsers = [
    {
        email: "waveuser02@gmail.com",
        password: "WAVE@2026",
        module: "wave",
        role: "wave_participant"
    },
    {
        email: "cooperativeuser02@gmail.com",
        password: "Cooperative@2026",
        module: "cooperatives",
        role: "cooperative_member"
    },
    {
        email: "marketplaceuser04@gmail.com",
        password: "Marketplace@2026",
        module: "marketplace",
        role: "buyer"
    },
    {
        email: "exportwindowuser@gmail.com",
        password: "Exportwindow@2026",
        module: "export",
        role: "export_participant"
    },
    {
        email: "farmnationuser@gmail.com",
        password: "Farmnation@2026",
        module: "farmNation",
        role: "farmer"
    },
    {
        email: "academyuser02@gmail.com",
        password: "@2025Easysales!",
        module: "academy",
        role: "academy_participant"
    }
];

async function seedTestUsers() {
    console.log("Seeding test users...");
    for (const u of testUsers) {
        let uid;
        try {
            const userRecord = await auth.getUserByEmail(u.email);
            uid = userRecord.uid;
            console.log(`User ${u.email} already exists in Auth. Updating password...`);
            await auth.updateUser(uid, { password: u.password });
        } catch (error) {
            if (error.code === 'auth/user-not-found') {
                console.log(`Creating user ${u.email}...`);
                const userRecord = await auth.createUser({
                    email: u.email,
                    password: u.password,
                    emailVerified: true,
                    displayName: `Test ${u.module} User`
                });
                uid = userRecord.uid;
            } else {
                console.error(`Error with ${u.email}:`, error);
                continue;
            }
        }

        // Setup Firestore document
        const userRef = db.collection('users').doc(uid);
        const doc = await userRef.get();
        
        if (u.module === "academy") {
            const collectionsToClean = ["enrollments", "academy_enrollments", "course_enrollments"];
            for (const coll of collectionsToClean) {
                try {
                    const snap = await db.collection(coll).where("userId", "==", uid).get();
                    for (const doc of snap.docs) {
                        console.log(`Cleaning up old academy enrollment document in ${coll}: ${doc.id}`);
                        await doc.ref.delete();
                    }
                } catch (e) {
                    console.warn(`Warning cleaning up collection ${coll}:`, e.message);
                }
            }
        }

        let serviceRegistrations = {};
        if (doc.exists && doc.data().serviceRegistrations) {
            serviceRegistrations = doc.data().serviceRegistrations;
        }

        // Approve the specific module
        serviceRegistrations[u.module] = {
            status: "approved",
            approvedAt: new Date().toISOString(),
            appliedAt: new Date().toISOString(),
            notes: "Test user auto-approved"
        };

        const payload = {
            uid: uid,
            email: u.email,
            fullName: `Test ${u.module} User`,
            roles: ["general_user", u.role],
            profileComplete: true,
            isVerified: true,
            verified: true,
            onboardingCompleted: true,
            serviceRegistrations: serviceRegistrations,
            phone: "+2348000000" + Math.floor(Math.random() * 1000).toString().padStart(3, '0'),
            updatedAt: FieldValue.serverTimestamp()
        };

        if (!doc.exists) {
            payload.createdAt = FieldValue.serverTimestamp();
        }

        await userRef.set(payload, { merge: true });
        console.log(`✅ Provisioned ${u.email} for ${u.module} dashboard`);
    }
    console.log("Done seeding.");
}

seedTestUsers().catch(console.error);
