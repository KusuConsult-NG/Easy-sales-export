import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getAdminAuth } from './src/lib/firebase-admin';

async function run() {
    const auth = getAdminAuth();
    
    const accounts = [
        { email: "easysaleswave@gmail.com", password: "WaveAdmin2026" },
        { email: "easysalescooperative@gmail.com", password: "CoopAdmin2026" },
        { email: "easysalesmarketplace@gmail.com", password: "MktAdmin2026" },
        { email: "easysalesexportwindow@gmail.com", password: "ExportAdmin2026" },
        { email: "easysalesfarmnation@gmail.com", password: "FarmAdmin2026" },
        { email: "academy.easysalesexport1@gmail.com", password: "AcadAdmin2026" },
    ];

    for (const acc of accounts) {
        try {
            const user = await auth.getUserByEmail(acc.email);
            await auth.updateUser(user.uid, { password: acc.password });
            console.log(`Updated password for ${acc.email} to ${acc.password}`);
        } catch (error: any) {
            console.log(`Error updating ${acc.email}: ${error.message}`);
        }
    }
}

run().catch(console.error);
