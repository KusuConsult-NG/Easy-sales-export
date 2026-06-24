import path from "path";
import dotenv from "dotenv";
import fs from "fs";
dotenv.config({ path: "/Users/mac/Easy sales Export/easy-sales-export-nextjs/.env.local" });

let privateKey = process.env.FIREBASE_PRIVATE_KEY;
if (privateKey) {
    if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
        privateKey = privateKey.slice(1, -1);
    }
    if (privateKey.includes('\\n')) {
        privateKey = privateKey.replace(/\\n/g, '\n');
    }
    process.env.FIREBASE_PRIVATE_KEY = privateKey;
}

import { getAdminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";

function isStateMatch(dbState: any, statesList: string[]) {
    if (!dbState || typeof dbState !== 'string') return false;
    const cleanState = dbState.toLowerCase().trim();
    return statesList.some(s => cleanState.includes(s));
}

function normalisePhone(rawPhone: any) {
    if (!rawPhone) return null;
    let s = String(rawPhone).replace(/\s+/g, '').replace(/[^0-9+]/g, '');
    if (s.startsWith('+234')) {
        s = s.substring(4);
    } else if (s.startsWith('234') && s.length > 10) {
        s = s.substring(3);
    }
    if (s.startsWith('0') && s.length === 11) {
        s = s.substring(1);
    }
    if (s.length !== 10) return null;
    return '+234' + s;
}

async function main() {
    const db = getAdminDb();
    console.log("Generating Kano, Lagos, Ogun users CSV...");
    const targetStates = ["kano", "lagos", "ogun"];
    const recipients = new Map<string, { name: string, phone: string, state: string, source: string }>();

    const add = (rawPhone: any, name: string, state: string, source: string) => {
        const phone = normalisePhone(rawPhone);
        if (phone && isStateMatch(state, targetStates)) {
            const matchedState = targetStates.find(s => state.toLowerCase().includes(s))!;
            const displayState = matchedState.charAt(0).toUpperCase() + matchedState.slice(1);
            if (!recipients.has(phone)) {
                recipients.set(phone, {
                    name: name.trim() || "User",
                    phone,
                    state: displayState,
                    source
                });
            }
        }
    };

    // 1. Root Users
    console.log("Querying root users...");
    const usersSnap = await db.collection(COLLECTIONS.USERS)
        .select("stateOfOrigin", "state", "address", "phone", "phoneNumber", "kyc", "fullName", "name", "serviceRegistrations")
        .get();
    
    usersSnap.docs.forEach(doc => {
        const u = doc.data();
        let userState = u.stateOfOrigin || u.state || u.address?.state;
        
        // Check service registrations for state if main is empty
        if (!userState && u.serviceRegistrations) {
            for (const reg of Object.values(u.serviceRegistrations) as any[]) {
                const profile = reg?.profile || reg;
                userState = profile?.state || profile?.stateOfOrigin || profile?.address?.state || reg?.companyInfo?.state || reg?.personalInfo?.state || "";
                if (userState) break;
            }
        }
        
        if (userState && isStateMatch(userState, targetStates)) {
            let phone = u.phone || u.phoneNumber || u.kyc?.phoneNumber || u.kyc?.phone || "";
            if (!phone && u.serviceRegistrations) {
                for (const reg of Object.values(u.serviceRegistrations) as any[]) {
                    const profile = reg?.profile || reg;
                    phone = profile?.phone || profile?.phoneNumber || reg?.personalInfo?.phone || "";
                    if (phone) break;
                }
            }
            add(phone, u.fullName || u.name || "User", userState, "users");
        }
    });
    console.log(`Root users matching filter: ${recipients.size}`);

    // 2. Cooperative members
    console.log("Querying cooperative members...");
    const cmSnap = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
        .select("userId", "state", "address", "phone", "phoneNumber", "firstName", "lastName")
        .get();
    
    cmSnap.docs.forEach(doc => {
        const m = doc.data();
        const state = m.state || m.address?.state;
        if (state && isStateMatch(state, targetStates)) {
            const phone = m.phone || m.phoneNumber;
            const name = [m.firstName, m.lastName].filter(Boolean).join(" ") || "Member";
            add(phone, name, state, "cooperative_members");
        }
    });
    console.log(`Unique recipients after cooperative members: ${recipients.size}`);

    // 3. WAVE applications
    console.log("Querying WAVE applications...");
    const waveSnap = await db.collection(COLLECTIONS.WAVE_APPLICATIONS)
        .select("userId", "state", "residentialState", "phone", "alternativePhone", "phoneNumber", "firstName", "surname", "lastName")
        .get();
    
    waveSnap.docs.forEach(doc => {
        const a = doc.data();
        const state = a.state || a.residentialState;
        if (state && isStateMatch(state, targetStates)) {
            const phone = a.phone || a.alternativePhone || a.phoneNumber;
            const name = [a.firstName, a.surname || a.lastName].filter(Boolean).join(" ") || "Applicant";
            add(phone, name, state, "wave_applications");
        }
    });
    console.log(`Unique recipients after WAVE applications: ${recipients.size}`);

    // 4. Academy applications
    console.log("Querying Academy applications...");
    const academySnap = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
        .select("userId", "personalInfo", "state", "phone", "phoneNumber")
        .get();
    
    academySnap.docs.forEach(doc => {
        const a = doc.data();
        const state = a.personalInfo?.state || a.state;
        if (state && isStateMatch(state, targetStates)) {
            const phone = a.personalInfo?.phone || a.phone || a.phoneNumber;
            const name = a.personalInfo?.fullName || [a.personalInfo?.firstName, a.personalInfo?.lastName].filter(Boolean).join(" ") || "Academy User";
            add(phone, name, state, "academy_applications");
        }
    });
    console.log(`Unique recipients after Academy applications: ${recipients.size}`);

    // 5. WAVE briefing registrations
    console.log("Querying WAVE briefing registrations...");
    const briefSnap = await db.collection(COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS)
        .select("userId", "state", "phone", "phoneNumber", "name", "firstName", "surname")
        .get();
    
    briefSnap.docs.forEach(doc => {
        const r = doc.data();
        if (r.state && isStateMatch(r.state, targetStates)) {
            add(r.phone || r.phoneNumber, r.name || [r.firstName, r.surname].filter(Boolean).join(" ") || "Registrant", r.state, "wave_briefing_registrations");
        }
    });
    console.log(`Unique recipients after WAVE briefing registrations: ${recipients.size}`);

    // 6. Farm Nation applications
    console.log("Querying Farm Nation applications...");
    const fnSnap = await db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS)
        .select("profile")
        .get();
    
    fnSnap.docs.forEach(doc => {
        const a = doc.data();
        if (a.profile?.state && isStateMatch(a.profile.state, targetStates)) {
            add(a.profile.phone, a.profile.fullName || [a.profile.firstName, a.profile.lastName].filter(Boolean).join(" ") || "Farm Nation User", a.profile.state, "farm_nation_applications");
        }
    });
    console.log(`Unique recipients after Farm Nation applications: ${recipients.size}`);

    // 7. Export applications
    console.log("Querying Export onboarding applications...");
    const exportSnap = await db.collection(COLLECTIONS.EXPORT_APPLICATIONS)
        .select("profile", "companyInfo", "state", "phone", "phoneNumber")
        .get();
    
    exportSnap.docs.forEach(doc => {
        const a = doc.data();
        const state = a.profile?.state || a.companyInfo?.state || a.state;
        if (state && isStateMatch(state, targetStates)) {
            add(a.profile?.phone || a.phone || a.phoneNumber, a.profile?.fullName || "Export User", state, "export_applications");
        }
    });
    console.log(`Total unique recipients: ${recipients.size}`);

    // Generate CSV content
    const csvHeaders = ["Phone Number", "Name", "State", "Source Collection"];
    const csvRows = Array.from(recipients.values()).map(r => [
        `'${r.phone}`,
        r.name,
        r.state,
        r.source
    ]);

    const csvContent = [
        csvHeaders.join(","),
        ...csvRows.map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(","))
    ].join("\n");

    const outputPath1 = "/Users/mac/Easy sales Export/kano_lagos_ogun_users.csv";
    const outputPath2 = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/public/kano_lagos_ogun_users.csv";

    fs.writeFileSync(outputPath1, csvContent, "utf8");
    console.log(`Successfully generated CSV at: ${outputPath1}`);

    // Ensure directory exists
    const publicDir = path.dirname(outputPath2);
    if (!fs.existsSync(publicDir)) {
        fs.mkdirSync(publicDir, { recursive: true });
    }
    fs.writeFileSync(outputPath2, csvContent, "utf8");
    console.log(`Successfully generated CSV at: ${outputPath2}`);
}

main().catch(console.error);
