import fs from 'fs';
import path from 'path';

// Mock WebSocket on globalThis BEFORE any imports run
(globalThis as any).WebSocket = class {};

// Parse .env files manually
const envPaths = [
    path.resolve(process.cwd(), '.env.production.local'),
    path.resolve(process.cwd(), '.env.local')
];

for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf-8');
        content.split('\n').forEach(line => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return;
            const idx = trimmed.indexOf('=');
            if (idx > 0) {
                const key = trimmed.substring(0, idx).trim();
                let val = trimmed.substring(idx + 1).trim();
                if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                    val = val.substring(1, val.length - 1);
                }
                process.env[key] = val;
            }
        });
    }
}

async function run() {
    // Import Supabase Admin dynamically to verify DB status
    const { supabaseAdmin } = await import('../src/lib/supabase');
    console.log("=== RUNNING DATABASE REGISTRATION INTEGRITY CHECK ===");

    // 1. Fetch WAVE Applications (not rejected)
    const { data: waveApps, error: waveErr } = await supabaseAdmin
        .from('document_collections')
        .select('id, raw_data')
        .eq('collection_name', 'wave_applications')
        .not('raw_data->>status', 'eq', 'rejected');

    if (waveErr) {
        console.error("Error fetching WAVE applications:", waveErr);
        return;
    }

    console.log(`Fetched ${waveApps?.length || 0} active/pending WAVE applications.`);

    const waveAppMap = new Map();
    (waveApps || []).forEach(row => {
        const app = row.raw_data || {};
        const userId = app.userId;
        if (userId) {
            waveAppMap.set(userId, { id: row.id, ...app });
        }
    });

    // 2. Fetch Cooperative Members
    const { data: coopMembers, error: coopErr } = await supabaseAdmin
        .from('cooperative_members')
        .select('id, raw_data');

    if (coopErr) {
        console.error("Error fetching Cooperative members:", coopErr);
        return;
    }

    console.log(`Fetched ${coopMembers?.length || 0} Cooperative members.`);

    const coopMemberMap = new Map();
    (coopMembers || []).forEach(row => {
        const member = row.raw_data || {};
        const userId = member.userId || row.id;
        if (userId) {
            coopMemberMap.set(userId, { id: row.id, ...member });
        }
    });

    // Query user profiles
    const allUserIds = Array.from(new Set([...waveAppMap.keys(), ...coopMemberMap.keys()]));
    console.log(`Verifying ${allUserIds.length} unique user profiles...`);

    const usersMap = new Map();
    const batchSize = 100;
    for (let i = 0; i < allUserIds.length; i += batchSize) {
        const batchIds = allUserIds.slice(i, i + batchSize);
        const { data: users, error: usersErr } = await supabaseAdmin
            .from('users')
            .select('id, raw_data')
            .in('id', batchIds);

        if (usersErr) {
            console.error(`Error fetching users batch starting at ${i}:`, usersErr);
            continue;
        }

        (users || []).forEach(u => {
            usersMap.set(u.id, u.raw_data || {});
        });
    }

    let waveUnhealedCount = 0;
    const waveUnhealedList = [];

    for (const [userId, app] of waveAppMap.entries()) {
        const userData = usersMap.get(userId);
        if (!userData) {
            waveUnhealedCount++;
            waveUnhealedList.push({
                userId,
                email: app.userEmail || app.email || 'unknown',
                type: 'WAVE',
                reason: 'User profile document completely missing in database'
            });
            continue;
        }

        const waveReg = userData.serviceRegistrations?.wave || {};
        if (!waveReg.status || waveReg.status === 'not_started' || waveReg.status === 'unapplied') {
            waveUnhealedCount++;
            waveUnhealedList.push({
                userId,
                email: userData.email || app.userEmail || app.email || 'unknown',
                type: 'WAVE',
                reason: `User profile wave status is: ${waveReg.status || 'missing'} (Application status is ${app.status})`
            });
        }
    }

    let coopUnhealedCount = 0;
    const coopUnhealedList = [];

    for (const [userId, member] of coopMemberMap.entries()) {
        const userData = usersMap.get(userId);
        if (!userData) {
            coopUnhealedCount++;
            coopUnhealedList.push({
                userId,
                email: member.email || 'unknown',
                type: 'Cooperative',
                reason: 'User profile document completely missing in database'
            });
            continue;
        }

        const coopReg = userData.serviceRegistrations?.cooperatives || userData.serviceRegistrations?.cooperative || {};
        if (!coopReg.status || coopReg.status === 'not_started' || coopReg.status === 'unapplied') {
            coopUnhealedCount++;
            coopUnhealedList.push({
                userId,
                email: userData.email || member.email || 'unknown',
                type: 'Cooperative',
                reason: `User profile coop status is: ${coopReg.status || 'missing'} (Member status is ${member.status})`
            });
        }
    }

    console.log("\n=== VERIFICATION SUMMARY ===");
    console.log(`Unhealed WAVE users: ${waveUnhealedCount}`);
    console.log(`Unhealed Cooperative users: ${coopUnhealedCount}`);
    console.log(`Total Mismatched/Unhealed: ${waveUnhealedCount + coopUnhealedCount}\n`);

    if (waveUnhealedCount === 0 && coopUnhealedCount === 0) {
        console.log("✅ SUCCESS: All users are fully healed and synchronized!");
    } else {
        console.log("❌ WARNING: Mismatch detected. Some users are still out of sync.");
    }
}

run().catch(console.error);
