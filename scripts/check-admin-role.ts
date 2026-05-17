import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { db } from '../src/lib/firebase-admin';

async function check() {
    const email = 'steviekusu@gmail.com';
    const snapshot = await db.collection('users').where('email', '==', email).get();
    if (snapshot.empty) {
        console.log(`User ${email} not found.`);
        return;
    }
    const user = snapshot.docs[0].data();
    console.log(`User: ${email}`);
    console.log(`Roles:`, user.roles);
    
    // Add super_admin role if missing
    if (!user.roles?.includes('super_admin')) {
        const roles = user.roles || [];
        if (!roles.includes('super_admin')) roles.push('super_admin');
        await snapshot.docs[0].ref.update({ roles });
        console.log(`Added super_admin role. New roles:`, roles);
    } else {
        console.log('Already has super_admin role.');
    }
}

check().then(() => process.exit(0));
