import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getAdminDb } from '../src/lib/firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

async function exportEmailsToCSV() {
    console.log('Starting export of 36,850+ emails...');
    const db = getAdminDb();
    const exportPath = path.join(process.cwd(), 'scratch', 'hub_emails_export.csv');
    const writeStream = fs.createWriteStream(exportPath);

    // Write CSV Header
    writeStream.write('Email,Full Name,Role,Status,Source,Created At\n');

    const sanitize = (val: any) => `"${(val || '').toString().replace(/"/g, '""')}"`;

    try {
        const usersRef = db.collection('users');
        let count = 0;
        
        // Use stream to handle large dataset efficiently
        const stream = usersRef.stream();

        for await (const doc of (stream as any)) {
            const data = doc.data();
            
            // 1. Derive Name
            const fullName = data.firstName
                ? [data.firstName, data.otherName, data.lastName].filter(Boolean).join(' ').trim()
                : (data.fullName || data.name || data.displayName || 'Unknown');

            // 2. Derive Status
            const isVerified = data.isVerified ?? data.verified ?? false;
            const status = isVerified ? 'Verified' : 'Unverified';

            // 3. Derive Source
            const source = (data.firstName || data.isVerified !== undefined) ? 'New Hub' : 'Legacy Migration';

            // 4. Role
            const role = data.roles?.[0] || 'general_user';

            // 5. Created At
            const createdAt = data.createdAt?.toDate 
                ? data.createdAt.toDate().toISOString() 
                : (data.createdAt ? new Date(data.createdAt).toISOString() : 'N/A');

            const row = [
                sanitize(data.email),
                sanitize(fullName),
                sanitize(role),
                sanitize(status),
                sanitize(source),
                sanitize(createdAt)
            ].join(',') + '\n';

            writeStream.write(row);
            
            count++;
            if (count % 5000 === 0) {
                console.log(`Exported ${count} users...`);
            }
        }

        // Add admin_users
        const adminSnap = await db.collection('admin_users').get();
        for (const doc of adminSnap.docs) {
            const data = doc.data();
            const row = [
                sanitize(data.email),
                sanitize(data.fullName || 'Admin'),
                sanitize('admin'),
                sanitize('Verified'),
                sanitize('System'),
                sanitize('N/A')
            ].join(',') + '\n';
            writeStream.write(row);
            count++;
        }

        writeStream.end();
        console.log(`\nSUCCESS: Exported a total of ${count} emails to ${exportPath}`);
        process.exit(0);
    } catch (error) {
        console.error('Export failed:', error);
        process.exit(1);
    }
}

exportEmailsToCSV();
