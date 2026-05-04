const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

async function updateUserGender() {
    const email = "waveuser02@gmail.com";
    const usersRef = db.collection("users");
    const snapshot = await usersRef.where("email", "==", email).get();

    if (snapshot.empty) {
        console.log("No user found with email:", email);
        process.exit(1);
    }

    const userDoc = snapshot.docs[0];
    await userDoc.ref.update({
        gender: "female",
        profileComplete: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`Successfully updated user ${email} (${userDoc.id}) to gender: female`);
    process.exit(0);
}

updateUserGender().catch(console.error);
