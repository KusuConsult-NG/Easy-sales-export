import { adminAuth } from "./src/lib/firebase-admin";

async function checkUser(email: string) {
  try {
    const user = await adminAuth.getUserByEmail(email);
    console.log(`User ${email}: uid=${user.uid}, customClaims=`, user.customClaims);
  } catch (e: any) {
    console.error(`Error for ${email}: ${e.message}`);
  }
}

async function run() {
  await checkUser("easysalescooperative@gmail.com");
  await checkUser("easysalesexport@gmail.com");
}
run();
