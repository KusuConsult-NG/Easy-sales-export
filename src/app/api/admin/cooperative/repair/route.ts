import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase-admin";
import { logger } from "@/lib/logger";

/**
 * API Route: Repair cooperative_members documents
 * Ensures all records have safe defaults for every field the admin portal expects.
 * Run once, then delete this file.
 */
export async function POST() {
    try {
        const session = await auth();
        if (!session?.user?.roles?.includes("admin") && !session?.user?.roles?.includes("super_admin")) {
            return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 403 });
        }

        const snapshot = await db.collection("cooperative_members").get();
        let fixed = 0;
        let skipped = 0;
        const details: { id: string; action: string }[] = [];

        for (const doc of snapshot.docs) {
            const data = doc.data();
            const updates: Record<string, any> = {};

            // Ensure nextOfKin is a proper object
            if (!data.nextOfKin || typeof data.nextOfKin !== "object") {
                updates.nextOfKin = {
                    name: data.nextOfKinName || "",
                    phone: data.nextOfKinPhone || "",
                    address: data.nextOfKinAddress || "",
                };
            } else {
                // Ensure all sub-fields exist
                if (!data.nextOfKin.name && !data.nextOfKin.phone) {
                    updates.nextOfKin = {
                        name: data.nextOfKin.name || data.nextOfKinName || "",
                        phone: data.nextOfKin.phone || data.nextOfKinPhone || "",
                        address: data.nextOfKin.address || data.nextOfKinAddress || "",
                    };
                }
            }

            // Ensure basic required fields exist
            if (!data.firstName) updates.firstName = "";
            if (!data.lastName) updates.lastName = "";
            if (!data.email) updates.email = "";
            if (!data.phone) updates.phone = "";
            if (!data.dateOfBirth) updates.dateOfBirth = "";
            if (!data.gender) updates.gender = "";
            if (!data.stateOfOrigin) updates.stateOfOrigin = "";
            if (!data.lga) updates.lga = "";
            if (!data.residentialAddress) updates.residentialAddress = "";
            if (!data.occupation) updates.occupation = "";
            if (data.membershipTier === undefined) updates.membershipTier = "basic";
            if (data.registrationFee === undefined) updates.registrationFee = 0;
            if (!data.membershipStatus) updates.membershipStatus = "pending";
            if (!data.paymentStatus) updates.paymentStatus = "pending";

            if (Object.keys(updates).length > 0) {
                await doc.ref.update(updates);
                fixed++;
                details.push({ id: doc.id, action: `Fixed ${Object.keys(updates).length} fields: ${Object.keys(updates).join(", ")}` });
            } else {
                skipped++;
            }
        }

        logger.info(`Cooperative repair: Fixed ${fixed}, Skipped ${skipped} out of ${snapshot.size} docs`);

        return NextResponse.json({
            success: true,
            message: `Repaired ${fixed} documents, ${skipped} already OK (${snapshot.size} total)`,
            details,
        });
    } catch (error: any) {
        logger.error("Cooperative repair failed:", error);
        return NextResponse.json(
            { success: false, message: error.message || "Repair failed" },
            { status: 500 }
        );
    }
}
