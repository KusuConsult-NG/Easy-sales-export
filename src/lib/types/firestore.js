"use strict";
/**
 * Firestore Database Collections Structure
 *
 * This file documents the complete Firestore database schema
 * for the Easy Sales Export platform.
 *
 * NDPR / SECURITY COMPLIANCE NOTE:
 * All PII (Personally Identifiable Information) including banking details,
 * names, and addresses stored within these collections are automatically
 * Encrypted At Rest using AES-256 by the Firebase/Google Cloud infrastructure.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.COLLECTIONS = exports.LEGACY_ROLE_MAP = exports.ROLE_LABELS = void 0;
// Export PRD-required interfaces
__exportStar(require("./prd-interfaces"), exports);
var roles_1 = require("./roles");
Object.defineProperty(exports, "ROLE_LABELS", { enumerable: true, get: function () { return roles_1.ROLE_LABELS; } });
Object.defineProperty(exports, "LEGACY_ROLE_MAP", { enumerable: true, get: function () { return roles_1.LEGACY_ROLE_MAP; } });
/**
 * Firestore Collection Paths
 */
exports.COLLECTIONS = {
    // Core collections
    USERS: "users",
    NOTIFICATIONS: "notifications",
    TRANSACTIONS: "transactions",
    ANALYTICS: "analytics",
    IDEMPOTENCY_KEYS: "idempotency_keys",
    // Export & Agriculture
    EXPORT_WINDOWS: "exportWindows",
    EXPORT_SLOTS: "export_slots",
    // Cooperatives & Finance
    COOPERATIVES: "cooperatives",
    COOPERATIVES_INVITES: "cooperatives_invites",
    COOPERATIVE_MEMBERS: "cooperative_members",
    COOPERATIVE_TRANSACTIONS: "cooperative_transactions",
    COOPERATIVE_LOANS: "cooperative_loans",
    FIXED_SAVINGS_PLANS: "fixed_savings_plans",
    LOAN_PRODUCTS: "loan_products",
    LOAN_APPLICATIONS: "loan_applications",
    LOAN_REPAYMENTS: "loan_repayments",
    LOAN_PAYMENTS: "loan_payments",
    WITHDRAWALS: "withdrawals",
    PAYMENTS: "payments",
    // WAVE Program
    WAVE_APPLICATIONS: "wave_applications",
    WAVE_RESOURCES: "wave_resources",
    WAVE_TRAINING_EVENTS: "wave_training_events",
    WAVE_TRAINING_REGISTRATIONS: "wave_training_registrations",
    // Land & Marketplace
    PRODUCTS: "products",
    MARKETPLACE_ORDERS: "marketplaceOrders",
    MARKETPLACE_CARTS: "marketplace_carts",
    // Academy
    ACADEMY_APPLICATIONS: "academy_applications",
    ACADEMY_COURSES: "academy_courses",
    ACADEMY_ENROLLMENTS: "academy_enrollments",
    LAND_LISTINGS: "land_listings",
    LAND_VERIFICATIONS: "land_verifications",
    SELLER_VERIFICATIONS: "seller_verifications",
    ESCROW_TRANSACTIONS: "escrow_transactions",
    ESCROW_MESSAGES: "escrow_messages",
    DISPUTES: "disputes",
    PROCESSED_PAYMENTS: "processedPayments",
    FAILED_PAYMENTS: "failedPayments",
    // NEW: Marketplace Expansions (Phase 12)
    WALLETS: "wallets",
    WALLET_TRANSACTIONS: "wallet_transactions",
    VILLAGE_MARKET_EVENTS: "village_market_events",
    FLASH_SALE_PRODUCTS: "flash_sale_products",
    SELLER_REVIEWS: "seller_reviews",
    // Farm Nation
    FARM_NATION_APPLICATIONS: "farm_nation_applications",
    FARM_NATION_PROPERTIES: "farmNationProperties",
    FARM_NATION_TRANSACTIONS: "farm_nation_transactions",
    // NEW: Marketplace Enhancement
    PRODUCT_IMAGES: "product_images",
    SHOPPING_CARTS: "shopping_carts",
    // @deprecated Use MARKETPLACE_ORDERS moving forward to prevent fragmentation
    ORDERS: "orders",
    MESSAGES: "messages",
    CONVERSATIONS: "conversations",
    PRODUCT_REVIEWS: "product_reviews",
    REVIEWS: "product_reviews", // Alias for PRODUCT_REVIEWS
    MARKETPLACE_QUOTES: "marketplace_quotes",
    // Education & Training
    COURSES: "courses",
    ENROLLMENTS: "enrollments",
    ACADEMY_QUIZZES: "academy_quizzes",
    QUIZ_ATTEMPTS: "quiz_attempts",
    ACADEMY_LIVE_SESSIONS: "academy_live_sessions",
    COURSE_PROGRESS: "course_progress",
    COURSE_ENROLLMENTS: "course_enrollments",
    COURSE_CERTIFICATES: "course_certificates",
    CERTIFICATES: "certificates",
    ACADEMY_SETTINGS: "academy_settings",
    // CMS & Admin
    ANNOUNCEMENTS: "announcements",
    BANNERS: "banners",
    AUDIT_LOGS: "audit_logs",
    FEATURE_TOGGLES: "feature_toggles",
    IMPERSONATION_TOKENS: "impersonation_tokens",
    // AI Chatbot (Phase 13)
    CHATBOT_SESSIONS: "chatbot_sessions",
    CHATBOT_MESSAGES: "chatbot_messages",
    // AI & Chat
    AI_CHAT_HISTORY: "ai_chat_history",
    // System
    SYSTEM_SETTINGS: "system_settings",
    // Vendor
    VENDOR_SETTINGS: "vendor_settings",
    VENDOR_REVIEWS: "vendor_reviews",
    // @deprecated Use MARKETPLACE_ORDERS moving forward to prevent fragmentation
    VENDOR_ORDERS: "vendor_orders",
    VENDOR_PRODUCTS: "vendor_products",
    VENDOR_PROFILES: "vendor_profiles",
    // WAVE Resource Access
    WAVE_RESOURCE_ACCESS: "wave_resource_access",
    // Export Investments
    EXPORT_INVESTMENTS: "exportInvestments",
    EXPORT_APPLICATIONS: "export_onboarding_applications",
    // Investor Portfolios
    INVESTOR_PORTFOLIOS: "investorPortfolios",
    PROPERTY_PURCHASES: "propertyPurchases",
    // Withdrawal Requests
    // Marketplace Products & Sellers
    MARKETPLACE_PRODUCTS: "marketplace_products",
    MARKETPLACE_SELLERS: "marketplace_sellers",
    // Admin Users
    ADMIN_USERS: "admin_users",
    // Loans (standalone)
    LOANS: "loans",
    // WAVE — full suite
    WAVE_CERTIFICATES: "wave_certificates",
    WAVE_SHIPMENTS: "wave_shipments",
    WAVE_MEMBERS: "wave_members",
    WAVE_EARNINGS: "wave_earnings",
    WAVE_BRIEFING_REGISTRATIONS: "wave_briefing_registrations",
    // Cooperative onboarding applications
    COOPERATIVE_ONBOARDING: "cooperative_onboarding_applications",
    // KYC / Identity verification records
    KYC_VERIFICATIONS: "kyc_verifications",
    // Farm Nation
    FARM_NATION_INQUIRIES: "farm_nation_inquiries",
    // WAVE / Field briefings (offline submissions)
    BRIEFINGS: "briefing_submissions",
    // Auth
    PASSWORD_RESETS: "password_resets",
    // WAVE Earnings Withdrawals
    WAVE_WITHDRAWALS: "wave_withdrawals",
    // Cooperative Withdrawals (member savings withdrawals)
    COOPERATIVE_WITHDRAWALS: "cooperative_withdrawals",
    // Additional collections
    LAND_INQUIRIES: "land_inquiries",
    USER_ACTIVITY_LOGS: "user_activity_logs",
    COOPERATIVE_FIXED_SAVINGS: "cooperative_fixed_savings",
    COOPERATIVE_LOAN_PRODUCTS: "cooperative_loan_products",
    COOPERATIVE_CONTRIBUTIONS: "cooperative_contributions",
    LESSON_VIDEO_PROGRESS: "lesson_video_progress",
    EXPORT_BOOKINGS: "export_bookings",
    EMAIL_HISTORY: "email_history",
    // Platform / Admin Configuration
    PLATFORM_SETTINGS: "platform_settings",
    // Firestore-backed document uploads (fallback when Storage unavailable)
    DOCUMENT_UPLOADS: "_document_uploads",
    // Export Slots (individual investment slots per user per export window)
    // Note: EXPORT_SLOTS is already defined above — this alias is preferred in new code
    // Admin Communications
    BROADCAST_LOGS: "broadcast_logs",
    // Bounced Email Tracking
    BOUNCED_EMAILS: "bounced_emails",
    // Email Queue (cron-processed outgoing emails)
    EMAIL_QUEUE: "email_queue",
    // WhatsApp Group Invites
    WHATSAPP_INVITES: "whatsapp_invites",
    // Academy Quizzes (standalone collection — distinct from ACADEMY_QUIZZES)
    QUIZZES: "quizzes",
    // Export Catalog (products listed for export buyers)
    EXPORT_CATALOG: "export_catalog",
    // Export Orders (orders placed by international buyers)
    EXPORT_ORDERS: "export_orders",
    // WAVE Training Sessions (scheduled sessions — distinct from WAVE_TRAINING_EVENTS)
    WAVE_TRAINING_SESSIONS: "wave_training_sessions",
    // User-uploaded certificates (KYC / identity documents)
    USER_CERTIFICATES: "user_certificates",
    // Payment Instructions (escrow payment/refund records)
    PAYMENT_INSTRUCTIONS: "paymentInstructions",
};
