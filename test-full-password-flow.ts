import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { adminAuth, db } from './src/lib/firebase-admin';

async function test() {
    let uid;
    try {
        console.log("1. Creating test user...");
        const user = await adminAuth.createUser({
            email: "test.pass.change@example.com",
            password: "OldPassword123!",
            displayName: "Test User"
        });
        uid = user.uid;
        console.log("Created user:", uid);

        console.log("2. Verifying old password via REST API...");
        const verifyRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}`, {
            method: 'POST',
            body: JSON.stringify({
                email: "test.pass.change@example.com",
                password: "OldPassword123!",
                returnSecureToken: true
            }),
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (!verifyRes.ok) {
            const err = await verifyRes.json();
            throw new Error(`REST API Failed: ${JSON.stringify(err)}`);
        }
        console.log("REST API Verify Success!");

        console.log("3. Updating password via Admin SDK...");
        await adminAuth.updateUser(uid, { password: "NewPassword123!" });
        console.log("Password updated successfully!");

        console.log("4. Verifying NEW password via REST API...");
        const verifyRes2 = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}`, {
            method: 'POST',
            body: JSON.stringify({
                email: "test.pass.change@example.com",
                password: "NewPassword123!",
                returnSecureToken: true
            }),
            headers: { 'Content-Type': 'application/json' }
        });
        if (!verifyRes2.ok) {
            const err = await verifyRes2.json();
            throw new Error(`REST API Failed on new password: ${JSON.stringify(err)}`);
        }
        console.log("New password works!");

    } catch(e: any) {
        console.error("Test failed:", e.message);
    } finally {
        if (uid) {
            console.log("Cleaning up test user...");
            await adminAuth.deleteUser(uid);
            console.log("Cleanup complete.");
        }
    }
}
test();
