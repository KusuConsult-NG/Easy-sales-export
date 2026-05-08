import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getAdminDb } from '../src/lib/firebase-admin';

async function countUsers() {
    try {
        const db = getAdminDb();
        const snapshot = await db.collection('users').count().get();
        const adminSnapshot = await db.collection('admin_users').count().get();
        console.log('TOTAL_USERS_COUNT:' + snapshot.data().count);
        console.log('TOTAL_ADMINS_COUNT:' + adminSnapshot.data().count);
        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}

countUsers();
