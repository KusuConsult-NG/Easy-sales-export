const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const serviceAccount = require('./serviceAccountKey.json'); // Adjust path as needed

// Avoid multiple init
if (!global.firebaseApp) {
    global.firebaseApp = initializeApp({
        credential: cert(serviceAccount)
    });
}

const db = getFirestore();

async function main() {
    try {
        // 1. Cooperative members
        const membersSnap = await db.collection("cooperative_members").get();
        let totalDocs = membersSnap.size;
        let paidMembers = 0;

        // 2. Roles
        const usersSnap = await db.collection("users").where("roles", "array-contains", "cooperative_member").get();
        let approvedMembers = usersSnap.size;

        console.log(`Total cooperative_member docs: ${totalDocs}`);

        membersSnap.forEach(doc => {
            const data = doc.data();
            if (data.paymentStatus === 'completed') {
                paidMembers++;
            }
        });

        console.log(`Paid cooperative members (paymentStatus === 'completed'): ${paidMembers}`);
        console.log(`Approved cooperative members (users with role): ${approvedMembers}`);

        // If there's an issue finding serviceAccountKey, let's gracefully fail and we'll check the config
    } catch (err) {
        console.error(err.message);
    }
}

main();
