import os

filepath = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions/paystack.ts"

with open(filepath, 'r') as f:
    content = f.read()

# Add import
if 'import { ActionResponse }' not in content:
    content = content.replace("import { requireSession } from '@/lib/session-guard';", "import { requireSession } from '@/lib/session-guard';\nimport { ActionResponse } from '@/lib/safe-action';")

# Refactor BankVerificationResult
content = content.replace('export interface BankVerificationResult { error: null, success: boolean;\n    accountName?: string; }', 'export type BankVerificationResult = ActionResponse<{ accountName: string }>;')

# Refactor getBankList signature
sig_pattern = 'Promise<\n    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }\n    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }\n>'
content = content.replace(sig_pattern, 'Promise<ActionResponse<any>>')

# Fix getBankList returns
content = content.replace("return { success: false as const, error: 'Failed to fetch bank list'};", "return { success: false, error: 'Failed to fetch bank list', data: null };")
content = content.replace('return { error: null, success: true as const, banks: data.data , data: null };', 'return { success: true, error: null, data: { banks: data.data } };')
content = content.replace("return { success: false as const, error: error instanceof Error ? error.message : 'Failed to fetch banks'};", "return { success: false, error: error instanceof Error ? error.message : 'Failed to fetch banks', data: null };")

# Fix verifyBankAccount returns
content = content.replace('return { success: false as const, error: sessionResult.error.error};', 'return { success: false, error: sessionResult.error.error, data: null };')
content = content.replace("return { success: false as const, error: 'Account number and bank code are required'};", "return { success: false, error: 'Account number and bank code are required', data: null };")
content = content.replace("return { success: false as const, error: 'Account number must be exactly 10 digits'};", "return { success: false, error: 'Account number must be exactly 10 digits', data: null };")
content = content.replace("return { success: false as const, error: 'Invalid bank code. Please select a valid bank from the dropdown.'};", "return { success: false, error: 'Invalid bank code. Please select a valid bank from the dropdown.', data: null };")
content = content.replace("return { success: false as const, error: 'Payment service not configured. Please contact support.'};", "return { success: false, error: 'Payment service not configured. Please contact support.', data: null };")
content = content.replace('return { error: null, success: true as const, accountName: data.data.account_name , data: null };', 'return { success: true, error: null, data: { accountName: data.data.account_name } };')
content = content.replace('return { success: false as const, error: sessionResult.error.error, data: null };', 'return { success: false, error: sessionResult.error.error, data: null };')
content = content.replace("return { success: false as const, error: 'Payment service not configured', data: null };", "return { success: false, error: 'Payment service not configured', data: null };")

with open(filepath, 'w') as f:
    f.write(content)

print("Repaired paystack.ts")
