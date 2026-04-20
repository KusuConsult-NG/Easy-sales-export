/**
 * Firestore Database Seeder
 *
 * Utility to populate Firestore with sample data for development and testing.
 * Run once to seed initial data: npm run seed
 *
 * Usage:
 *   npx ts-node -e "require('./scripts/seed-database').seedAll()"
 */

import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config({ path: ".env.local" });

// Initialize Firebase Admin (matches pattern used in all other scripts)
if (!getApps().length) {
    initializeApp({
        credential: cert({
            projectId: process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL || process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
            privateKey: (process.env.FIREBASE_PRIVATE_KEY || process.env.FIREBASE_ADMIN_PRIVATE_KEY)?.replace(/\\n/g, "\n"),
        }),
    });
}

const db = getFirestore();

// Inline COLLECTIONS to avoid Next.js @/ path alias
const COLLECTIONS = {
    USERS: "users",
    PRODUCTS: "products",
    ORDERS: "orders",
    EXPORT_WINDOWS: "export_windows",
    EXPORT_INVESTMENTS: "export_investments",
    COOPERATIVES: "cooperatives",
    WAVE_APPLICATIONS: "wave_applications",
    DISPUTES: "disputes",
    ANNOUNCEMENTS: "announcements",
    NOTIFICATIONS: "notifications",
    ACADEMY_COURSES: "academy_courses",
    COURSES: "courses",
    LAND_LISTINGS: "land_listings",
} as const;

// ========================
// PRODUCTS
// ========================
const sampleProducts = [
    {
        name: "Premium Nigerian Yams",
        description: "High-quality yams sourced from sustainable farms in Benue State.",
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

// ========================
// LAND LISTINGS (Farm Nation)
// ========================
const sampleProperties = [
    {
        title: "5 Hectare Farmland - Ogun State",
        description: "Prime agricultural land suitable for cassava, maize, and vegetable farming.",
        location: { state: "Ogun", lga: "Obafemi Owode", address: "KM 45, Abeokuta-Lagos Expressway" },
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
        description: "Established rice farm with irrigation system. Producing 8 tons per hectare.",
        location: { state: "Niger", lga: "Mokwa", address: "Mokwa-Jebba Road, Niger State" },
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

// ========================
// WAVE APPLICATIONS
// ========================
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

// ========================
// COOPERATIVES
// ========================
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

// ========================
// EXPORT WINDOWS
// ========================
const sampleExportWindows = [
    {
        title: "Q2 2026 Yam Export - Phase 1",
        commodity: "yam",
        description: "Premium yam tubers destined for UK and EU markets. Grade A export quality verified by NAFDAC.",
        destination: "United Kingdom",
        roi: "18-22%",
        roiPercent: 20,
        investmentCap: 50000000,
        totalInvested: 28500000,
        fundingProgress: 57,
        minInvestment: 50000,
        maxInvestment: 5000000,
        totalSpots: 200,
        spotsFilled: 114,
        status: "open",
        isActive: true,
        quantity: "50 tons",
        amount: 50000,
        duration: "4 months",
        specifications: ["Grade A quality", "NAFDAC certified", "PHYTOSANITARY certificate included", "Cold chain logistics"],
        benefits: ["Guaranteed buy-back", "Insurance coverage", "Quarterly ROI disbursement"],
        startDate: new Date("2026-03-01"),
        endDate: new Date("2026-06-30"),
        deadline: new Date("2026-03-15"),
        image: "/images/windows/yam-export.jpg",
        createdAt: new Date(),
        updatedAt: new Date(),
    },
    {
        title: "Q1 2026 Sesame Seed Export",
        commodity: "sesame",
        description: "High-quality sesame seeds bound for Dubai and GCC markets. Organic certified.",
        destination: "Dubai, UAE",
        roi: "16-20%",
        roiPercent: 18,
        investmentCap: 80000000,
        totalInvested: 78500000,
        fundingProgress: 98,
        minInvestment: 100000,
        maxInvestment: 10000000,
        totalSpots: 150,
        spotsFilled: 148,
        status: "funded",
        isActive: true,
        quantity: "80 tons",
        amount: 100000,
        duration: "6 months",
        specifications: ["Organic certified", "Moisture < 6%", "Sortex cleaned", "HACCP compliant"],
        benefits: ["Premium pricing", "Organic premium bonus", "Bi-monthly updates"],
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-07-31"),
        deadline: new Date("2026-01-20"),
        image: "/images/windows/sesame-export.jpg",
        createdAt: new Date(),
        updatedAt: new Date(),
    },
    {
        title: "2025 Hibiscus Export - Global",
        commodity: "hibiscus",
        description: "Premium dried hibiscus (zobo) flowers shipped to Europe and North America.",
        destination: "Germany & USA",
        roi: "15-18%",
        roiPercent: 16.5,
        investmentCap: 30000000,
        totalInvested: 30000000,
        fundingProgress: 100,
        minInvestment: 50000,
        maxInvestment: 3000000,
        totalSpots: 100,
        spotsFilled: 100,
        status: "in_transit",
        isActive: false,
        quantity: "30 tons",
        amount: 50000,
        duration: "5 months",
        specifications: ["Sun-dried", "EU food safety standard", "Moisture < 8%"],
        benefits: ["Premium EU market pricing", "Full insurance", "Real-time shipment tracking"],
        startDate: new Date("2025-10-01"),
        endDate: new Date("2026-03-01"),
        deadline: new Date("2025-10-15"),
        image: "/images/windows/hibiscus-export.jpg",
        createdAt: new Date(),
        updatedAt: new Date(),
    },
];

// ========================
// DISPUTES
// ========================
const sampleDisputes = [
    {
        orderId: "ORD-2026-0001",
        buyerName: "Chukwuemeka Obi",
        buyerEmail: "obi@example.com",
        sellerName: "Adewale Farms",
        sellerEmail: "adewale@example.com",
        reason: "Items received did not match description — quality was Grade B, not Grade A as listed.",
        description: "I ordered 2 tons of Grade A yam but received Grade B. The seller has not responded to my messages about the discrepancy.",
        status: "open",
        amount: 300000,
        timeline: [
            { event: "Dispute opened", timestamp: new Date(), description: "Buyer raised dispute for order ORD-2026-0001" }
        ],
        adminNotes: "",
        createdAt: new Date(),
        updatedAt: new Date(),
    },
    {
        orderId: "ORD-2026-0002",
        buyerName: "Fatima Bello",
        buyerEmail: "fatima@example.com",
        sellerName: "Kano Agro Ventures",
        sellerEmail: "kano@example.com",
        reason: "Seller claims delivery was made but I never received the goods.",
        description: "Tracking shows delivered but I was not home and no notice was left. Goods are missing.",
        status: "awaiting_evidence",
        amount: 520000,
        timeline: [
            { event: "Dispute opened", timestamp: new Date(Date.now() - 86400000), description: "Buyer raised delivery dispute" },
            { event: "Evidence requested", timestamp: new Date(), description: "Admin requested proof of delivery from seller" }
        ],
        adminNotes: "Awaiting delivery screenshot from seller. Expected within 48 hours.",
        createdAt: new Date(Date.now() - 86400000),
        updatedAt: new Date(),
    },
    {
        orderId: "ORD-2025-0087",
        buyerName: "Ibrahim Sule",
        buyerEmail: "ibrahim@example.com",
        sellerName: "Kaduna Botanicals",
        sellerEmail: "kaduna@example.com",
        reason: "Hibiscus flowers arrived with mold. Clearly not fresh.",
        description: "The 50kg shipment arrived with visible mold on 20% of the product. Unusable for export.",
        status: "resolved",
        resolution: "Ruled in buyer's favor. Refund of ₦19,000 processed.",
        amount: 19000,
        timeline: [
            { event: "Dispute opened", timestamp: new Date(Date.now() - 604800000), description: "Buyer opened dispute for moldy goods" },
            { event: "Evidence submitted", timestamp: new Date(Date.now() - 432000000), description: "Buyer submitted photos of mold" },
            { event: "Dispute resolved", timestamp: new Date(), description: "Admin ruled in buyer's favor. Refund issued." }
        ],
        resolvedAt: new Date(),
        adminNotes: "Buyer provided clear photographic evidence. Refund approved.",
        createdAt: new Date(Date.now() - 604800000),
        updatedAt: new Date(),
    },
];

// ========================
// ANNOUNCEMENTS
// ========================
const sampleAnnouncements = [
    {
        title: "Q2 2026 Export Windows Now Open",
        message: "New export investment windows for Yam, Sesame, and Hibiscus are now open for the Q2 2026 cycle. Login to view available slots and invest.",
        type: "success",
        targetRoles: ["member", "admin"],
        createdAt: new Date(),
    },
    {
        title: "Platform Maintenance — Feb 28, 2026",
        message: "The platform will undergo scheduled maintenance on February 28, 2026 from 2:00 AM to 5:00 AM WAT. Services will be temporarily unavailable.",
        type: "warning",
        targetRoles: ["member", "admin", "wave_member"],
        createdAt: new Date(Date.now() - 86400000),
    },
    {
        title: "WAVE Program 2026 Applications Open",
        message: "Applications for the 2026 WAVE (Women Agri-Export Empowerment) cohort are now open. Eligible female agro-entrepreneurs can apply before March 31, 2026.",
        type: "info",
        targetRoles: ["member"],
        createdAt: new Date(Date.now() - 172800000),
    },
];

// ========================
// ACADEMY COURSES
// ========================
const sampleCourses = [
    {
        title: "Export Business Fundamentals",
        description: "Learn the basics of agricultural export — from produce selection and grading to logistics, documentation, and market entry strategies.",
        instructor: "Dr. Aminu Yusuf",
        duration: "4 weeks",
        level: "beginner",
        price: 15000,
        currency: "NGN",
        category: "export",
        enrolledCount: 0,
        rating: 4.8,
        status: "open",
        thumbnail: "/images/courses/export-fundamentals.jpg",
        createdAt: new Date(),
        updatedAt: new Date(),
    },
    {
        title: "Phytosanitary Compliance & Standards",
        description: "Master the regulatory requirements for agricultural exports including NAFDAC certification, EU SPS regulations, and NExIM documentation.",
        instructor: "Mrs. Blessing Okonkwo",
        duration: "3 weeks",
        level: "intermediate",
        price: 22000,
        currency: "NGN",
        category: "compliance",
        enrolledCount: 0,
        rating: 4.6,
        status: "open",
        thumbnail: "/images/courses/compliance.jpg",
        createdAt: new Date(),
        updatedAt: new Date(),
    },
    {
        title: "Advanced Agro-Export Market Analysis",
        description: "Deep-dive into global commodity markets, price discovery, futures contracts, buyer-seller negotiation strategies, and hedging techniques.",
        instructor: "Prof. Kabiru Salisu",
        duration: "6 weeks",
        level: "advanced",
        price: 35000,
        currency: "NGN",
        category: "business",
        enrolledCount: 0,
        rating: 4.9,
        status: "upcoming",
        thumbnail: "/images/courses/market-analysis.jpg",
        createdAt: new Date(),
        updatedAt: new Date(),
    },
];

// ========================
// NOTIFICATIONS (template)
// ========================
const sampleNotifications = [
    {
        userId: "sample-user-1",
        type: "system",
        title: "Welcome to Easy Sales Export!",
        message: "Your account is set up. Start by exploring the export windows or joining the cooperative.",
        link: "/dashboard",
        read: false,
        createdAt: new Date(),
    },
    {
        userId: "sample-user-1",
        type: "export",
        title: "New Export Window Available",
        message: "A new Q2 2026 Yam Export window is now open for investment.",
        link: "/export/windows",
        read: false,
        createdAt: new Date(Date.now() - 3600000),
    },
];

// ========================
// SEED FUNCTIONS
// ========================

export async function seedProducts() {
    console.log("🌱 Seeding marketplace products...");
    for (const product of sampleProducts) {
        await db.collection(COLLECTIONS.PRODUCTS).add(product);
    }
    console.log(`✅ Seeded ${sampleProducts.length} products`);
}

export async function seedLandListings() {
    console.log("🌱 Seeding land listings...");
    for (const property of sampleProperties) {
        await db.collection("land_listings").add(property);
    }
    console.log(`✅ Seeded ${sampleProperties.length} land listings`);
}

export async function seedWaveApplications() {
    console.log("🌱 Seeding WAVE applications...");
    for (const application of sampleWaveApplications) {
        await db.collection(COLLECTIONS.WAVE_APPLICATIONS).add(application);
    }
    console.log(`✅ Seeded ${sampleWaveApplications.length} WAVE applications`);
}

export async function seedCooperatives() {
    console.log("🌱 Seeding cooperatives...");
    for (const coop of sampleCooperatives) {
        await db.collection(COLLECTIONS.COOPERATIVES).add(coop);
    }
    console.log(`✅ Seeded ${sampleCooperatives.length} cooperatives`);
}

export async function seedExportWindows() {
    console.log("🌱 Seeding export windows...");
    for (const win of sampleExportWindows) {
        await db.collection(COLLECTIONS.EXPORT_WINDOWS).add(win);
    }
    console.log(`✅ Seeded ${sampleExportWindows.length} export windows`);
}

export async function seedDisputes() {
    console.log("🌱 Seeding disputes...");
    for (const dispute of sampleDisputes) {
        await db.collection(COLLECTIONS.DISPUTES).add(dispute);
    }
    console.log(`✅ Seeded ${sampleDisputes.length} disputes`);
}

export async function seedAnnouncements() {
    console.log("🌱 Seeding announcements...");
    for (const announcement of sampleAnnouncements) {
        await db.collection(COLLECTIONS.ANNOUNCEMENTS).add(announcement);
    }
    console.log(`✅ Seeded ${sampleAnnouncements.length} announcements`);
}

export async function seedCourses() {
    console.log("🌱 Seeding academy courses...");
    for (const course of sampleCourses) {
        await db.collection(COLLECTIONS.ACADEMY_COURSES).add(course);
    }
    // Also seed to COURSES collection for cross-compatibility
    for (const course of sampleCourses) {
        await db.collection(COLLECTIONS.COURSES).add(course);
    }
    console.log(`✅ Seeded ${sampleCourses.length} courses`);
}

export async function seedNotifications() {
    console.log("🌱 Seeding sample notifications...");
    for (const notif of sampleNotifications) {
        await db.collection(COLLECTIONS.NOTIFICATIONS).add(notif);
    }
    console.log(`✅ Seeded ${sampleNotifications.length} notifications`);
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
        await seedExportWindows();
        await seedDisputes();
        await seedAnnouncements();
        await seedCourses();
        await seedNotifications();

        console.log("\n✅ Database seeding completed successfully!");
        console.log(`\nCollections seeded:
  • products          (${sampleProducts.length})
  • land_listings     (${sampleProperties.length})
  • wave_applications (${sampleWaveApplications.length})
  • cooperatives      (${sampleCooperatives.length})
  • export_windows    (${sampleExportWindows.length})
  • disputes          (${sampleDisputes.length})
  • announcements     (${sampleAnnouncements.length})
  • academy_courses   (${sampleCourses.length})
  • notifications     (${sampleNotifications.length})`);
    } catch (error) {
        console.error("\n❌ Database seeding failed:", error);
        throw error;
    }
}

// Run if executed directly
// @ts-expect-error — Node globals available at runtime via ts-node
if (require.main === module) {
    seedAll()
        // @ts-expect-error TODO: fix
        .then(() => process.exit(0))
        .catch((error: unknown) => {
            console.error(error);
            // @ts-expect-error TODO: fix
            process.exit(1);
        });
}
