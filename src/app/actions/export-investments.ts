"use server";

import { db } from "@/lib/firebase-admin";
import { auth } from "@/lib/auth";
import {
    collection,
    query,
    where,
    getDocs,
    doc,
    setDoc,
    orderBy,
    Timestamp
import { COLLECTIONS } from "@/lib/types/firestore";

export type ExportOpportunity = {
    id: string;
    commodity: string;
    destination: string;
    openDate: Date | string;
    closeDate: Date | string;
    minInvestment: number;
    projectedROI: string;
    status: "Open" | "Opening Soon" | "Closed";
    spotsLeft: number;
    totalSpots: number;
    image: string;
};

/**
 * Get all export investment opportunities
 */
export async function getExportOpportunities() {
    try {
        const q = query(
            collection(db, "export_opportunities"),
            orderBy("createdAt", "desc")
        );

        const snapshot = await getDocs(q);

        const opportunities = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                // Convert Timestamps to ISO strings or Dates as needed for serialization
                openDate: data.openDate?.toDate?.().toISOString() || data.openDate,
                closeDate: data.closeDate?.toDate?.().toISOString() || data.closeDate,
            };
        }) as ExportOpportunity[];

        return { success: true, data: opportunities };
    } catch (error: any) {
        console.error("Error fetching export opportunities:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Seed initial export opportunities (Temporary helper) - Admin Only
 */
export async function seedExportOpportunities() {
    const session = await auth();
    if (!session?.user?.roles?.includes("admin") && !session?.user?.roles?.includes("super_admin")) {
        return { success: false, error: "Unauthorized: Admin access required" };
    }

    const minInvestments = [500000, 1000000, 750000, 1500000, 600000, 2000000];
    const opportunities = [
        {
            commodity: "Premium Yam Tubers",
            destination: "United Kingdom",
            openDate: new Date("2024-03-15"),
            closeDate: new Date("2024-03-30"),
            minInvestment: 500000,
            projectedROI: "22%",
            status: "Open",
            spotsLeft: 12,
            totalSpots: 50,
            image: "/images/logo.jpg",
            createdAt: new Date()
        },
        {
            commodity: "Sesame Seeds (White)",
            destination: "China",
            openDate: new Date("2024-03-10"),
            closeDate: new Date("2024-04-05"),
            minInvestment: 1000000,
            projectedROI: "18%",
            status: "Open",
            spotsLeft: 8,
            totalSpots: 40,
            image: "/images/logo.jpg",
            createdAt: new Date()
        },
        {
            commodity: "Dried Hibiscus Flowers",
            destination: "USA",
            openDate: new Date("2024-03-20"),
            closeDate: new Date("2024-04-10"),
            minInvestment: 750000,
            projectedROI: "20%",
            status: "Open",
            spotsLeft: 15,
            totalSpots: 60,
            image: "/images/logo.jpg",
            createdAt: new Date()
        },
        {
            commodity: "Shea Butter (Organic)",
            destination: "France",
            openDate: new Date("2024-03-25"),
            closeDate: new Date("2024-04-15"),
            minInvestment: 1500000,
            projectedROI: "25%",
            status: "Open",
            spotsLeft: 5,
            totalSpots: 30,
            image: "/images/logo.jpg",
            createdAt: new Date()
        },
        {
            commodity: "Ginger (Fresh)",
            destination: "Netherlands",
            openDate: new Date("2024-04-01"),
            closeDate: new Date("2024-04-20"),
            minInvestment: 600000,
            projectedROI: "19%",
            status: "Opening Soon",
            spotsLeft: 20,
            totalSpots: 80,
            image: "/images/logo.jpg",
            createdAt: new Date()
        },
        {
            commodity: "Cashew Nuts (Raw)",
            destination: "Vietnam",
            openDate: new Date("2024-04-05"),
            closeDate: new Date("2024-04-25"),
            minInvestment: 2000000,
            projectedROI: "24%",
            status: "Opening Soon",
            spotsLeft: 10,
            totalSpots: 40,
            image: "/images/logo.jpg",
            createdAt: new Date()
        }
    ];

    try {
        const promises = opportunities.map(async (opp) => {
            const docRef = doc(collection(db, "export_opportunities"));
            await setDoc(docRef, opp);
        });

        await Promise.all(promises);
        return { success: true, message: "Seeded export opportunities" };
    } catch (error: any) {
        console.error("Error seeding:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Get single export opportunity by ID
 */
export async function getExportOpportunityById(id: string) {
    try {
        const docRef = doc(db, "export_opportunities", id);
        // Correct way to get document
        const snapshot = await import("firebase/firestore").then(fs => fs.getDoc(docRef));

        if (!snapshot.exists()) {
            return { success: false, error: "Opportunity not found" };
        }

        const data = snapshot.data();
        const opportunity = {
            id: snapshot.id,
            ...data,
            openDate: data.openDate?.toDate?.().toISOString() || data.openDate,
            closeDate: data.closeDate?.toDate?.().toISOString() || data.closeDate,
        } as ExportOpportunity;

        return { success: true, data: opportunity };
    } catch (error: any) {
        console.error("Error fetching export opportunity:", error);
        return { success: false, error: error.message };
    }
}
