import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });
dotenv.config({ path: resolve(process.cwd(), '.env') });

const { auth } = require('./src/lib/auth');
const email = "steviekusu@gmail.com";
const password = "Password123!"; 

async function testAuthorize() {
    try {
        // We can't easily extract authorize to test standalone since it's wrapped in NextAuth, 
        // so we'll simulate what authorize does directly.
        const firebaseApiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
        
        console.log("1. Authenticating with Firebase REST...");
        const response = await fetch(
            `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseApiKey}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password, returnSecureToken: true }),
            }
        );

        const data = await response.json();
        
        if (!response.ok) {
            console.log("Firebase Error:", data);
            return;
        }

        console.log("Firebase Success. Local ID:", data.localId);
        
        console.log("2. Fetching User Profile from Cache/DB...");
        const { getUserProfile } = require('./src/lib/user-cache');
        const userProfile = await getUserProfile(data.localId);

        if (!userProfile) {
             console.log("Error: User profile not found in database.");
             return;
        }

        console.log("User Profile:", userProfile.roles);
        
        if (userProfile.isBanned || userProfile.status === "banned" || userProfile.suspended) {
             console.log("Error: Account suspended.");
        }
        
    } catch (e) {
        console.error("Test Error:", e);
    }
}

testAuthorize();
