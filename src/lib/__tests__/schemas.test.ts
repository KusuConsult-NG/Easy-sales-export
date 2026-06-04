import { loginSchema, registerSchema } from "../schemas";

describe("Login and Registration Schema Validation", () => {
    describe("loginSchema (Relaxed Validation for Compatibility)", () => {
        it("accepts valid email with plus addressing", () => {
            const result = loginSchema.safeParse({
                email: "user+onboarding@example.com",
                password: "password123",
            });
            expect(result.success).toBe(true);
        });

        it("accepts Gmail addresses with more than 2 periods in the prefix", () => {
            const result = loginSchema.safeParse({
                email: "first.middle.last.suffix@gmail.com",
                password: "password123",
            });
            expect(result.success).toBe(true);
        });

        it("accepts passwords of exactly 6 characters (e.g., legacy onboarding PINs)", () => {
            const result = loginSchema.safeParse({
                email: "user@example.com",
                password: "123456",
            });
            expect(result.success).toBe(true);
        });

        it("rejects passwords shorter than 6 characters", () => {
            const result = loginSchema.safeParse({
                email: "user@example.com",
                password: "12345",
            });
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error.issues[0].message).toContain("at least 6 characters");
            }
        });
    });

    describe("registerSchema (Strict Validation for Account Security)", () => {
        it("rejects emails with plus signs in registration", () => {
            const result = registerSchema.safeParse({
                fullName: "John Doe",
                email: "user+1@example.com",
                phone: "08012345678",
                password: "Password123!",
                confirmPassword: "Password123!",
            });
            expect(result.success).toBe(false);
        });

        it("rejects Gmail addresses with more than 2 periods in registration", () => {
            const result = registerSchema.safeParse({
                fullName: "John Doe",
                email: "first.second.third.fourth@gmail.com",
                phone: "08012345678",
                password: "Password123!",
                confirmPassword: "Password123!",
            });
            expect(result.success).toBe(false);
        });

        it("rejects weak passwords missing uppercase/special characters in registration", () => {
            const result = registerSchema.safeParse({
                fullName: "John Doe",
                email: "user@example.com",
                phone: "08012345678",
                password: "password123",
                confirmPassword: "password123",
            });
            expect(result.success).toBe(false);
        });
    });
});
