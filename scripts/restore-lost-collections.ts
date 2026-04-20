import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

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

const mockAcademyApplications = [
    {
        userId: "sample-user-2",
        fullName: "Samuel Adebayo",
        email: "samuel@example.com",
        phone: "08098765432",
        courseId: "export-fundamentals",
        status: "pending",
        businessName: "Adebayo Logistics",
        experienceLevel: "beginner",
        createdAt: new Date(Date.now() - 86400000),
        updatedAt: new Date(Date.now() - 86400000)
    },
    {
        userId: "sample-user-3",
        fullName: "Grace Ojo",
        email: "grace@example.com",
        phone: "07011223344",
        courseId: "compliance-standards",
        status: "approved",
        businessName: "Gracie Exports",
        experienceLevel: "intermediate",
        createdAt: new Date(Date.now() - 172800000),
        updatedAt: new Date(Date.now() - 86400000)
    }
];

const mockDocumentUploads = [
    {
        userId: "sample-user-1",
        docType: "national_id",
        fileUrl: "https://example.com/mock-id.pdf",
        status: "verified",
        uploadedAt: new Date(Date.now() - 259200000)
    }
];

const mockAuditLogs = [
    {
        action: "login",
        userEmail: "steviekusu@gmail.com",
        resource: "admin_dashboard",
        status: "success",
        ipAddress: "192.168.1.1",
        timestamp: new Date()
    },
    {
        action: "view_user",
        userEmail: "steviekusu@gmail.com",
        resource: "user_management",
        status: "success",
        ipAddress: "192.168.1.1",
        timestamp: new Date()
    }
];

const mockBroadcastLogs = [
    {
        type: "email",
        subject: "Q2 2026 Export Windows Open",
        recipientCount: 50,
        status: "completed",
        sentBy: "steviekusu@gmail.com",
        sentAt: new Date(Date.now() - 5000000)
    }
];

const mockChatbotMessages = [
    {
        userId: "sample-user-1",
        message: "How do I invest in the yam export window?",
        sender: "user",
        timestamp: new Date(Date.now() - 3600000)
    },
    {
        userId: "sample-user-1",
        message: "You can invest by navigating to the Export Windows tab and selecting the Yam Export Q2 option.",
        sender: "bot",
        timestamp: new Date(Date.now() - 3590000)
    }
];

const mockQoreIDWebhookHistory = [
    {
        eventId: "evt_123456789",
        type: "identity.verification.success",
        data: {
            applicantId: "sample-user-1",
            status: "verified"
        },
        receivedAt: new Date(Date.now() - 86400000)
    }
];

async function restore() {
    console.log("Restoring mock data for wiped collections...");
    try {
        for (const doc of mockAcademyApplications) await db.collection("academy_applications").add(doc);
        console.log("✅ Restored academy_applications");

        for (const doc of mockDocumentUploads) await db.collection("_document_uploads").add(doc);
        console.log("✅ Restored _document_uploads");

        for (const doc of mockAuditLogs) await db.collection("audit_logs").add(doc);
        console.log("✅ Restored audit_logs");

        for (const doc of mockBroadcastLogs) await db.collection("broadcast_logs").add(doc);
        console.log("✅ Restored broadcast_logs");

        for (const doc of mockChatbotMessages) await db.collection("chatbot_messages").add(doc);
        console.log("✅ Restored chatbot_messages");

        for (const doc of mockQoreIDWebhookHistory) await db.collection("_qoreid_webhook_history").add(doc);
        console.log("✅ Restored _qoreid_webhook_history");

        console.log("\n🚀 All lost mock/stub data has been successfully restored and re-seeded.");
    } catch(e) {
        console.error("❌ Error restoring data:", e);
    }
    process.exit(0);
}

restore();
