import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { adminAuth } from './src/lib/firebase-admin';

async function test() {
    try {
        console.log("Calling updateUser on proxy...");
        await adminAuth.updateUser("invalid-uid", { password: "newpassword" });
        console.log("Success?");
    } catch(e: any) {
        console.log("Error caught:", e.message);
    }
}
test();
