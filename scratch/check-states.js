const { getAdminDb } = require('../src/lib/firebase-admin');
const COLLECTIONS = require('../src/lib/types/firestore').COLLECTIONS;

async function run() {
    const db = getAdminDb();
    
    // Check USERS
    const usersSnap = await db.collection(COLLECTIONS.USERS).get();
    let ogunUsers = 0;
    usersSnap.forEach(d => {
        const u = d.data();
        const state = u.stateOfOrigin || u.state || (u.address && u.address.state) || '';
        if (state.toLowerCase().includes('ogun')) ogunUsers++;
    });
    console.log("Ogun Users in USERS collection:", ogunUsers);

    // Check WAVE_BRIEFING_REGISTRATIONS
    const briefingSnap = await db.collection(COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS).get();
    let ogunBriefingExact = 0;
    let ogunBriefingCaseInsensitive = 0;
    const statesCount = {};
    briefingSnap.forEach(d => {
        const r = d.data();
        const state = r.state || '';
        if (state === 'Ogun') ogunBriefingExact++;
        if (state.toLowerCase().includes('ogun')) ogunBriefingCaseInsensitive++;
        statesCount[state] = (statesCount[state] || 0) + 1;
    });
    console.log("Ogun Briefing Registrations (Exact 'Ogun'):", ogunBriefingExact);
    console.log("Ogun Briefing Registrations (Case/Substr 'ogun'):", ogunBriefingCaseInsensitive);
    // Print top 10 states
    console.log("Top 10 States in Briefing:", Object.entries(statesCount).sort((a,b)=>b[1]-a[1]).slice(0, 10));
}
run().catch(console.error);
