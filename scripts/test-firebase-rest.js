require('dotenv').config({ path: '.env.production.local' });

async function testFirebaseRestAPI() {
    console.log("Testing Firebase REST API with Production Key...");
    const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    console.log("API Key found:", apiKey ? apiKey.substring(0, 10) + "..." : "MISSING");

    const email = "test@example.com"; // Let's use a dummy email to see what error it throws, or hardcode the user's login if they shared it? 
    // Wait, the user has not shared the email/password. Let's just use dummy, we expect "INVALID_EMAIL" or "EMAIL_NOT_FOUND".
    const password = "password123";

    try {
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
        console.log("HTTP Status:", response.status);
        console.log("Firebase Response:", JSON.stringify(data, null, 2));
    } catch (e) {
        console.error("Fetch failed:", e);
    }
}

testFirebaseRestAPI();
