import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, getApps } from 'firebase-admin/app';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

if (!getApps().length) {
    initializeApp({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID });
}

const db = getFirestore();

async function upstashDel(key) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) {
        console.log('Upstash credentials not found, skipping Redis key:', key);
        return;
    }
    const res = await fetch(`${url}/del/${encodeURIComponent(key)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    console.log(`DEL ${key} → result:`, data.result);
}

async function flushAdminCache() {
    const uid = '8jFtbIQbJyd7HqoqZLTXwQQXQfG3'; // admin.easysalesexport@gmail.com
    
    // Flush all possible cache key patterns for this user
    const keys = [
        `user:profile:${uid}`,
        `user:permissions:${uid}`,
        `user:session:${uid}`,
        `user:stats:${uid}`,
    ];
    
    for (const key of keys) {
        await upstashDel(key);
    }
    
    console.log('\nRedis cache flushed.');
    
    // Verify Firestore admin doc is complete
    const docRef = db.collection('users').doc(uid);
    const doc = await docRef.get();
    if (doc.exists) {
        const data = doc.data();
        const updates = {};
        if (!data.fullName && data.firstName) {
            updates.fullName = `${data.firstName} ${data.lastName || ''}`.trim();
            console.log('Patching missing fullName to:', updates.fullName);
        }
        if (Object.keys(updates).length > 0) {
            await docRef.update(updates);
            console.log('Firestore updated:', updates);
        } else {
            console.log('Firestore document is complete ✓');
            console.log('  fullName:', data.fullName);
            console.log('  email:', data.email);
            console.log('  roles:', data.roles);
        }
    } else {
        console.error('Admin Firestore document not found!');
    }
}

flushAdminCache().catch(console.error);
