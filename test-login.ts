import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getAdminAuth } from './src/lib/firebase-admin';

async function run() {
    const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    const email = "easysaleswave@gmail.com";
    const password = "WaveAdmin2026";

    const response = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
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
    const data = await response.json();
    console.log("Login Result:", data);
}

run().catch(console.error);
