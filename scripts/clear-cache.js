const { Redis } = require('@upstash/redis');
const admin = require('firebase-admin');
const dotenv = require('dotenv');
const path = require('path');

// Ensure correct loading order
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
    });
}
const auth = admin.auth();

const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!redisUrl || !redisToken) {
    console.error("Missing Redis credentials in .env.local!");
    process.exit(1);
}

const redis = new Redis({
  url: redisUrl,
  token: redisToken,
});

async function run() {
  const email = process.argv[2] || 'steviekusu@gmail.com';
  console.log(`Looking up UID for ${email}...`);
  const user = await auth.getUserByEmail(email);
  const uid = user.uid;
  console.log(`Clearing cache for user ${uid}`);
  
  const profileKey = `user:profile:${uid}`;
  await redis.del(profileKey);
  console.log(`Deleted profile key ${profileKey} from Redis`);
}
run().catch(console.error);
