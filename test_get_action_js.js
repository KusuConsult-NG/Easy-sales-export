const admin = require('firebase-admin');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    })
  });
}

const db = admin.firestore();

async function run() {
    const fetchLimit = 5000;
    let q = db.collection('academy_applications').orderBy("submittedAt", "desc");
    q = q.limit(fetchLimit);

    const snapshot = await q.get();
    
    // serializeDocs equivalent
    const applications = snapshot.docs.map(doc => {
        const d = doc.data();
        return {
            id: doc.id,
            userId: d.userId,
            status: d.status,
            personalInfo: d.personalInfo,
            // other fields
        };
    });

    const userIds = [...new Set(applications.map(app => app.userId).filter(Boolean))];
    const userMap = new Map();
    
    for (let i = 0; i < userIds.length; i += 30) {
        const chunk = userIds.slice(i, i + 30);
        if (chunk.length > 0) {
            const userSnaps = await db.collection('users').where(admin.firestore.FieldPath.documentId(), "in", chunk).get();
            userSnaps.docs.forEach(d => userMap.set(d.id, d.data()));
        }
    }

    const standardForms = applications.map((app) => {
        const uData = (userMap.get(app.userId) || {});
        return {
            id: app.id,
            user: {
                id: app.userId,
                name: uData.firstName ? `${uData.firstName} ${uData.lastName || ''}`.trim() : (uData.name || "Unknown User"),
            },
            status: app.status || "pending",
        };
    });

    console.log("standardForms length:", standardForms.length);

    let finalForms = standardForms;
    console.log("finalForms length:", finalForms.length);

    const counts = { pending: 0, under_review: 0, approved: 0, rejected: 0 };
    finalForms.forEach(a => { counts[a.status] = (counts[a.status] ?? 0) + 1; });
    console.log("Counts map:", counts);
    console.log("Sum:", Object.values(counts).reduce((a, b) => a + b, 0));
}

run().catch(console.error).then(() => process.exit(0));
