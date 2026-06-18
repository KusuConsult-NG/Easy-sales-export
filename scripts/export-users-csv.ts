import { config } from "dotenv";
config({ path: ".env.local" });
import { db } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/lib/types/firestore";
import fs from "fs";
import path from "path";

function escapeCsv(val: any): string {
    if (val === null || val === undefined) return "";
    let str = String(val).trim();
    if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
        str = str.replace(/"/g, '""');
        return `"${str}"`;
    }
    return str;
}

function cleanState(stateStr: string): string {
    if (!stateStr || typeof stateStr !== 'string') return "Unknown";
    let cleaned = stateStr.trim().toLowerCase();
    if (!cleaned || cleaned === "n/a" || cleaned === "null" || cleaned === "undefined") return "Unknown";
    
    // Normalize common abbreviations/names
    if (cleaned === "abuja" || cleaned === "fct" || cleaned === "federal capital territory") {
        return "FCT Abuja";
    }
    
    // Title Case
    return cleaned.replace(/\b\w/g, c => c.toUpperCase());
}

async function exportUsers() {
    console.log("Starting user export to CSV...");
    
    // Ensure export directories exist
    const exportsDir = path.join(process.cwd(), "exports");
    const statesDir = path.join(exportsDir, "users_by_state");
    
    if (!fs.existsSync(exportsDir)) {
        fs.mkdirSync(exportsDir);
    }
    if (!fs.existsSync(statesDir)) {
        fs.mkdirSync(statesDir);
    }

    console.log("Fetching all users from Firestore...");
    const usersSnap = await db.collection(COLLECTIONS.USERS).get();
    console.log(`Loaded ${usersSnap.docs.length} user documents.`);

    const headers = [
        "User ID",
        "Full Name",
        "Email",
        "Phone",
        "State",
        "LGA",
        "Roles",
        "Academy Status",
        "Cooperative Status",
        "WAVE Status",
        "Farm Nation Status",
        "Export Status",
        "Created At"
    ];

    const allUsersRows: string[] = [headers.join(",")];
    const stateGroups = new Map<string, any[]>();

    usersSnap.docs.forEach((doc) => {
        const data = doc.data();
        
        // 1. Extract Name
        let name = data.fullName || data.name || "";
        if (!name) {
            if (data.firstName || data.lastName) {
                name = `${data.firstName || ''} ${data.lastName || ''}`.trim();
            } else if (data.personalInfo && typeof data.personalInfo === 'object') {
                const pi = data.personalInfo;
                if (pi.firstName || pi.lastName) {
                    name = `${pi.firstName || ''} ${pi.lastName || ''}`.trim();
                } else {
                    name = pi.fullName || pi.name || "";
                }
            }
        }
        if (!name) name = "Unknown User";

        // 2. Extract Phone
        let phone = data.phone || data.phoneNumber || "";
        if (!phone && data.kyc && typeof data.kyc === 'object') {
            phone = data.kyc.phone || data.kyc.phoneNumber || "";
        }
        if (!phone && data.personalInfo && typeof data.personalInfo === 'object') {
            phone = data.personalInfo.phone || data.personalInfo.phoneNumber || "";
        }

        // 3. Extract Email
        let email = data.email || "";
        if (!email && data.personalInfo && typeof data.personalInfo === 'object') {
            email = data.personalInfo.email || "";
        }

        // 4. Extract State & LGA
        let rawState = "";
        if (data.state) {
            rawState = data.state;
        } else if (data.stateOfOrigin) {
            rawState = data.stateOfOrigin;
        } else if (data.address && typeof data.address === 'object' && data.address.state) {
            rawState = data.address.state;
        } else if (data.kyc && typeof data.kyc === 'object' && data.kyc.state) {
            rawState = data.kyc.state;
        } else if (data.personalInfo && typeof data.personalInfo === 'object' && data.personalInfo.state) {
            rawState = data.personalInfo.state;
        }
        const state = cleanState(rawState);

        let lga = "Unknown";
        if (data.lga) {
            lga = data.lga;
        } else if (data.address && typeof data.address === 'object' && data.address.lga) {
            lga = data.address.lga;
        } else if (data.kyc && typeof data.kyc === 'object' && data.kyc.lga) {
            lga = data.kyc.lga;
        } else if (data.personalInfo && typeof data.personalInfo === 'object' && data.personalInfo.lga) {
            lga = data.personalInfo.lga;
        }

        // 5. Extract Roles
        const roles = Array.isArray(data.roles) ? data.roles.join("; ") : "";

        // 6. Extract Module Statuses
        const regs = data.serviceRegistrations || {};
        const academyStatus = regs.academy?.status || "none";
        const coopStatus = regs.cooperatives?.status || "none";
        const waveStatus = regs.wave?.status || "none";
        const farmNationStatus = regs.farmNation?.status || "none";
        const exportStatus = regs.export?.status || "none";

        // 7. Extract Created At Date
        let createdAtStr = "Unknown";
        if (data.createdAt) {
            if (typeof data.createdAt.toDate === 'function') {
                createdAtStr = data.createdAt.toDate().toISOString();
            } else if (data.createdAt.seconds) {
                createdAtStr = new Date(data.createdAt.seconds * 1000).toISOString();
            } else {
                createdAtStr = new Date(data.createdAt).toISOString();
            }
        }

        const row = [
            escapeCsv(doc.id),
            escapeCsv(name),
            escapeCsv(email),
            escapeCsv(phone),
            escapeCsv(state),
            escapeCsv(lga),
            escapeCsv(roles),
            escapeCsv(academyStatus),
            escapeCsv(coopStatus),
            escapeCsv(waveStatus),
            escapeCsv(farmNationStatus),
            escapeCsv(exportStatus),
            escapeCsv(createdAtStr)
        ].join(",");

        allUsersRows.push(row);

        // Group by state
        if (!stateGroups.has(state)) {
            stateGroups.set(state, []);
        }
        stateGroups.get(state)!.push(row);
    });

    // 1. Write ALL users CSV
    const allUsersPath = path.join(exportsDir, "all_users.csv");
    fs.writeFileSync(allUsersPath, allUsersRows.join("\n"));
    console.log(`Successfully exported all users to ${allUsersPath}`);

    // 2. Write state summaries
    const summaryHeaders = ["State", "Total Users"];
    const summaryRows = [summaryHeaders.join(",")];
    
    // Sort states alphabetically
    const sortedStates = Array.from(stateGroups.keys()).sort();
    
    sortedStates.forEach(state => {
        const users = stateGroups.get(state)!;
        summaryRows.push(`${escapeCsv(state)},${users.length}`);
        
        // 3. Write individual state files
        const stateRows = [headers.join(","), ...users];
        // Clean state name for file systems (remove slashes, etc)
        const safeStateName = state.replace(/[^a-zA-Z0-9]/g, "_");
        const stateFilePath = path.join(statesDir, `${safeStateName}.csv`);
        fs.writeFileSync(stateFilePath, stateRows.join("\n"));
    });

    const summaryPath = path.join(exportsDir, "users_per_state_summary.csv");
    fs.writeFileSync(summaryPath, summaryRows.join("\n"));
    console.log(`Successfully exported state summaries to ${summaryPath}`);
    console.log(`Successfully generated state files in ${statesDir}`);
    
    console.log("Export complete!");
}

exportUsers().catch(console.error);
