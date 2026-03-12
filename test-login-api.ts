import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env.local') });
dotenv.config({ path: resolve(process.cwd(), '.env') });

const email = "steviekusu@gmail.com";
const password = "Password123!"; 

async function testNextAuth() {
    try {
        const res = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + process.env.NEXT_PUBLIC_FIREBASE_API_KEY, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                email,
                password,
                returnSecureToken: true
            })
        });

        const data = await res.json();
        console.log("Status:", res.status);
        if (!res.ok) {
            console.log("Firebase Error:", data);
        } else {
            console.log("Firebase Success. Local ID:", data.localId);
        }
    } catch (e) {
        console.error("Test Error:", e);
    }
}

testNextAuth();
