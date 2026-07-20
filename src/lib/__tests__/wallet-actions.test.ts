/**
 * Unit tests for Wallet System Server Actions in src/app/actions/wallet.ts
 */

import {
  getWalletAction,
  fundWalletViaPaystackAction,
  withdrawFromWalletAction,
  walletCheckoutAction,
} from "@/app/actions/wallet";

// Silence console.error logs inside tests
beforeAll(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterAll(() => {
  (console.error as jest.Mock).mockRestore();
});

describe("Wallet Actions Validation & Safety Gates", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getWalletAction", () => {
    it("returns error unauthorized if no session is active", async () => {
      // Mock unauthenticated session
      global.mockRequireSession.mockResolvedValueOnce({
        session: null,
        error: "Unauthorized",
      });

      const result = await getWalletAction();
      expect(result.success).toBe(false);
      expect(result.error).toBe("Unauthorized");
    });
  });

  describe("fundWalletViaPaystackAction", () => {
    it("rejects deposits below NGN 100", async () => {
      const result = await fundWalletViaPaystackAction(50); // Less than 100 minimum
      expect(result.success).toBe(false);
      expect(result.error).toContain("Minimum wallet funding amount is ₦100");
    });

    it("rejects floating/decimal or negative values via Zod validation", async () => {
      const result1 = await fundWalletViaPaystackAction(-150);
      expect(result1.success).toBe(false);
      expect(result1.error).toBeDefined();

      const result2 = await fundWalletViaPaystackAction(150.5);
      expect(result2.success).toBe(false);
      expect(result2.error).toContain("expected int");
    });
  });

  describe("walletCheckoutAction", () => {
    it("rejects non-positive amounts", async () => {
      const result = await walletCheckoutAction("order-123", -500);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid checkout amount");
    });

    it("rejects empty order ID", async () => {
      const result = await walletCheckoutAction("", 1000);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Order ID is required");
    });
  });

  describe("withdrawFromWalletAction", () => {
    const validBankDetails = {
      accountNumber: "0123456789",
      bankCode: "044",
      accountName: "John Doe",
      bankName: "Access Bank",
    };

    it("rejects withdrawal amounts less than MIN_WITHDRAWAL (5000)", async () => {
      const result = await withdrawFromWalletAction(2000, validBankDetails);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Minimum withdrawal amount is ₦5,000");
    });

    it("rejects invalid/empty bank account details", async () => {
      const invalidDetails = {
        ...validBankDetails,
        accountNumber: "123", // too short (minimum 5 digits)
      };

      const result = await withdrawFromWalletAction(6000, invalidDetails);
      expect(result.success).toBe(false);
      expect(result.error).toContain("accountNumber: Account number must be at least 5 digits");
    });
  });
});
