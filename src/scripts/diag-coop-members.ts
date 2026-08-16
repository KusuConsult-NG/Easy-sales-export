/**
 * Diagnose cooperative "Not a member yet" for specific users.
 * Uses raw REST API to avoid Node 20 WebSocket issues.
 * Run: npx tsx src/scripts/diag-coop-members.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
// node-fetch removed: it ships no type declarations here, and Node 18+
// has fetch built in, which is what this script runs on.

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const BASE = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!BASE || !KEY) { console.error('Missing env vars'); process.exit(1); }

const headers = {
    'apikey': KEY,
    'Authorization': `Bearer ${KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
};

async function rest(table: string, params: string): Promise<any[]> {
    const url = `${BASE}/rest/v1/${table}?${params}`;
    const res = await fetch(url, { headers });
    if (!res.ok) { console.error(`REST error: ${res.status} ${await res.text()}`); return []; }
    return res.json() as Promise<any[]>;
}

const TARGET_NAMES = ['Damwesh', 'Celina', 'Joshua'];

async function main() {
    console.log('=== Cooperative Member Diagnostic ===\n');

    // Fetch all users paginated
    const allUsers: any[] = [];
    let offset = 0;
    while (true) {
        const page = await rest('users', `select=id,email,roles,raw_data&limit=1000&offset=${offset}`);
        if (!page.length) break;
        allUsers.push(...page);
        if (page.length < 1000) break;
        offset += 1000;
    }
    console.log(`Total users: ${allUsers.length}`);

    const matched = allUsers.filter(u => {
        const rd = u.raw_data || {};
        const name = (rd.fullName || `${rd.firstName||''} ${rd.lastName||''}`).toLowerCase();
        return TARGET_NAMES.some(n => name.includes(n.toLowerCase()));
    });
    console.log(`Matched: ${matched.length}\n`);

    for (const user of matched) {
        const userId = user.id;
        const rd = user.raw_data || {};
        const name = (rd.fullName || `${rd.firstName||''} ${rd.lastName||''}`).trim();
        const coopReg = rd.serviceRegistrations?.cooperatives || rd.serviceRegistrations?.cooperative;

        console.log(`\n━━━ ${name} (${user.email}) ━━━`);
        console.log(`  userId         : ${userId}`);
        console.log(`  roles (native) : ${JSON.stringify(user.roles)}`);
        console.log(`  coop serviceReg: ${JSON.stringify(coopReg)}`);

        // Query by user_id native column
        const byId = await rest('cooperative_members', `select=id,status,user_id,raw_data&user_id=eq.${userId}`);
        if (byId.length > 0) {
            for (const row of byId) {
                const mrd = row.raw_data || {};
                console.log(`  ✓ coop_members (by user_id):`);
                console.log(`    doc id          : ${row.id}`);
                console.log(`    ★ native status : "${row.status}"`);
                console.log(`    raw memberStat  : "${mrd.membershipStatus}"`);
                console.log(`    raw status      : "${mrd.status}"`);
                console.log(`    onboardingDone  : ${mrd.onboardingCompleted}`);
                console.log(`    paymentStatus   : "${mrd.paymentStatus}"`);
            }
        } else {
            console.log(`  No row by user_id. Trying by doc_id = userId...`);
            const byDocId = await rest('cooperative_members', `select=id,status,user_id,raw_data&id=eq.${userId}`);
            if (byDocId.length > 0) {
                const mrd = byDocId[0].raw_data || {};
                console.log(`  ✓ coop_members (by doc_id=userId):`);
                console.log(`    ★ native status : "${byDocId[0].status}"`);
                console.log(`    raw memberStat  : "${mrd.membershipStatus}"`);
            } else if (user.email) {
                const email = user.email.toLowerCase();
                const byEmail = await rest('cooperative_members', `select=id,status,user_id,raw_data&raw_data->>email=eq.${encodeURIComponent(email)}`);
                if (byEmail.length > 0) {
                    const mrd = byEmail[0].raw_data || {};
                    console.log(`  ✓ coop_members (by email):`);
                    console.log(`    doc id          : ${byEmail[0].id}`);
                    console.log(`    ★ native status : "${byEmail[0].status}"`);
                    console.log(`    raw memberStat  : "${mrd.membershipStatus}"`);
                    console.log(`    userId in raw   : "${mrd.userId}"`);
                } else {
                    console.log(`  ✗ NOT FOUND in cooperative_members (no user_id, doc_id, or email match)`);
                }
            }
        }
    }

    // Distribution summary
    console.log('\n\n=== cooperative_members native status distribution ===');
    const all = await rest('cooperative_members', 'select=status&limit=5000');
    const dist: Record<string, number> = {};
    for (const m of all) { const k = m.status ?? 'NULL'; dist[k] = (dist[k]||0) + 1; }
    console.log(JSON.stringify(dist, null, 2));
    console.log(`Total cooperative_members: ${all.length}`);
}

main().catch(console.error);
