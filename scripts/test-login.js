import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function testLogin() {
    const email = 'admin.easysalesexport@gmail.com';
    const password = 'Admin@2026'; // Provided by user in a previous conversation

    const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, returnSecureToken: true })
        });
        const data = await response.json();
        
        if (!response.ok) {
            console.error('Login failed:', data.error.message);
        } else {
            console.log('Login succeeded! UID:', data.localId);
        }
    } catch (e) {
        console.error('Fetch error:', e);
    }
}

testLogin();
