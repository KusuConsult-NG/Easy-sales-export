import { getAdminAuth } from "../src/lib/firebase-admin";

async function main() {
    const auth = getAdminAuth();
    
    try {
        const user = await auth.getUserByEmail("farmnationuser@gmail.co");
        console.log("Found user with .co");
    } catch(e) {
        console.log("No user with .co");
    }

    try {
        const user = await auth.getUserByEmail("farmnationuser@gmail.com");
        console.log("Found user with .com");
    } catch(e) {
        console.log("No user with .com");
    }
    
    process.exit(0);
}
main();
