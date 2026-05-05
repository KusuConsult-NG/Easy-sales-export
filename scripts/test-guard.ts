import { requireSession } from "../src/lib/session-guard";
import NextAuth from "next-auth";
import { authConfig } from "../src/lib/auth.config";

// Mocking auth() to return a specific session
jest.mock("next-auth", () => ({
    __esModule: true,
    default: () => ({
        auth: async () => ({
            user: {
                id: "W9VJZdkpxQRSvU8tSlJvMwwibTW2",
                email: "farmnationuser@gmail.com"
            }
        })
    })
}));

async function testGuard() {
    const result = await requireSession();
    console.log("Result:", JSON.stringify(result, null, 2));
}

testGuard();
