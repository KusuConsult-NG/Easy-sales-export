import { db } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/lib/types/firestore";

async function checkUser(email: string) {
    console.log(`Checking Firestore for ${email}...`);
    
    try {
        const usersRef = db.collection(COLLECTIONS.USERS);
        const snapshot = await usersRef.where("email", "==", email).get();
        
        if (snapshot.empty) {
            console.error(`User with email ${email} not found.`);
            process.exit(1);
        }
        
        const userDoc = snapshot.docs[0];
        console.log("User ID:", userDoc.id);
        console.log("User Data:", JSON.stringify(userDoc.data(), null, 2));
        process.exit(0);
    } catch (error) {
        console.error("Check failed:", error);
        process.exit(1);
    }
}

const email = process.argv[2] || "farmnationuser@gmail.com";
checkUser(email);
