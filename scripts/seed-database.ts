/**
 * Firestore Database Seeder
 * 
 * Utility to populate Firestore with sample data for development and testing.
 * Run once to seed initial data: npm run seed
 */

import { db } from "@/lib/firebase";
import { collection, addDoc, setDoc, doc, serverTimestamp } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";

// Sample marketplace products
const sampleProducts = [
    {
        name: "Premium Nigerian Yams",
        description: "High-quality yams sourced from sustainable farms in Benue State. Perfect for export markets.",
        category: "yam",
        price: 150000,
        unit: "per ton",
        quantity: 50,
        farmerId: "sample-farmer-1",
        farmerName: "Adewale Farms",
        location: { state: "Benue", lga: "Makurdi" },
        images: ["/images/products/yams.jpg"],
        isVerified: true,
        status: "available",
        createdAt: new Date(),
        updatedAt: new Date(),
    },
    {
        name: "Organic Sesame Seeds",
        description: "Premium white sesame seeds, organically grown and processed to international standards.",
        category: "sesame",
        price: 520000,
        unit: "per ton",
        quantity: 25,
        farmerId: "sample-farmer-2",
        farmerName: "Kano Agro Ventures",
        location: { state: "Kano", lga: "Kano Municipal" },
        images: ["/images/products/sesame.jpg"],
        isVerified: true,
        status: "available",
        createdAt: new Date(),
        updatedAt: new Date(),
    },
    {
        name: "Dried Hibiscus Flowers",
        description: "Premium Zobo (hibiscus sabdariffa) flowers, sun-dried and ready for export.",
        category: "hibiscus",
        price: 380000,
        unit: "per ton",
        quantity: 40,
        farmerId: "sample-farmer-3",
        farmerName: "Kaduna Botanicals",
        location: { state: "Kaduna", lga: "Zaria" },
        images: ["/images/products/hibiscus.jpg"],
        isVerified: true,
        status: "available",
        createdAt: new Date(),
        updatedAt: new Date(),
    },
];

// Sample Farm Nation properties
const sampleProperties = [
    {
        title: "5 Hectare Farmland - Ogun State",
        description: "Prime agricultural land suitable for cassava, maize, and vegetable farming. Located along Abeokuta-Lagos expressway with easy access.",
        location: {
            state: "Ogun",
            lga: "Obafemi Owode",
            address: "KM 45, Abeokuta-Lagos Expressway",
        },
        size: "5 hectares",
        price: 12500000,
        type: "sale",
        soilType: "Loamy",
        waterAccess: true,
        electricity: false,
        roadAccess: true,
        verificationStatus: "approved",
        ownerId: "sample-owner-1",
        ownerName: "Chief Ogunleye",
        ownerEmail: "ogunleye@example.com",
        images: ["/images/land/ogun-farm.jpg"],
        documents: [],
        createdAt: new Date(),
        updatedAt: new Date(),
    },
    {
        title: "10 Hectare Rice Farm - Niger State",
        description: "Established rice farm with irrigation system. Currently producing 8 tons per hectare. Perfect for large-scale rice farming.",
        location: {
            state: "Niger",
            lga: "Mokwa",
            address: "Mokwa-Jebba Road, Niger State",
        },
        size: "10 hectares",
        price: 28000000,
        type: "sale",
        soilType: "Clay loam",
        waterAccess: true,
        electricity: true,
        roadAccess: true,
        verificationStatus: "approved",
        ownerId: "sample-owner-2",
        ownerName: "Alhaji Musa",
        ownerEmail: "musa@example.com",
        images: ["/images/land/niger-rice.jpg"],
        documents: [],
        createdAt: new Date(),
        updatedAt: new Date(),
    },
];

// Sample WAVE applications
const sampleWaveApplications = [
    {
        userId: "sample-user-1",
        fullName: "Amaka Okafor",
        email: "amaka@example.com",
        phone: "08012345678",
        gender: "female",
        farmingExperience: "5-10 years",
        landSize: "2 hectares",
        commodityInterest: ["yam", "cassava"],
        businessPlan: "Expanding yam production for export markets with modern farming techniques.",
        status: "pending",
        createdAt: new Date(),
        updatedAt: new Date(),
    },
];

// Sample cooperative data
const sampleCooperatives = [
    {
        name: "Lagos Farmers Cooperative",
        location: { state: "Lagos", lga: "Ikeja" },
        memberCount: 45,
        totalSavings: 8750000,
        adminId: "admin-user-1",
        createdAt: new Date(),
        updatedAt: new Date(),
    },
];

/**
 * Seed marketplace products
 */
export async function seedProducts() {
    console.log("🌱 Seeding marketplace products...");

    try {
        for (const product of sampleProducts) {
            await addDoc(collection(db, COLLECTIONS.PRODUCTS), product);
        }
        console.log(`✅ Seeded ${sampleProducts.length} products`);
    } catch (error) {
        console.error("❌ Error seeding products:", error);
        throw error;
    }
}

/**
 * Seed Farm Nation land listings
 */
export async function seedLandListings() {
    console.log("🌱 Seeding land listings...");

    try {
        for (const property of sampleProperties) {
            await addDoc(collection(db, "land_listings"), property);
        }
        console.log(`✅ Seeded ${sampleProperties.length} land listings`);
    } catch (error) {
        console.error("❌ Error seeding land listings:", error);
        throw error;
    }
}

/**
 * Seed WAVE applications
 */
export async function seedWaveApplications() {
    console.log("🌱 Seeding WAVE applications...");

    try {
        for (const application of sampleWaveApplications) {
            await addDoc(collection(db, COLLECTIONS.WAVE_APPLICATIONS), application);
        }
        console.log(`✅ Seeded ${sampleWaveApplications.length} WAVE applications`);
    } catch (error) {
        console.error("❌ Error seeding WAVE applications:", error);
        throw error;
    }
}

/**
 * Seed cooperatives
 */
export async function seedCooperatives() {
    console.log("🌱 Seeding cooperatives...");

    try {
        for (const coop of sampleCooperatives) {
            await addDoc(collection(db, COLLECTIONS.COOPERATIVES), coop);
        }
        console.log(`✅ Seeded ${sampleCooperatives.length} cooperatives`);
    } catch (error) {
        console.error("❌ Error seeding cooperatives:", error);
        throw error;
    }
}

/**
 * Seed all collections
 */
export async function seedAll() {
    console.log("🚀 Starting database seeding...\n");

    try {
        await seedProducts();
        await seedLandListings();
        await seedWaveApplications();
        await seedCooperatives();

        console.log("\n✅ Database seeding completed successfully!");
    } catch (error) {
        console.error("\n❌ Database seeding failed:", error);
        throw error;
    }
}

// Run if executed directly
if (require.main === module) {
    seedAll()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(error);
            process.exit(1);
        });
}
