import { getAdminAuth } from "../src/lib/firebase-admin";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function updatePassword(email: string, password: string) {
    const auth = getAdminAuth();
    try {
        const user = await auth.getUserByEmail(email);
        await auth.updateUser(user.uid, {
            password: password
        });
        console.log(`Password updated for ${email}.`);
    } catch (error) {
        console.error("Update failed:", error);
    }
}

updatePassword("farmnationuser@gmail.com", "Farmnation@2026");
