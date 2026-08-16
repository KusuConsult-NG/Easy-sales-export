/**
 * The logger must record WHY something failed, not just that it did.
 *
 * WHAT WAS WRONG
 * --------------
 * formatMessage did `JSON.stringify(metadata)`. An Error's `message` and
 * `stack` are non-enumerable own properties, so JSON.stringify(new Error("x"))
 * is `{}` — not a truncation, a total loss.
 *
 * logger.error() has always extracted message and stack by hand. warn(), info()
 * and debug() never did, and 14 call sites pass a caught error to them, e.g.
 *
 *     logger.warn("Revalidation failed (expected in test/script environments):", revalError)
 *     logger.warn("[auth-revocation] legacy revocation skipped", { userId, message: err?.message })
 *
 * The first printed the sentence and `{}`. On a codebase whose problem is
 * repeated production breakage, the reason for a failure being discarded at the
 * moment it is recorded is worth more than most of the individual bugs.
 *
 * THE ASSERTIONS ARE ABOUT CONTENT, NOT ABOUT NOT THROWING.
 * Each one names a substring that must appear in the output. A logger that
 * printed `[object Object]` would satisfy "did not throw" and satisfy nothing
 * here.
 */

import { logger } from "@/lib/logger";

function captureWarn(fn: () => void): string {
    const spy = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
        fn();
        return spy.mock.calls.map(c => c.join(" ")).join("\n");
    } finally {
        spy.mockRestore();
    }
}

describe("logger metadata serialisation", () => {
    it("records an Error's message when it is passed as metadata", () => {
        // The exact shape of the 14 call sites. Previously printed `{}`.
        const output = captureWarn(() => {
            logger.warn("Revalidation failed:", new Error("revalidateTag is not available"));
        });

        expect(output).toContain("Revalidation failed:");
        expect(output).toContain("revalidateTag is not available");
    });

    it("records the stack too", () => {
        const output = captureWarn(() => {
            logger.warn("boom", new Error("with a stack"));
        });

        expect(output).toContain("stack");
        expect(output).toContain("logger-error-metadata.test.ts");
    });

    it("records an Error nested inside a metadata object", () => {
        // The other common shape: { userId, error }. The object is enumerable
        // so it stringified, but the Error inside it still collapsed to {}.
        const output = captureWarn(() => {
            logger.warn("[auth-revocation] legacy revocation skipped", {
                userId: "user-123",
                error: new Error("no legacy record"),
            });
        });

        expect(output).toContain("user-123");
        expect(output).toContain("no legacy record");
    });

    it("keeps a code property, which Firebase and Supabase errors carry", () => {
        const err: any = new Error("User not found");
        err.code = "auth/user-not-found";

        const output = captureWarn(() => logger.warn("lookup failed", err));

        expect(output).toContain("auth/user-not-found");
        expect(output).toContain("User not found");
    });

    it("does not throw on a circular structure", () => {
        // Callers pass request-shaped objects. JSON.stringify throws on a
        // cycle, and a logger that throws turns a handled failure into an
        // unhandled one — inside the catch block meant to contain it.
        const cyclic: any = { name: "request" };
        cyclic.self = cyclic;

        expect(() => captureWarn(() => logger.warn("cyclic", cyclic))).not.toThrow();

        const output = captureWarn(() => logger.warn("cyclic", cyclic));
        expect(output).toContain("request");
        expect(output).toContain("[Circular]");
    });

    it("still prints a bare message with no metadata", () => {
        const output = captureWarn(() => logger.warn("just a message"));
        expect(output).toContain("just a message");
        expect(output).not.toContain("undefined");
    });

    it("demonstrates what JSON.stringify alone does to an Error", () => {
        // Pinning the cause, so the helper cannot later be "simplified" back.
        expect(JSON.stringify(new Error("lost"))).toBe("{}");
        expect(JSON.stringify({ error: new Error("lost") })).toBe('{"error":{}}');
    });
});
