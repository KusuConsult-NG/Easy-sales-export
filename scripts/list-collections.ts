import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { db } from '../src/lib/firebase-admin';

async function main() {
    try {
        const collections = await db.listCollections();
        console.log('Collections:');
        collections.forEach(col => console.log(col.id));
        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

main();
