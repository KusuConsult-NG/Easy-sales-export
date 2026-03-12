import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });
dotenv.config({ path: resolve(process.cwd(), '.env') });

const email = "steviekusu@gmail.com";
const password = "Password123!"; 

async function testNextAuth() {
    try {
        const { loginSchema } = require('./src/lib/schemas');
        const loginData = loginSchema.parse({ email, password });
        console.log("Validated:", loginData.email);
        
        // Let's test steps 3-4 manually as they are inside authorize
        console.log("Testing auth logic from authorize...");
        const firebaseApiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
        
        // STEP 4
        const response = await fetch(
            `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseApiKey}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email,
                    password,
                    returnSecureToken: true
                })
            }
        );

        const responseData = await response.json();
        console.log("Firebase login result ok:", response.ok);
        if(!response.ok) {
            console.log("Firebase Error:", responseData);
            return;
        }
        
        const uid = responseData.localId;
        console.log("UID:", uid);

        // STEP 6: fetch from cache/DB
        const { getUserProfile } = await import("./src/lib/user-cache");
        const cachedProfile = await getUserProfile(uid);
        console.log("Cached Profile Exists:", !!cachedProfile, cachedProfile?.roles);
        
        // STEP 8
        if (cachedProfile) {
            if ((cachedProfile as any).isBanned === true || (cachedProfile as any).status === 'banned' || (cachedProfile as any).suspended === true) {
                 console.log("User banned/suspended check trigger.");
            } else {
                 console.log("User banned/suspended check PASSED locally.");
            }
        } else {
            console.log("Profile missing entirely!");
        }

    } catch (e) {
        console.error("Authorize Test Error:", e);
    }
}

testNextAuth();
