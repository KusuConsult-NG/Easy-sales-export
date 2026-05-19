const admin = require("firebase-admin");

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: "easy-sales-hub",
    clientEmail: "firebase-adminsdk-fbsvc@easy-sales-hub.iam.gserviceaccount.com",
    privateKey: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCzbUIqcf2E9CEq\nmBCYoNr8xL0YcG8uU5IaJ2YA9A0Yj5HsU5oiRAypTPjzLu6/QEgw5tlbMroU2jP6\ni8t1je6a+qQ4p4zjTXwD1+7kmfPCvxGH2+dzIKI2x/C5/tG33kK2uOqBxsvk9EqH\nfVCna9bjx1z/Qs1GstVzM8TeilxAZM0KborOow+iBUlOCRdH3J+/nIOD9wbQBZ0d\nVBN6d0uJsAvbWIDh1MJkvPJ690meuw7uBMnyHQOrN98omahKXSt9yghR0Ou23M5J\nObpWk8MD4+2YwEqBSHKsck+W0JiOYh3EGaRzMIvkx2nj5cuRedJg7ZH7DD2LjdSy\nSkr5RD3LAgMBAAECggEAWCDSjmGFyY9VWQPupuDfHqcNT9stqL3wdXsjfVVht04R\nONgJTUpKQ7+kSWGkb3iF3MsOOF6Oil5wiF+wc9FeQG3aSl91clGlF4gwdMTvNxi8\n5hOLN39wXWLQKLLx1BNNhk0GFe8MR6z7jFfvTQRJPIC3+0KW6+I7uAVV7Y5c6F0l\nBLYZ1qKKl1Nd8KyWCUrds2dHvVLrqr0OOd04VPKfDy0Cr9CwYsWXzRlVcAxsMaxR\n8H2QHDJFGeiMtNKIpuF4SsDZlHMx/kvfPZVbIMeYnqJ6+sIA9/XWuEcu8CbvFoqe\nzS6sDwlMvNMW3E3SHv+WH5CTcEMWZ5JbMl0IlkNyxQKBgQD8WWu8oLZG71p0aJjR\n/kvtwa0Tsun07P7qQTpHNvbkRqL2ujY9ZJKnPMMt1nNHhoKoxRNs4qV1dI7Rhy8i\ngaxbNq5jxJ1RUu5yK4NO/dnvVckx0sZquVwnoCUgbXW+P6LWwrc3kClc4rC8T46z\n94yfSs+ULNbY3k0Sg4XseSKsPwKBgQC2BcShEpd9w0Lps2H9Uo+Lz9clwR27NPSI\n1lbd38GyV8mpsvKFT9LN+spH8zLmCDL2XQ3guwk05J30POjMi6vKOlGOjSvqxDXD\nwje2RA30GCPDWsNa7Y/JmwyHhQVlm10hv2Q4hO81GV48nwkRHPcENfWAz52zxWdj\nOzEP1wc7dQKBgQDr4Xo/m8pGjD31SkBvKlE3MS7jlv3yIAY4WjhrkQk/YHe8QVuq\nD3S2NqoLEsY3OZiwwWbjBQi8vfMyEDcS/jtqF7bzMzoKZobU2a+oCsnIWlvy4p7t\n684kjCGoKilBaKKCNQimO28ukAe8PnGZ7+/Whkt6ql854LISeDabULAEaQKBgG00\nYrbcZ6UdPAzoAXcxTEvuYz8UcJj7eWaLacxtzVEJWEUGxnfy3x+TQj8Ois/1xVWH\nmKbmr+xa6OU6kdT+Sw/mEz46NkoAc91BrZkdlV2IChTPZHsuIeErs8WuqgE+yA5S\nPHeoUbeCw8YNCCyLOyv8j5E7fnr3iULApXvCX2VtAoGAYFoeYzYlrsMCGEsSwOPJ\nYGUSlIebEncBCzbQwt/xcvRy0qYvsVIB1WIL6nALT9nv3Vhob6o3jYvsuR3IRec9\n0Fs/KDNlQqp0gpoisnYDvI1l3xTblGMiLknsfFfSz+8z+l0s4KI8GHslDtqM1Kxc\n0PPDYErUYB3/M7tHoR9yYpM=\n-----END PRIVATE KEY-----\n"
  })
});

const emails = [
  "easysaleswave@gmail.com",
  "easysalescooperative@gmail.com",
  "easysalesmarketplace@gmail.com",
  "easysalesexportwindow@gmail.com",
  "easysalesfarmnation@gmail.com",
  "academy.easysalesexport1@gmail.com"
];

async function run() {
  const db = admin.firestore();
  
  for (const email of emails) {
    console.log(`Checking ${email}...`);
    try {
      const userRecord = await admin.auth().getUserByEmail(email);
      console.log(`  Auth UID: ${userRecord.uid}`);
      
      const doc = await db.collection("users").doc(userRecord.uid).get();
      if (doc.exists) {
        console.log(`  Firestore: Exists. Roles: ${JSON.stringify(doc.data().roles)}`);
      } else {
        console.log(`  Firestore: DOES NOT EXIST.`);
      }
    } catch (err) {
      console.log(`  Error: ${err.message}`);
    }
  }
}

run().catch(console.error);
