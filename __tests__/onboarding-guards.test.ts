/**
 * Critical-Path: Onboarding Pre-Submission Guard Logic
 *
 * These tests validate that every onboarding module's submission guard
 * correctly BLOCKS empty / corrupt state from reaching the server.
 *
 * Why this matters: Users who arrive via Paystack redirect or restore a
 * corrupted localStorage draft skip step-by-step validation. These guards
 * are the ONLY line of defence before an empty Firestore record is written.
 *
 * Tests are pure logic — no DOM, no network, no Firebase calls.
 */

// ── Guard logic extracted from each module (mirrors production code) ──────────

interface CoopData {
    firstName?: string; lastName?: string;
    nextOfKinName?: string; nextOfKinPhone?: string;
    bvn?: string; nin?: string;
}
function cooperativeGuard(d: CoopData): string | null {
    const missingPersonal =
        !d.firstName?.trim() || d.firstName.trim().length < 2 ||
        !d.lastName?.trim() || d.lastName.trim().length < 2;
    if (missingPersonal) return "Please complete your personal details (Step 1).";
    if (!d.nextOfKinName?.trim() || d.nextOfKinName.trim().length < 2)
        return "Next of kin name is required (Step 2).";
    if (!d.nextOfKinPhone?.trim())
        return "Next of kin phone is required (Step 2).";
    if (!d.bvn || !/^\d{11}$/.test(d.bvn))
        return "A valid 11-digit BVN is required.";
    if (!d.nin || !/^\d{11}$/.test(d.nin))
        return "A valid 11-digit NIN is required.";
    return null;
}

interface WaveData {
    surname?: string; firstName?: string;
    nextOfKinName?: string; nextOfKinPhone?: string;
    bankName?: string; accountNumber?: string; bvn?: string;
    declarationAccepted?: boolean; consentGiven?: boolean;
}
function waveGuard(d: WaveData): string | null {
    if (!d.surname?.trim() || d.surname.trim().length < 2 ||
        !d.firstName?.trim() || d.firstName.trim().length < 2)
        return "Personal details incomplete (Step 1).";
    if (!d.nextOfKinName?.trim() || d.nextOfKinName.trim().length < 2 ||
        !d.nextOfKinPhone?.trim())
        return "Next of kin details incomplete (Step 2).";
    if (!d.bankName?.trim() || d.bankName.trim().length < 2 ||
        !d.accountNumber?.trim() || !d.bvn?.trim())
        return "Financial details incomplete (Step 3).";
    if (!d.declarationAccepted || !d.consentGiven)
        return "Declaration and consent required (Step 4).";
    return null;
}

interface AcademyStep1 { firstName?: string; lastName?: string; phone?: string; }
interface AcademyStep2 { highestEducation?: string; }
interface AcademyStep3 { learningPaths?: string[]; }
interface AcademyStep4 { termsAccepted?: boolean; }

function academyValidateStep(step: number, s1: AcademyStep1, s2: AcademyStep2, s3: AcademyStep3, s4: AcademyStep4): boolean {
    if (step === 1) return !!(s1.firstName?.trim() && s1.lastName?.trim() && s1.phone?.trim());
    if (step === 2) return !!s2.highestEducation;
    if (step === 3) return !!(s3.learningPaths && s3.learningPaths.length > 0);
    if (step === 4) return !!s4.termsAccepted;
    return false;
}

interface FarmNationData {
    role?: string;
    profile?: { firstName?: string; lastName?: string };
}
function farmNationGuard(d: FarmNationData): string | null {
    if (!d.role) return "Please select your role.";
    const p = d.profile || {};
    if (!p.firstName?.trim() || p.firstName.trim().length < 2 ||
        !p.lastName?.trim() || p.lastName.trim().length < 2)
        return "Profile name is incomplete.";
    return null;
}

interface MarketplaceData {
    accountType?: string;
    businessName?: string;
    phone?: string;
    termsAccepted?: boolean;
    bankAccount?: { bankName?: string; accountNumber?: string };
}
function marketplaceGuard(d: MarketplaceData): string | null {
    if (!d.accountType) return "Please select an account type.";
    if (!d.businessName?.trim() || d.businessName.trim().length < 2)
        return "Business name is required.";
    if (!d.phone?.trim()) return "Phone number is required.";
    if (!d.termsAccepted) return "You must accept the terms and conditions.";
    const isSeller = d.accountType === "seller" || d.accountType === "both";
    if (isSeller && (!d.bankAccount?.bankName || !d.bankAccount?.accountNumber))
        return "Bank account details are required for sellers.";
    return null;
}

interface ExportData {
    profile?: { investmentAmount?: string; investmentRange?: string; firstName?: string };
    kyc?: { kycData?: object; fullName?: string; firstName?: string };
    bank?: { bankName?: string; accountNumber?: string };
    terms?: { accepted?: boolean; agreedToTerms?: boolean };
}
function exportGuard(d: ExportData): string | null {
    const p = d.profile || {};
    if (!p.investmentAmount && !p.investmentRange && !p.firstName)
        return "Investment profile is incomplete.";
    const k = d.kyc || {};
    if (!k.kycData && !k.fullName && !k.firstName)
        return "Identity verification is incomplete.";
    const b = d.bank || {};
    if (!b.bankName && !b.accountNumber)
        return "Bank account details are incomplete.";
    const t = d.terms || {};
    if (!t.accepted && !t.agreedToTerms)
        return "You must accept the terms and conditions.";
    return null;
}

// ── COOPERATIVE ───────────────────────────────────────────────────────────────

describe("Cooperative onboarding guard", () => {
    test("BLOCKS empty state", () => {
        expect(cooperativeGuard({})).not.toBeNull();
    });
    test("BLOCKS firstName too short", () => {
        expect(cooperativeGuard({ firstName: "A", lastName: "Doe", nextOfKinName: "Jane Doe", nextOfKinPhone: "08012345678", bvn: "12345678901", nin: "98765432109" })).not.toBeNull();
    });
    test("BLOCKS missing next of kin", () => {
        expect(cooperativeGuard({ firstName: "Ada", lastName: "Obi", bvn: "12345678901", nin: "98765432109" })).not.toBeNull();
    });
    test("BLOCKS missing or invalid bvn/nin", () => {
        expect(cooperativeGuard({ firstName: "Ada", lastName: "Obi", nextOfKinName: "Jane Obi", nextOfKinPhone: "08012345678" })).not.toBeNull();
        expect(cooperativeGuard({ firstName: "Ada", lastName: "Obi", nextOfKinName: "Jane Obi", nextOfKinPhone: "08012345678", bvn: "12345678901" })).not.toBeNull();
        expect(cooperativeGuard({ firstName: "Ada", lastName: "Obi", nextOfKinName: "Jane Obi", nextOfKinPhone: "08012345678", bvn: "123", nin: "123" })).not.toBeNull();
    });
    test("PASSES valid data", () => {
        expect(cooperativeGuard({ firstName: "Ada", lastName: "Obi", nextOfKinName: "Jane Obi", nextOfKinPhone: "08012345678", bvn: "12345678901", nin: "98765432109" })).toBeNull();
    });
});

// ── WAVE ──────────────────────────────────────────────────────────────────────

describe("WAVE application guard", () => {
    const valid: WaveData = {
        surname: "Okonkwo", firstName: "Ada",
        nextOfKinName: "James Okonkwo", nextOfKinPhone: "08011111111",
        bankName: "GTBank", accountNumber: "0123456789", bvn: "12345678901",
        declarationAccepted: true, consentGiven: true,
    };

    test("BLOCKS empty state", () => {
        expect(waveGuard({})).not.toBeNull();
    });
    test("BLOCKS single-character surname", () => {
        expect(waveGuard({ ...valid, surname: "O" })).not.toBeNull();
    });
    test("BLOCKS missing next of kin", () => {
        expect(waveGuard({ ...valid, nextOfKinName: "" })).not.toBeNull();
    });
    test("BLOCKS missing bankName", () => {
        expect(waveGuard({ ...valid, bankName: "" })).not.toBeNull();
    });
    test("BLOCKS missing declaration", () => {
        expect(waveGuard({ ...valid, declarationAccepted: false })).not.toBeNull();
    });
    test("PASSES fully valid data", () => {
        expect(waveGuard(valid)).toBeNull();
    });
});

// ── ACADEMY ───────────────────────────────────────────────────────────────────

describe("Academy all-steps validation guard", () => {
    const s1 = { firstName: "Ada", lastName: "Obi", phone: "08012345678" };
    const s2 = { highestEducation: "secondary" };
    const s3 = { learningPaths: ["agribusiness"] };
    const s4 = { termsAccepted: true };

    test("Step 1 FAILS without firstName", () => {
        expect(academyValidateStep(1, { ...s1, firstName: "" }, s2, s3, s4)).toBe(false);
    });
    test("Step 2 FAILS without education", () => {
        expect(academyValidateStep(2, s1, {}, s3, s4)).toBe(false);
    });
    test("Step 3 FAILS with empty learningPaths", () => {
        expect(academyValidateStep(3, s1, s2, { learningPaths: [] }, s4)).toBe(false);
    });
    test("Step 4 FAILS without terms", () => {
        expect(academyValidateStep(4, s1, s2, s3, { termsAccepted: false })).toBe(false);
    });
    test("All steps PASS with valid data", () => {
        expect(academyValidateStep(1, s1, s2, s3, s4)).toBe(true);
        expect(academyValidateStep(2, s1, s2, s3, s4)).toBe(true);
        expect(academyValidateStep(3, s1, s2, s3, s4)).toBe(true);
        expect(academyValidateStep(4, s1, s2, s3, s4)).toBe(true);
    });
});

// ── FARM NATION ───────────────────────────────────────────────────────────────

describe("Farm Nation onboarding guard", () => {
    test("BLOCKS empty state", () => {
        expect(farmNationGuard({})).not.toBeNull();
    });
    test("BLOCKS missing role", () => {
        expect(farmNationGuard({ profile: { firstName: "Ada", lastName: "Obi" } })).not.toBeNull();
    });
    test("BLOCKS firstName too short", () => {
        expect(farmNationGuard({ role: "seller", profile: { firstName: "A", lastName: "Obi" } })).not.toBeNull();
    });
    test("PASSES valid data", () => {
        expect(farmNationGuard({ role: "seller", profile: { firstName: "Ada", lastName: "Obi" } })).toBeNull();
    });
});

// ── MARKETPLACE ───────────────────────────────────────────────────────────────

describe("Marketplace onboarding guard", () => {
    const validBuyer: MarketplaceData = {
        accountType: "buyer", businessName: "Ada Farms",
        phone: "08012345678", termsAccepted: true,
    };
    const validSeller: MarketplaceData = {
        ...validBuyer, accountType: "seller",
        bankAccount: { bankName: "Zenith", accountNumber: "0123456789" },
    };

    test("BLOCKS empty state", () => { expect(marketplaceGuard({})).not.toBeNull(); });
    test("BLOCKS missing accountType", () => { expect(marketplaceGuard({ ...validBuyer, accountType: undefined })).not.toBeNull(); });
    test("BLOCKS businessName too short", () => { expect(marketplaceGuard({ ...validBuyer, businessName: "A" })).not.toBeNull(); });
    test("BLOCKS missing phone", () => { expect(marketplaceGuard({ ...validBuyer, phone: "" })).not.toBeNull(); });
    test("BLOCKS unaccepted terms", () => { expect(marketplaceGuard({ ...validBuyer, termsAccepted: false })).not.toBeNull(); });
    test("BLOCKS seller without bank account", () => {
        expect(marketplaceGuard({ ...validBuyer, accountType: "seller" })).not.toBeNull();
    });
    test("PASSES valid buyer", () => { expect(marketplaceGuard(validBuyer)).toBeNull(); });
    test("PASSES valid seller with bank", () => { expect(marketplaceGuard(validSeller)).toBeNull(); });
});

// ── EXPORT ────────────────────────────────────────────────────────────────────

describe("Export onboarding guard", () => {
    const valid: ExportData = {
        profile: { investmentAmount: "500000" },
        kyc: { kycData: { fullName: "Ada Obi" } },
        bank: { bankName: "GTBank", accountNumber: "0123456789" },
        terms: { accepted: true },
    };

    test("BLOCKS empty state", () => { expect(exportGuard({})).not.toBeNull(); });
    test("BLOCKS missing profile", () => { expect(exportGuard({ ...valid, profile: {} })).not.toBeNull(); });
    test("BLOCKS missing KYC", () => { expect(exportGuard({ ...valid, kyc: {} })).not.toBeNull(); });
    test("BLOCKS missing bank", () => { expect(exportGuard({ ...valid, bank: {} })).not.toBeNull(); });
    test("BLOCKS unaccepted terms", () => { expect(exportGuard({ ...valid, terms: {} })).not.toBeNull(); });
    test("PASSES valid complete data", () => { expect(exportGuard(valid)).toBeNull(); });
});
