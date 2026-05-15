import { getStandardCooperativeMembersAction } from "./src/app/actions/cooperative-admin";
import { headers } from "next/headers";

// Mocking headers for Next.js
jest.mock("next/headers", () => ({
    headers: () => new Map(),
}));

async function run() {
    try {
        const res = await getStandardCooperativeMembersAction({ search: "admin" });
        console.log("Success:", res?.data?.length);
    } catch (e: any) {
        console.log("Error:", e.message);
    }
    process.exit(0);
}
run();
