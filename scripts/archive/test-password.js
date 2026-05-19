require('dotenv').config({ path: '.env.local' });
async function test() {
    const key = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    console.log("Key length:", key ? key.length : "missing");
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${key}`, {
        method: 'POST',
        body: JSON.stringify({
            email: "test@example.com",
            password: "wrongpassword123",
            returnSecureToken: true
        }),
        headers: { 'Content-Type': 'application/json' }
    });
    console.log("Status:", res.status);
    const data = await res.json();
    console.log("Data:", data);
}
test();
