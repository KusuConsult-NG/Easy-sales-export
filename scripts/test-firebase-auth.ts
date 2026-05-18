/**
 * test-firebase-auth.ts
 * Directly tests Firebase REST API login for each module admin.
 * Run:
 *   NODE_OPTIONS='--require dotenv/config' DOTENV_CONFIG_PATH=.env.local \
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/test-firebase-auth.ts
 */

const ACCOUNTS = [
  { email: "easysaleswave@gmail.com",           password: "WAVE@2026" },
  { email: "easysalescooperative@gmail.com",    password: "Cooperative@2026." },
  { email: "easysalesmarketplace@gmail.com",    password: "Marketplace@2026" },
  { email: "easysalesexportwindow@gmail.com",   password: "Exportwindow@2026" },
  { email: "easysalesfarmnation@gmail.com",     password: "Farmnation@2026" },
  { email: "academy.easysalesexport1@gmail.com",password: "@2025Easysales!" },
];

async function testAccount(email: string, password: string) {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) { console.error("NEXT_PUBLIC_FIREBASE_API_KEY not set"); process.exit(1); }

  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const data = await res.json() as any;

  if (res.ok) {
    console.log(`  ✅ OK   — uid: ${data.localId}`);
  } else {
    const code = data?.error?.message || "UNKNOWN";
    console.log(`  ❌ FAIL — ${code}`);
  }
}

async function main() {
  console.log("\nFirebase REST API — credential verification\n");
  for (const { email, password } of ACCOUNTS) {
    process.stdout.write(`${email.padEnd(48)}`);
    await testAccount(email, password);
  }
  console.log();
}

main().catch(e => { console.error(e); process.exit(1); });
