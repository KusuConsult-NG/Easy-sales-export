const admin = require('firebase-admin');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined;

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey,
        }),
    });
}

const db = admin.firestore();

const NIGERIAN_STATES = [
    "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno",
    "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT", "Gombe", "Imo",
    "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa",
    "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba",
    "Yobe", "Zamfara",
];

async function run() {
    const briefingSnap = await db.collection('wave_briefing_registrations').get();
    
    // state -> { exact: 0, mismatched: [], mismatchedCount: 0 }
    const stateStats = {};
    NIGERIAN_STATES.forEach(s => {
        stateStats[s.toLowerCase()] = { name: s, exact: 0, mismatched: new Map(), mismatchedCount: 0 };
    });

    let totalMismatched = 0;

    briefingSnap.forEach(doc => {
        const data = doc.data();
        const rawState = data.state || '';
        if (!rawState) return;

        const rawLower = rawState.toLowerCase().trim();
        
        // Find which official state this belongs to
        let matchedOfficial = null;
        for (const official of NIGERIAN_STATES) {
            if (rawLower.includes(official.toLowerCase())) {
                matchedOfficial = official;
                break;
            }
        }

        if (matchedOfficial) {
            const stat = stateStats[matchedOfficial.toLowerCase()];
            if (rawState === matchedOfficial) {
                stat.exact++;
            } else {
                stat.mismatchedCount++;
                totalMismatched++;
                const count = stat.mismatched.get(rawState) || 0;
                stat.mismatched.set(rawState, count + 1);
            }
        }
    });

    console.log(`--- WAVE Briefing Registrations State Casing Analysis ---`);
    console.log(`Total Mismatched Entries (would have failed strict check): ${totalMismatched}\n`);

    const result = [];
    for (const [key, stat] of Object.entries(stateStats)) {
        if (stat.mismatchedCount > 0) {
            result.push(stat);
        }
    }

    // Sort by most mismatched
    result.sort((a, b) => b.mismatchedCount - a.mismatchedCount);

    for (const stat of result) {
        console.log(`${stat.name}: ${stat.exact} exact match(es), ${stat.mismatchedCount} mismatched.`);
        const variants = [];
        for (const [variant, count] of stat.mismatched.entries()) {
            variants.push(`"${variant}" (${count})`);
        }
        console.log(`   Variants: ${variants.join(', ')}\n`);
    }

    process.exit(0);
}

run().catch(console.error);
