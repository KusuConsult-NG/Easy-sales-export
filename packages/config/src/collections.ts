/**
 * Firestore Collection Path Registry
 *
 * Canonical source of truth for all Firestore collection names.
 * Isolated here so every domain app imports from a single shared package.
 *
 * Rules:
 *   1. Never hardcode collection strings in application code
 *   2. All new collections must be added here first
 *   3. Deprecated collections are marked with @deprecated JSDoc
 */
export const COLLECTIONS = {
    // ─── Core / Hub ──────────────────────────────────────────────────────────
    USERS: "users",
    NOTIFICATIONS: "notifications",
    TRANSACTIONS: "transactions",
    ANALYTICS: "analytics",
    IDEMPOTENCY_KEYS: "idempotency_keys",
    AUDIT_LOGS: "audit_logs",
    FEATURE_TOGGLES: "feature_toggles",
    IMPERSONATION_TOKENS: "impersonation_tokens",
    PLATFORM_SETTINGS: "platform_settings",
    SYSTEM_SETTINGS: "system_settings",
    PASSWORD_RESETS: "password_resets",
    BROADCAST_LOGS: "broadcast_logs",
    BOUNCED_EMAILS: "bounced_emails",
    EMAIL_QUEUE: "email_queue",
    EMAIL_HISTORY: "email_history",
    WHATSAPP_INVITES: "whatsapp_invites",
    ANNOUNCEMENTS: "announcements",
    BANNERS: "banners",
    KYC_VERIFICATIONS: "kyc_verifications",
    USER_ACTIVITY_LOGS: "user_activity_logs",
    DOCUMENT_UPLOADS: "_document_uploads",
    USER_CERTIFICATES: "user_certificates",
    ADMIN_USERS: "admin_users",

    // ─── Export Module ────────────────────────────────────────────────────────
    EXPORT_WINDOWS: "exportWindows",
    EXPORT_SLOTS: "export_slots",
    EXPORT_APPLICATIONS: "export_onboarding_applications",
    EXPORT_INVESTMENTS: "exportInvestments",
    EXPORT_BOOKINGS: "export_bookings",
    EXPORT_CATALOG: "export_catalog",
    EXPORT_ORDERS: "export_orders",
    INVESTOR_PORTFOLIOS: "investorPortfolios",
    PROPERTY_PURCHASES: "propertyPurchases",
    PAYMENT_INSTRUCTIONS: "paymentInstructions",

    // ─── Cooperatives & Finance ───────────────────────────────────────────────
    COOPERATIVES: "cooperatives",
    COOPERATIVES_INVITES: "cooperatives_invites",
    COOPERATIVE_MEMBERS: "cooperative_members",
    COOPERATIVE_TRANSACTIONS: "cooperative_transactions",
    COOPERATIVE_LOANS: "cooperative_loans",
    COOPERATIVE_ONBOARDING: "cooperative_onboarding_applications",
    COOPERATIVE_WITHDRAWALS: "cooperative_withdrawals",
    COOPERATIVE_FIXED_SAVINGS: "cooperative_fixed_savings",
    COOPERATIVE_LOAN_PRODUCTS: "cooperative_loan_products",
    COOPERATIVE_CONTRIBUTIONS: "cooperative_contributions",
    FIXED_SAVINGS_PLANS: "fixed_savings_plans",
    LOAN_PRODUCTS: "loan_products",
    LOAN_APPLICATIONS: "loan_applications",
    LOAN_REPAYMENTS: "loan_repayments",
    LOAN_PAYMENTS: "loan_payments",
    LOANS: "loans",
    WITHDRAWALS: "withdrawals",
    PAYMENTS: "payments",
    WALLETS: "wallets",
    WALLET_TRANSACTIONS: "wallet_transactions",

    // ─── WAVE Program ─────────────────────────────────────────────────────────
    WAVE_APPLICATIONS: "wave_applications",
    WAVE_RESOURCES: "wave_resources",
    WAVE_TRAINING_EVENTS: "wave_training_events",
    WAVE_TRAINING_REGISTRATIONS: "wave_training_registrations",
    WAVE_CERTIFICATES: "wave_certificates",
    WAVE_SHIPMENTS: "wave_shipments",
    WAVE_MEMBERS: "wave_members",
    WAVE_EARNINGS: "wave_earnings",
    WAVE_BRIEFING_REGISTRATIONS: "wave_briefing_registrations",
    WAVE_WITHDRAWALS: "wave_withdrawals",
    WAVE_RESOURCE_ACCESS: "wave_resource_access",
    WAVE_TRAINING_SESSIONS: "wave_training_sessions",
    BRIEFINGS: "briefing_submissions",

    // ─── Marketplace ─────────────────────────────────────────────────────────
    PRODUCTS: "products",
    MARKETPLACE_ORDERS: "marketplaceOrders",
    MARKETPLACE_CARTS: "marketplace_carts",
    MARKETPLACE_PRODUCTS: "marketplace_products",
    MARKETPLACE_SELLERS: "marketplace_sellers",
    MARKETPLACE_QUOTES: "marketplace_quotes",
    SELLER_VERIFICATIONS: "seller_verifications",
    ESCROW_TRANSACTIONS: "escrow_transactions",
    ESCROW_MESSAGES: "escrow_messages",
    DISPUTES: "disputes",
    PROCESSED_PAYMENTS: "processedPayments",
    FAILED_PAYMENTS: "failedPayments",
    VILLAGE_MARKET_EVENTS: "village_market_events",
    FLASH_SALE_PRODUCTS: "flash_sale_products",
    SELLER_REVIEWS: "seller_reviews",
    PRODUCT_IMAGES: "product_images",
    SHOPPING_CARTS: "shopping_carts",
    /** @deprecated Use MARKETPLACE_ORDERS — prevents fragmentation */
    ORDERS: "orders",
    MESSAGES: "messages",
    CONVERSATIONS: "conversations",
    PRODUCT_REVIEWS: "product_reviews",
    /** Alias for PRODUCT_REVIEWS */
    REVIEWS: "product_reviews",
    /** @deprecated Use MARKETPLACE_ORDERS */
    VENDOR_ORDERS: "vendor_orders",
    VENDOR_SETTINGS: "vendor_settings",
    VENDOR_REVIEWS: "vendor_reviews",
    VENDOR_PRODUCTS: "vendor_products",
    VENDOR_PROFILES: "vendor_profiles",

    // ─── Academy ─────────────────────────────────────────────────────────────
    ACADEMY_APPLICATIONS: "academy_applications",
    ACADEMY_COURSES: "academy_courses",
    ACADEMY_ENROLLMENTS: "academy_enrollments",
    ACADEMY_QUIZZES: "academy_quizzes",
    QUIZ_ATTEMPTS: "quiz_attempts",
    ACADEMY_LIVE_SESSIONS: "academy_live_sessions",
    COURSE_PROGRESS: "course_progress",
    COURSE_ENROLLMENTS: "course_enrollments",
    COURSE_CERTIFICATES: "course_certificates",
    ACADEMY_SETTINGS: "academy_settings",
    COURSES: "courses",
    ENROLLMENTS: "enrollments",
    CERTIFICATES: "certificates",
    QUIZZES: "quizzes",
    LESSON_VIDEO_PROGRESS: "lesson_video_progress",

    // ─── Farm Nation ──────────────────────────────────────────────────────────
    LAND_LISTINGS: "land_listings",
    LAND_VERIFICATIONS: "land_verifications",
    LAND_INQUIRIES: "land_inquiries",
    FARM_NATION_APPLICATIONS: "farm_nation_applications",
    FARM_NATION_TRANSACTIONS: "farm_nation_transactions",
    FARM_NATION_INQUIRIES: "farm_nation_inquiries",

    // ─── AI Chatbot (Phase 13) ────────────────────────────────────────────────
    CHATBOT_SESSIONS: "chatbot_sessions",
    CHATBOT_MESSAGES: "chatbot_messages",
    AI_CHAT_HISTORY: "ai_chat_history",
} as const;

export type CollectionKey = keyof typeof COLLECTIONS;
export type CollectionPath = typeof COLLECTIONS[CollectionKey];
