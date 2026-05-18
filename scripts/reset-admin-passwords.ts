/**
 * reset-admin-passwords.ts
 * Sets SIMPLE, clearly-typed passwords for all 6 module admin accounts.
 * Avoids special characters that browsers/password managers might mangle.
 *
 * Run:
 *   NODE_OPTIONS='--require dotenv/config' DOTENV_CONFIG_PATH=.env.local \
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/reset-admin-passwords.ts
 */

import { adminAuth } from "../src/lib/firebase-admin";

const ACCOUNTS = [
  { email: "easysaleswave@gmail.com",            newPassword: "WaveAdmin2026" },
  { email: "easysalescooperative@gmail.com",     newPassword: "CoopAdmin2026" },
  { email: "easysalesmarketplace@gmail.com",     newPassword: "MktAdmin2026" },
  { email: "easysalesexportwindow@gmail.com",    newPassword: "ExportAdmin2026" },
  { email: "easysalesfarmnation@gmail.com",      newPassword: "FarmAdmin2026" },
  { email: "academy.easysalesexport1@gmail.com", newPassword: "AcadAdmin2026" },
];

async function main() {
  console.log("\n Password Reset — Module Admin Accounts\n");
  console.log("Email".padEnd(50) + "New Password".padEnd(20) + "Status");
  console.log("─".repeat(80));

  for (const { email, newPassword } of ACCOUNTS) {
    try {
      const user = await adminAuth.getUserByEmail(email);
      await adminAuth.updateUser(user.uid, { password: newPassword });
      console.log(`${email.padEnd(50)}${newPassword.padEnd(20)}✅`);
    } catch (e: any) {
      console.log(`${email.padEnd(50)}${"ERROR".padEnd(20)}❌ ${e.message}`);
    }
  }

  console.log("\n─".repeat(80));
  console.log("\n✅ Done. Use these credentials at http://localhost:3000/auth/login/admin\n");
  console.log("  WAVE Admin       → easysaleswave@gmail.com            / WaveAdmin2026");
  console.log("  Cooperative      → easysalescooperative@gmail.com     / CoopAdmin2026");
  console.log("  Marketplace      → easysalesmarketplace@gmail.com     / MktAdmin2026");
  console.log("  Export Window    → easysalesexportwindow@gmail.com    / ExportAdmin2026");
  console.log("  Farm Nation      → easysalesfarmnation@gmail.com      / FarmAdmin2026");
  console.log("  Academy          → academy.easysalesexport1@gmail.com / AcadAdmin2026\n");
  console.log("⚠️  NOTE: If browser autofill offers old passwords, reject them.");
  console.log("   Type the new password manually or use Incognito / Private mode.\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
