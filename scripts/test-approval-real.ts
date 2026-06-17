import fs from 'fs';
import path from 'path';

// Load .env.local manually
try {
    const envPath = path.resolve(__dirname, '../.env.local');
    if (fs.existsSync(envPath)) {
        const envConfig = fs.readFileSync(envPath, 'utf8');
        envConfig.split('\n').forEach(line => {
            const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
            if (match) {
                const key = match[1];
                let value = match[2] || '';
                if (value.startsWith('"') && value.endsWith('"')) {
                    value = value.substring(1, value.length - 1);
                } else if (value.startsWith("'") && value.endsWith("'")) {
                    value = value.substring(1, value.length - 1);
                }
                value = value.replace(/\\n/g, '\n');
                process.env[key] = value;
            }
        });
    }
} catch (e) {
    console.error("Failed to load .env.local:", e);
}

import { db } from "../src/lib/firebase-admin";
import { COLLECTIONS } from "../src/src/lib/types/firestore"; // Adjust path if needed
import { FieldValue } from "firebase-admin/firestore";
import { normalizeUserUpdate } from "../src/lib/schema-normalizer";

// Mock session admin user ID
const mockAdminId = "admin-test-id";

async function testCoopApproval() {
    console.log("\n--- Testing Cooperative Member Approval ---");
    try {
        const pendingSnap = await db.collection("cooperative_members")
            .where("membershipStatus", "==", "pending")
            .limit(1)
            .get();

        if (pendingSnap.empty) {
            console.log("No pending cooperative members found.");
            return;
        }

        const doc = pendingSnap.docs[0];
        const memberId = doc.id;
        const memberData = doc.data();
        const userId = memberData.userId || memberId;
        console.log(`Found pending member: ${memberId}, User ID: ${userId}`);

        // Try to run the exact transaction block from approve-member/route.ts
        await db.runTransaction(async (txn) => {
            const memberRef = db.collection("cooperative_members").doc(memberId);
            const userRef = db.collection("users").doc(userId);
            const userSnap = await txn.get(userRef);

            txn.update(memberRef, {
                membershipStatus: "active",
                approvedBy: mockAdminId,
                approvedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1),
            });

            if (!userSnap.exists) {
                txn.set(userRef, {
                    uid: userId,
                    email: memberData?.email || "",
                    fullName: `${memberData?.firstName || ''} ${memberData?.lastName || ''}`.trim() || "Cooperative Member",
                    createdAt: FieldValue.serverTimestamp(),
                    roles: ["cooperative_member"],
                    isVerified: true,
                });
            }

            txn.update(userRef, normalizeUserUpdate({
                isVerified: true,
                roles: FieldValue.arrayUnion("cooperative_member"),
                "serviceRegistrations.cooperatives.status": "active",
                "serviceRegistrations.cooperatives.activatedAt": FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1),
            }));
        });
        console.log("SUCCESS: Cooperative member approved!");
    } catch (e: any) {
        console.error("FAILED Cooperative member approval:", e.message, e.stack);
    }
}

async function testWaveApproval() {
    console.log("\n--- Testing WAVE Application Approval ---");
    try {
        const pendingSnap = await db.collection("wave_applications")
            .where("status", "==", "pending")
            .limit(1)
            .get();

        if (pendingSnap.empty) {
            console.log("No pending WAVE applications found.");
            return;
        }

        const doc = pendingSnap.docs[0];
        const applicationId = doc.id;
        const appData = doc.data();
        const targetUserId = appData.userId;
        console.log(`Found pending WAVE application: ${applicationId}, User ID: ${targetUserId}`);

        await db.runTransaction(async (transaction) => {
            const appRef = db.collection("wave_applications").doc(applicationId);
            
            let userDoc = null;
            let userRef = null;
            if (targetUserId) {
                userRef = db.collection("users").doc(targetUserId);
                userDoc = await transaction.get(userRef);
            }

            transaction.update(appRef, {
                status: "approved",
                approvedAt: FieldValue.serverTimestamp(),
                approvedBy: mockAdminId,
                reviewedAt: FieldValue.serverTimestamp(),
                reviewedBy: mockAdminId,
                approvalTimestamp: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1),
            });

            if (targetUserId && userRef) {
                if (!userDoc || !userDoc.exists) {
                    transaction.set(userRef, {
                        uid: targetUserId,
                        email: appData?.email || appData?.userEmail || "",
                        fullName: [appData?.firstName, appData?.otherNames, appData?.surname].filter(Boolean).join(" ").trim() || "WAVE Participant",
                        createdAt: FieldValue.serverTimestamp(),
                        roles: ["wave_participant"],
                        isVerified: true,
                    });
                }
                
                const updates: any = {
                    isVerified: true,
                    verifiedBy: mockAdminId,
                    verifiedAt: FieldValue.serverTimestamp(),
                    roles: FieldValue.arrayUnion("wave_participant"),
                    "serviceRegistrations.wave.status": "approved",
                    "serviceRegistrations.wave.paymentStatus": "completed",
                    "serviceRegistrations.wave.approvedAt": FieldValue.serverTimestamp(),
                    waveStatus: "active",
                    updatedAt: FieldValue.serverTimestamp(),
                    _version: FieldValue.increment(1),
                };

                transaction.update(userRef, updates);

                const memberRef = db.collection("wave_members").doc(targetUserId);
                transaction.set(memberRef, {
                    active: true,
                    enrolledAt: FieldValue.serverTimestamp(),
                    applicationId: applicationId,
                    updatedAt: FieldValue.serverTimestamp(),
                    _version: FieldValue.increment(1),
                }, { merge: true });
            }
        });
        console.log("SUCCESS: WAVE application approved!");
    } catch (e: any) {
        console.error("FAILED WAVE application approval:", e.message, e.stack);
    }
}

async function testAcademyApproval() {
    console.log("\n--- Testing Academy Application Approval ---");
    try {
        const pendingSnap = await db.collection("academy_applications")
            .where("status", "==", "pending")
            .limit(1)
            .get();

        if (pendingSnap.empty) {
            console.log("No pending Academy applications found.");
            return;
        }

        const doc = pendingSnap.docs[0];
        const applicationId = doc.id;
        const appData = doc.data();
        const userId = appData.userId;
        console.log(`Found pending Academy application: ${applicationId}, User ID: ${userId}`);

        await db.runTransaction(async (transaction) => {
            const appRef = db.collection("academy_applications").doc(applicationId);
            const userRef = db.collection("users").doc(userId);
            const userDoc = await transaction.get(userRef);

            transaction.update(appRef, {
                status: "approved",
                reviewedBy: mockAdminId,
                reviewedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1),
            });

            if (!userDoc.exists) {
                const pi = appData.personalInfo || {};
                transaction.set(userRef, {
                    uid: userId,
                    email: pi.email || appData.email || "",
                    fullName: pi.fullName || (pi.firstName ? `${pi.firstName} ${pi.lastName || ''}`.trim() : "Learner"),
                    createdAt: FieldValue.serverTimestamp(),
                    roles: ["academy_participant"],
                    isVerified: true,
                });
            }

            transaction.set(userRef, {
                isVerified: true,
                verifiedBy: mockAdminId,
                verifiedAt: FieldValue.serverTimestamp(),
                roles: FieldValue.arrayUnion("academy_participant"),
                updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });

            transaction.update(userRef, {
                "serviceRegistrations.academy.status": "approved",
                "serviceRegistrations.academy.applicationId": applicationId,
                "serviceRegistrations.academy.approvedAt": FieldValue.serverTimestamp(),
            });
        });
        console.log("SUCCESS: Academy application approved!");
    } catch (e: any) {
        console.error("FAILED Academy application approval:", e.message, e.stack);
    }
}

async function main() {
    await testCoopApproval();
    await testWaveApproval();
    await testAcademyApproval();
}

main();
