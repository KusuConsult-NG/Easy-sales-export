import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize with Application Default Credentials (uses firebase CLI auth)
initializeApp({ projectId: "easy-sales-hub" });
const db = getFirestore();

async function countPhoneNumbers() {
    console.log("Analyzing Production Firestore Collections...\n");

    try {
        // 1. Analyze Core Users Collection
        const usersSnap = await db.collection("users").get();
        let totalUsers = usersSnap.size;
        let usersWithPhone = 0;

        usersSnap.forEach(doc => {
            const data = doc.data();
            const phoneStr = data.phone || data.phoneNumber;
            if (phoneStr && typeof phoneStr === 'string' && phoneStr.trim().length > 0) {
                usersWithPhone++;
            }
        });

        console.log(`--- USERS COLLECTION ---`);
        console.log(`Total Profiles: ${totalUsers}`);
        console.log(`Profiles with Phone Number: ${usersWithPhone} (${totalUsers ? Math.round((usersWithPhone / totalUsers) * 100) : 0}%)`);
        console.log(`Profiles missing Phone Number: ${totalUsers - usersWithPhone}\n`);

        // 2. Analyze Academy Applications
        const academySnap = await db.collection("academy_applications").get();
        let totalAcademyApps = academySnap.size;
        let academyAppsWithPhone = 0;

        academySnap.forEach(doc => {
            const data = doc.data();
            const phoneStr = data.personalInfo?.phone || data.phone;
            if (phoneStr && typeof phoneStr === 'string' && phoneStr.trim().length > 0) {
                academyAppsWithPhone++;
            }
        });

        console.log(`--- ACADEMY APPLICATIONS ---`);
        console.log(`Total Applications: ${totalAcademyApps}`);
        console.log(`Applications with Phone Number: ${academyAppsWithPhone} (${totalAcademyApps ? Math.round((academyAppsWithPhone / totalAcademyApps) * 100) : 0}%)`);
        console.log(`Applications missing Phone Number: ${totalAcademyApps - academyAppsWithPhone}\n`);

        // 3. Analyze Wave Briefings
        const waveSnap = await db.collection("wave_applications").get();
        let totalWaveApps = waveSnap.size;
        let waveAppsWithPhone = 0;

        waveSnap.forEach(doc => {
            const data = doc.data();
            const phoneStr = data.personalInfo?.phone || data.phone || data.personalInfo?.alternativePhone;
            if (phoneStr && typeof phoneStr === 'string' && phoneStr.trim().length > 0) {
                waveAppsWithPhone++;
            }
        });

        console.log(`--- WAVE APPLICATIONS ---`);
        console.log(`Total Applications: ${totalWaveApps}`);
        console.log(`Applications with Phone Number: ${waveAppsWithPhone} (${totalWaveApps ? Math.round((waveAppsWithPhone / totalWaveApps) * 100) : 0}%)\n`);

        // 4. Analyze Cooperative Members
        const coopSnap = await db.collection("cooperative_members").get();
        let totalCoop = coopSnap.size;
        let coopWithPhone = 0;

        coopSnap.forEach(doc => {
            const data = doc.data();
            const phoneStr = data.phone || data.phoneNumber;
            if (phoneStr && typeof phoneStr === 'string' && phoneStr.trim().length > 0) {
                coopWithPhone++;
            }
        });

        console.log(`--- COOPERATIVE MEMBERS ---`);
        console.log(`Total Members: ${totalCoop}`);
        console.log(`Members with Phone Number: ${coopWithPhone} (${totalCoop ? Math.round((coopWithPhone / totalCoop) * 100) : 0}%)\n`);


        console.log("Analysis Complete.");

    } catch (error) {
        console.error("Error running phone audit:", error);
    }
}

countPhoneNumbers();
