import { z } from "zod";

// ============================================
// STRICT UNIFIED PII VALIDATORS (Anti-Abuse)
// ============================================

export const strictNameSchema = z.string()
    .min(2, "Name must be at least 2 characters")
    .max(50, "Name cannot exceed 50 characters")
    .regex(/^[a-zA-Z\s\-']+$/, "Name can only contain letters, spaces, hyphens and apostrophes")
    .refine(val => {
        // Prevent pentester keyboard smashes: no single block of letters longer than 15 chars
        const words = val.split(/\s|\-|_/);
        return words.every(word => word.length <= 15);
    }, { message: "Name contains unusually long continuous characters (bot detection)" });

export const strictEmailSchema = z.string()
    .email("Invalid email address")
    .toLowerCase()
    .trim()
    .refine((val) => !val.includes('+'), {
        message: "Plus addressing (+) is not permitted for security reasons"
    })
    .refine((val) => {
        // Block Gmail dot-trick abuse (max 2 dots allowed in prefix)
        if (val.endsWith('@gmail.com') || val.endsWith('@googlemail.com')) {
            const localPart = val.split('@')[0];
            const dotCount = (localPart.match(/\./g) || []).length;
            return dotCount <= 2;
        }
        return true;
    }, { message: "Email contains too many periods (possible abuse pattern)" });

export const strictPhoneSchema = z.string()
    .min(7, "Phone number is too short")
    .max(20, "Phone number is too long")
    .regex(/^\+?[0-9\s\-()]+$/, "Invalid phone number format. Please include your country code (e.g., +1234567890)");

export const strictNigerianPhoneSchema = z.string()
    .regex(/^(\+234|0)[789]\d{9}$/, "Invalid Nigerian phone number (e.g., +2348012345678 or 08012345678)");

/**
 * Login Schema
 * Validates email and password for user authentication
 */
export const loginSchema = z.object({
    email: strictEmailSchema,
    password: z.string().min(8, "Password must be at least 8 characters"),
});

export type LoginFormData = z.infer<typeof loginSchema>;

/**
 * Registration Schema
 * Validates user registration with comprehensive password requirements
 */
export const registerSchema = z
    .object({
        fullName: strictNameSchema,
        email: strictEmailSchema,
        phone: strictPhoneSchema,
        gender: z.enum(["male", "female"]).optional(),
        password: z
            .string()
            .min(8, "Password must be at least 8 characters")
            .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
            .regex(/[a-z]/, "Password must contain at least one lowercase letter")
            .regex(/[0-9]/, "Password must contain at least one number")
            .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character"),
        confirmPassword: z.string().min(1, "Please confirm your password"),
    })
    .refine((data) => data.password === data.confirmPassword, {
        message: "Passwords don't match",
        path: ["confirmPassword"],
    });

export type RegisterFormData = z.infer<typeof registerSchema>;

/**
/**
 * @deprecated Legacy WAVE application schema — used ONLY by platform.ts
 * submitWaveApplicationAction (the old single-page form).
 *
 * The current multi-step WAVE application uses a separate, comprehensive
 * 50-field schema defined in src/app/actions/wave.ts.
 *
 * Do NOT extend this schema or use it for new code.
 */
export const waveLegacyApplicationSchema = z.object({
    fullName: strictNameSchema,
    email: strictEmailSchema,
    phone: strictNigerianPhoneSchema,
    gender: z.literal("female"),
    businessName: z.string().min(3, "Business name is required"),
    businessType: z.enum(["farming", "trading", "processing", "other"], {
        message: "Please select a business type",
    }),
    yearsInBusiness: z
        .number()
        .min(0, "Years must be 0 or greater")
        .max(100, "Years must be realistic"),
    reasonForApplying: z.string().min(50, "Please provide at least 50 characters explaining why"),
});

/** @deprecated Alias for backward compatibility with platform.ts */
export const waveApplicationSchema = waveLegacyApplicationSchema;

export type WaveApplicationFormData = z.infer<typeof waveLegacyApplicationSchema>;



/**
 * Academy Enrollment Schema
 * Validates course enrollment with contact information
 */
export const academyEnrollmentSchema = z.object({
    fullName: strictNameSchema,
    email: strictEmailSchema,
    phone: strictPhoneSchema,
    courseId: z.string().min(1, "Course selection is required"),
});

export type AcademyEnrollmentFormData = z.infer<typeof academyEnrollmentSchema>;

/**
 * Cooperative Withdrawal Schema
 * Validates withdrawal requests with balance and amount checks
 */
export const withdrawalSchema = z.object({
    cooperativeId: z.string().min(1, "Cooperative ID is required"),
    amount: z
        .number()
        .positive("Amount must be greater than zero")
        .max(100000000, "Amount exceeds maximum limit"),
    accountNumber: z
        .string()
        .regex(/^\d{10}$/, "Account number must be exactly 10 digits"),
    accountName: z.string().min(3, "Account name is required"),
    bankName: z.string().min(3, "Bank name is required"),
    reason: z.string().optional(),
});

export type WithdrawalFormData = z.infer<typeof withdrawalSchema>;


/**
 * Contact Form Schema
 * Validates contact/support form submissions
 */
export const contactSchema = z.object({
    name: strictNameSchema,
    email: strictEmailSchema,
    subject: z.string().min(5, "Subject must be at least 5 characters"),
    message: z.string().min(20, "Message must be at least 20 characters"),
});

export type ContactFormData = z.infer<typeof contactSchema>;

/**
 * Marketplace Checkout Schema
 * Validates cart checkout with delivery information
 */
export const checkoutSchema = z.object({
    fullName: strictNameSchema,
    email: strictEmailSchema,
    phone: strictPhoneSchema,
    deliveryAddress: z.string().min(10, "Please provide a complete delivery address"),
    city: z.string().min(3, "City is required"),
    state: z.string().min(3, "State is required"),
    notes: z.string().optional(),
});

export type CheckoutFormData = z.infer<typeof checkoutSchema>;

// ============================================
// ADMIN SCHEMAS
// ============================================

export const WaveApplicationReviewSchema = z.object({
    applicationId: z.string().min(1),
    status: z.enum(["approved", "rejected"]),
    reason: z.string().optional(),
}).refine(data => data.status !== "rejected" || !!data.reason, {
    message: "Reason is required when rejecting",
    path: ["reason"],
});

export const ExportOnboardingReviewSchema = z.object({
    applicationId: z.string().min(1),
    status: z.enum(["approved", "rejected"]),
    reason: z.string().optional(),
}).refine(data => data.status !== "rejected" || !!data.reason, {
    message: "Reason is required when rejecting",
    path: ["reason"],
});

export const WithdrawalProcessingSchema = z.object({
    withdrawalId: z.string().min(1),
    action: z.enum(["approve", "reject"]),
    reasoning: z.string().optional(),
}).refine(data => data.action !== "reject" || !!data.reasoning, {
    message: "Reason is required when rejecting",
    path: ["reasoning"],
});

export const UserVerificationToggleSchema = z.object({
    userId: z.string().min(1),
});

export const UserKycVerificationSchema = z.object({
    userId: z.string().min(1),
    field: z.enum(["bvn", "tin", "cac"]),
    currentStatus: z.boolean(),
});

export const LandListingVerificationSchema = z.object({
    listingId: z.string().min(1),
    decision: z.enum(["approved", "rejected"]),
    reason: z.string().optional(),
}).refine(data => data.decision !== "rejected" || !!data.reason, {
    message: "Reason is required when rejecting",
    path: ["reason"],
});


export const LoanApplicationReviewSchema = z.object({
    applicationId: z.string().min(1),
    status: z.enum(["approved", "rejected"]),
    reason: z.string().optional(),
}).refine(data => data.status !== "rejected" || !!data.reason, {
    message: "Reason is required when rejecting",
    path: ["reason"],
});


// ============================================
// ROLE MANAGEMENT SCHEMAS
// ============================================

const UserRoleSchema = z.enum([
    "general_user",
    "buyer",
    "marketplace_buyer",
    "seller",
    "land_owner",
    "farmer",
    "investor",
    "export_participant",
    "cooperative_member",
    "wave_participant",
    "academy_participant",
    "field_officer",
    "admin",
    "super_admin"
]);

export const UpdateUserRolesSchema = z.object({
    userId: z.string().min(1),
    roles: z.array(UserRoleSchema).min(1, "At least one role is required"),
});

/**
 * Legacy Member Onboarding Schema
 * Used by admins to pre-fill onboarding forms for legacy members
 */
export const LegacyOnboardingSchema = z.object({
    fullName: strictNameSchema,
    email: strictEmailSchema,
    phone: strictPhoneSchema,
    gender: z.enum(["male", "female"]).optional(),
    dateOfBirth: z.string().optional(),
    occupation: z.string().optional(),
    roles: z.array(UserRoleSchema).min(1, "At least one role is required"),
    state: z.string().min(2, "State is required").optional(),
    lga: z.string().min(2, "LGA is required").optional(),
    city: z.string().min(2, "City is required").optional(),
    address: z.string().min(5, "Complete address is required").optional(),
    // Next of Kin
    nextOfKinName: z.string().optional(),
    nextOfKinPhone: z.string().optional(),
    nextOfKinRelationship: z.string().optional(),
    nextOfKinAddress: z.string().optional(),
    // Financial Details
    bankName: z.string().optional(),
    accountNumber: z.string().regex(/^\d{10}$/, "Account number must be 10 digits").optional(),
    accountName: z.string().optional(),
    bankCode: z.string().optional(),
    // KYC Details
    nin: z.string().length(11, "NIN must be 11 digits").optional(),
    bvn: z.string().length(11, "BVN must be 11 digits").optional(),
    // Document uploads (Cloudinary URLs set by admin during legacy onboarding)
    validIdUrl: z.string().url("Valid ID must be a valid URL").optional(),
    passportPhotoUrl: z.string().url("Passport photo must be a valid URL").optional(),
    proofOfAddressUrl: z.string().url("Proof of address must be a valid URL").optional(),
    // Academy Plan selection
    academyPlan: z.enum(["foundation", "standard", "elite"]).optional(),
    // Optional service-specific pre-approvals
    services: z.object({
        marketplace: z.boolean().default(false),
        export: z.boolean().default(false),
        cooperative: z.boolean().default(false),
        wave: z.boolean().default(false),
        academy: z.boolean().default(false),
        farmNation: z.boolean().default(false),
    }).optional(),
    exportInfo: z.object({
        companyName: z.string().optional(),
        rcNumber: z.string().optional(),
        yearEstablished: z.string().optional(),
        businessType: z.string().optional(),
        industry: z.string().optional(),
    }).optional(),
    farmNationInfo: z.object({
        role: z.enum(["buyer", "seller", "both"]).optional(),
        farmSize: z.string().optional(),
        cropTypes: z.array(z.string()).optional(),
        propertyTypes: z.array(z.string()).optional(),
        listingTypes: z.array(z.string()).optional(),
        totalAcreage: z.string().optional(),
    }).optional(),
    waveInfo: z.object({
        residentialState: z.string().optional(),
        surname: z.string().optional(),
    }).optional(),
    cooperativeInfo: z.object({
        amount: z.number().optional(),
    }).optional(),
});

export type LegacyOnboardingFormData = z.infer<typeof LegacyOnboardingSchema>;


// ============================================
// ACADEMY SCHEMAS
// ============================================

export const quizQuestionSchema = z.object({
    id: z.string(),
    question: z.string().min(5, "Question must be at least 5 characters"),
    options: z.array(z.string()).min(2, "At least 2 options are required"),
    correctAnswer: z.number().int().min(0),
});

export const quizSchema = z.object({
    id: z.string(),
    questions: z.array(quizQuestionSchema).min(1, "At least one question is required"),
    passingScore: z.number().min(0).max(100),
});

export const lessonSchema = z.object({
    id: z.string(),
    title: z.string().min(3, "Lesson title must be at least 3 characters"),
    content: z.string().min(1, "Lesson content is required"),
    videoUrl: z.string().url().optional().or(z.literal("")).or(z.null()),
    documentUrl: z.string().url().optional().or(z.literal("")).or(z.null()),
    excelUrl: z.string().url().optional().or(z.literal("")).or(z.null()),
    duration: z.string().min(1, "Duration is required"),
    order: z.number().int().min(0),
});

export const courseModuleSchema = z.object({
    id: z.string(),
    title: z.string().min(3, "Module title must be at least 3 characters"),
    description: z.string().min(1, "Module description is required"),
    lessons: z.array(lessonSchema).min(1, "At least one lesson is required"),
    quiz: quizSchema.optional().or(z.null()),
    order: z.number().int().min(0),
});

export const courseSchema = z.object({
    id: z.string().optional(),
    title: z.string().min(5, "Course title must be at least 5 characters"),
    description: z.string().min(20, "Course description must be at least 20 characters"),
    instructor: z.string().min(3, "Instructor name must be at least 3 characters"),
    duration: z.string().min(1, "Duration is required"),
    level: z.enum(["beginner", "intermediate", "advanced"]),
    tier: z.enum(["free", "foundation", "standard", "elite"]).optional().default("free"),
    moduleId: z.string().min(1, "Module ID is required"),
    price: z.number().min(0),
    modules: z.array(courseModuleSchema).min(1, "At least one module is required"),
    thumbnail: z.string().url().optional().or(z.literal("")).or(z.null()),
});

export const AcademyContentSchema = z.object({
    title: z.string().min(5),
    fileUrl: z.string().url(),
    moduleId: z.string(),
    contentType: z.enum(['video', 'pdf', 'quiz']),
    createdAt: z.date().default(() => new Date()),
});

export type QuizQuestionFormData = z.infer<typeof quizQuestionSchema>;
export type QuizFormData = z.infer<typeof quizSchema>;
export type LessonFormData = z.infer<typeof lessonSchema>;
export type CourseModuleFormData = z.infer<typeof courseModuleSchema>;
export type CourseFormData = z.infer<typeof courseSchema>;
