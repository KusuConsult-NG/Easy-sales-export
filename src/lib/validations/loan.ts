import { z } from 'zod';
import { LoanPurpose } from '@/types/strict';

// Loan Application Schema
export const loanApplicationSchema = z.object({
    amount: z.number()
        .min(1000, 'Minimum loan amount is ₦1,000')
        .max(5000000, 'Maximum loan amount is ₦5,000,000'),

    purpose: z.nativeEnum(LoanPurpose),

    repaymentPeriod: z.number()
        .min(3, 'Minimum repayment period is 3 months')
        .max(24, 'Maximum repayment period is 24 months'),

    collateral: z.object({
        type: z.string().min(2, 'Collateral type is required'),
        value: z.number().min(1, 'Collateral value must be greater than 0'),
        description: z.string().min(10, 'Please provide collateral description'),
    }),

    businessDetails: z.object({
        name: z.string().min(2, 'Business name is required'),
        type: z.string().min(2, 'Business type is required'),
        yearsInOperation: z.number().min(0, 'Years in operation cannot be negative'),
        annualRevenue: z.number().min(0, 'Annual revenue cannot be negative'),
    }),

    documents: z.array(z.object({
        name: z.string(),
        url: z.string().url('Invalid document URL'),
        type: z.enum(['id', 'business_reg', 'financial_statement', 'other']),
    })).min(1, 'At least one document is required'),
});

export type LoanApplicationData = z.infer<typeof loanApplicationSchema>;

// Loan Approval Schema
export const loanApprovalSchema = z.object({
    loanId: z.string().min(1),
    approved: z.boolean(),
    notes: z.string().optional(),
    rejectionReason: z.string().optional(),
});

export type LoanApprovalData = z.infer<typeof loanApprovalSchema>;
