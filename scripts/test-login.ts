const email = "admin@easysalesexport.com";
const password = "Admin@2026";
const firebaseApiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;

async function runTest() {
    console.log("Testing sign-in using Firebase REST API...");
    console.log("Email:", email);
    console.log("API Key loaded:", !!firebaseApiKey);

    if (!firebaseApiKey) {
        console.error("Error: NEXT_PUBLIC_FIREBASE_API_KEY is not defined in the environment.");
        process.exit(1);
    }

    try {
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

        const data = await response.json();
        console.log("Response status:", response.status);
        console.log("Response data:", JSON.stringify(data, null, 2));
    } catch (e: any) {
        console.error("Network or fetch error:", e.message);
    }
}

runTest();
