/**
 * Tests for src/lib/safe-action.ts
 *
 * Covers:
 *  - withSafeAction: normal success path
 *  - withSafeAction: caught generic Error → { success: false, error: message }
 *  - withSafeAction: Zod validation error → human-readable message (no JSON bleed)
 *  - withSafeAction: Next.js NEXT_REDIRECT digest → rethrows (does not swallow)
 *  - withSafeAction: transient network error → sanitized user-facing message
 *  - withFlexibleSafeAction: success path preserves original return type
 *  - withFlexibleSafeAction: caught error → { success: false, error: message }
 *  - redactSensitiveData: password / pin / token fields are REDACTED in logs
 */

import { withSafeAction, withFlexibleSafeAction } from "@/lib/safe-action";
import { z } from "zod";

// ── Silence internal console.error calls in this file ────────────────────────
beforeAll(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterAll(() => {
  (console.error as jest.Mock).mockRestore();
});

// ── Mock heavy server-only side effects ──────────────────────────────────────
jest.mock("@/app/actions/telemetry", () => ({
  logTelemetryAction: jest.fn(),
}));
jest.mock("@/lib/logger-server", () => ({
  logObservabilityTrace: jest.fn(),
}));
jest.mock("@/lib/session-guard", () => ({
  requireSession: jest.fn(() =>
    Promise.resolve({ session: null, error: null })
  ),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSuccessAction<T>(value: T) {
  return withSafeAction("testSuccess", async () => ({
    success: true as const,
    error: null,
    data: value,
  }));
}

function makeThrowingAction(err: unknown) {
  return withSafeAction("testError", async () => {
    throw err;
  });
}

// ── Tests: withSafeAction ─────────────────────────────────────────────────────

describe("withSafeAction", () => {
  it("returns success result unchanged", async () => {
    const action = makeSuccessAction({ id: "123", name: "test" });
    const result = await action();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ id: "123", name: "test" });
      expect(result.error).toBeNull();
    }
  });

  it("catches a thrown Error and returns { success: false }", async () => {
    const action = makeThrowingAction(new Error("DB connection failed"));
    const result = await action();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("DB connection failed");
      expect(result.data).toBeNull();
    }
  });

  it("catches a thrown string and returns { success: false }", async () => {
    const action = makeThrowingAction("Something went wrong");
    const result = await action();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("An unexpected server error occurred");
    }
  });

  it("formats Zod errors as human-readable path:message", async () => {
    const schema = z.object({ email: z.string().email() });

    const action = withSafeAction("zodTest", async (input: unknown) => {
      schema.parse(input); // throws ZodError
      return { success: true as const, error: null, data: null };
    });

    const result = await action({ email: "not-an-email" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/email/i);
      // Must NOT bleed raw JSON to the client
      expect(result.error).not.toContain('"issues"');
      expect(result.error).not.toContain('"ZodError"');
    }
  });

  it("re-throws NEXT_REDIRECT errors (must not swallow Next.js navigation)", async () => {
    const nextRedirectError = { digest: "NEXT_REDIRECT;replace;/dashboard" };
    const action = makeThrowingAction(nextRedirectError);
    await expect(action()).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
  });

  it("re-throws NEXT_NOT_FOUND errors", async () => {
    const notFoundError = { digest: "NEXT_NOT_FOUND" };
    const action = makeThrowingAction(notFoundError);
    await expect(action()).rejects.toMatchObject({ digest: "NEXT_NOT_FOUND" });
  });

  it("sanitizes transient network error messages for user consumption", async () => {
    const transientErrors = [
      "Premature close",
      "socket hang up",
      "ECONNRESET",
      "fetch failed",
      "Connection closed",
    ];

    for (const msg of transientErrors) {
      const action = makeThrowingAction(new Error(msg));
      const result = await action();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe(
          "A temporary connection issue occurred. Please try again."
        );
      }
    }
  });

  it("passes all positional arguments through to the action function", async () => {
    const spy = jest.fn().mockResolvedValue({
      success: true as const,
      error: null,
      data: "ok",
    });
    const action = withSafeAction("argPassThrough", spy);
    await action("arg1", 42, { key: "value" });
    expect(spy).toHaveBeenCalledWith("arg1", 42, { key: "value" });
  });
});

// ── Tests: withFlexibleSafeAction ─────────────────────────────────────────────

describe("withFlexibleSafeAction", () => {
  it("returns the action result unchanged on success", async () => {
    const action = withFlexibleSafeAction("flexSuccess", async () => ({
      userId: "u1",
      status: "active",
    }));
    const result = await action();
    expect(result).toEqual({ userId: "u1", status: "active" });
  });

  it("catches thrown errors and returns { success: false }", async () => {
    const action = withFlexibleSafeAction("flexError", async () => {
      throw new Error("Flexible action failed");
    });
    const result = await action();
    expect(result).toMatchObject({ success: false, error: "Flexible action failed", data: null });
  });

  it("re-throws Next.js navigation errors", async () => {
    const action = withFlexibleSafeAction("flexRedirect", async () => {
      throw { digest: "NEXT_REDIRECT;push;/login" };
    });
    await expect(action()).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
  });
});

// ── Tests: redactSensitiveData (via captured telemetry call) ──────────────────

describe("redactSensitiveData behaviour (via action telemetry)", () => {
  it("does not leak password/pin/token to error logs", async () => {
    const { logTelemetryAction } = await import("@/app/actions/telemetry");
    // Clear any calls from prior tests so we only examine this specific invocation
    (logTelemetryAction as jest.Mock).mockClear();

    const action = withSafeAction(
      "sensitiveActionTest",
      async (_payload: { email: string; password: string }) => {
        throw new Error("Intentional failure");
      }
    );

    await action({ email: "user@example.com", password: "SuperSecret123!" });

    // logTelemetryAction receives: ('error', '[Unhandled Exception...] ...', { stack, input: redactedArgs })
    expect(logTelemetryAction).toHaveBeenCalled();

    // Get the 3rd argument of the first call — that's { stack, input: [...] }
    const telemetryPayload = (logTelemetryAction as jest.Mock).mock.calls[0][2];
    const serialisedInput = JSON.stringify(telemetryPayload);

    // The raw password must not appear anywhere in the logged telemetry
    expect(serialisedInput).not.toContain("SuperSecret123!");
    // The password field must be replaced with the [REDACTED] sentinel
    expect(serialisedInput).toContain("[REDACTED]");
  });
});
