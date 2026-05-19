import type { ExportWindowStatus, ExportOnboardingStatus, ExportInvestmentStatus } from "./constants";

export interface CreateExportWindowPayload {
    title: string;
    commodity: "yam" | "sesame" | "hibiscus" | "other";
    quantity: string;
    amount: number;
    roi: string;
    duration: string;
    totalSpots?: number;
    description?: string;
    specifications?: string[];
    benefits?: string[];
    timeline?: {
        phase: string;
        date: string;
        description: string;
        status: "pending" | "active" | "completed";
    }[];
    startDate?: Date;
    endDate?: Date;
}

export interface OnboardExportPayload {
    userId: string;
    profile: any;
    kyc: any;
    bank: any;
    terms: any;
}

export interface InvestExportPayload {
    userId: string;
    windowId: string;
    amount: number;
    paymentReference?: string;
}

export interface ExportServiceContract {
    getExportWindows(options?: { status?: ExportWindowStatus }): Promise<any[]>;
    getExportWindowById(id: string): Promise<any>;
    createExportWindow(payload: CreateExportWindowPayload, adminId: string): Promise<{ windowId: string }>;
    updateExportWindow(id: string, payload: Partial<CreateExportWindowPayload>): Promise<void>;
    
    submitOnboardingApplication(payload: OnboardExportPayload): Promise<{ applicationId: string }>;
    getOnboardingApplication(userId: string): Promise<any>;
    reviewOnboardingApplication(applicationId: string, status: ExportOnboardingStatus, adminId: string): Promise<void>;
    
    investInWindow(payload: InvestExportPayload): Promise<{ investmentId: string }>;
    getUserInvestments(userId: string): Promise<any[]>;
}
