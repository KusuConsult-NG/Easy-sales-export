require('dotenv').config({ path: '.env.local' });

async function testFirebaseRestAPI() {
    console.log("Testing Firebase REST API with Local Key...");
    const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    console.log("API Key found:", apiKey ? apiKey.substring(0, 10) + "..." : "MISSING");

    const email = "steviekusu@gmail.com";
    const password = "Password123!";

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
        if (!response.ok) {
            console.error("Firebase Response Error:", JSON.stringify(data, null, 2));
        } else {
            console.log("SUCCESS! User signed in. LocalToken:", data.idToken ? "Present" : "Missing");
        }
    } catch (e) {
        console.error("Fetch failed:", e);
    }
}

testFirebaseRestAPI();
