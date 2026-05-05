import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function simulateLogin(email: string, password: string) {
    const firebaseApiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
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
    console.log("Login Result:", JSON.stringify(data, null, 2));
}

// NOTE: I don't know the password. 
// But I can use the Admin SDK to create a temporary password or check the UID.
// Actually, I just want to see the response format.
simulateLogin("farmnationuser@gmail.com", "dummy");
