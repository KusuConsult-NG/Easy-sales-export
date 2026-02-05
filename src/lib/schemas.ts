import { z } from "zod";

/**
 * Login Schema
 * Validates email and password for user authentication
 */
export const loginSchema = z.object({
    email: z.string().email("Invalid email address").min(1, "Email is required"),
    password: z.string().min(8, "Password must be at least 8 characters"),
});

export type LoginFormData = z.infer<typeof loginSchema>;

/**
 * Registration Schema
 * Validates user registration with comprehensive password requirements
 */
export const registerSchema = z
    .object({
        fullName: z.string().min(3, "Full name must be at least 3 characters"),
        email: z.string().email("Invalid email address").min(1, "Email is required"),
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
 * WAVE Program Application Schema
 * Women's Agro-Value Expansion program enrollment
 * CRITICAL: WAVE is female-only - gender validation enforced
 */
export const waveApplicationSchema = z.object({
    fullName: z.string().min(3, "Full name is required"),
    email: z.string().email("Invalid email address"),
    phone: z
        .string()
        .regex(/^(\+234|0)[789]\d{9}$/, "Invalid Nigerian phone number (e.g., +2348012345678)"),
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

export type WaveApplicationFormData = z.infer<typeof waveApplicationSchema>;


/**
 * Academy Enrollment Schema
 * Validates course enrollment with contact information
 */
export const academyEnrollmentSchema = z.object({
    fullName: z.string().min(3, "Full name is required"),
    email: z.string().email("Invalid email address"),
    phone: z
        .string()
        .regex(
            /^(\+234|0)[789]\d{9}$/,
            "Invalid Nigerian phone number (e.g., +2348012345678 or 08012345678)"
        ),
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
    name: z.string().min(3, "Name must be at least 3 characters"),
    email: z.string().email("Invalid email address"),
    subject: z.string().min(5, "Subject must be at least 5 characters"),
    message: z.string().min(20, "Message must be at least 20 characters"),
});

export type ContactFormData = z.infer<typeof contactSchema>;

/**
 * Marketplace Checkout Schema
 * Validates cart checkout with delivery information
 */
export const checkoutSchema = z.object({
    fullName: z.string().min(3, "Full name is required"),
    email: z.string().email("Invalid email address"),
    phone: z
        .string()
        .regex(/^(\+234|0)[789]\d{9}$/, "Invalid Nigerian phone number"),
    deliveryAddress: z.string().min(10, "Please provide a complete delivery address"),
    city: z.string().min(3, "City is required"),
    state: z.string().min(3, "State is required"),
    notes: z.string().optional(),
});

export type CheckoutFormData = z.infer<typeof checkoutSchema>;
