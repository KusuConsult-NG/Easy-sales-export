import os

filepath = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions/kyc.ts"

with open(filepath, 'r') as f:
    content = f.read()

# Add import
if 'import { ActionResponse }' not in content:
    content = content.replace("import { requireSession } from '@/lib/session-guard';", "import { requireSession } from '@/lib/session-guard';\nimport { ActionResponse } from '@/lib/safe-action';")

# Refactor KYCVerificationResult
content = content.replace('export type KYCVerificationResult = \n    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }\n    | { success: false; error: string; data?: null; meta?: any; [key: string]: any };', 'export type KYCVerificationResult = ActionResponse<{ isMatch: boolean; [key: string]: any }>;')

# Fix verifyBVNAction
content = content.replace('return { success: true as const, isMatch: false, error: \'BVN name mismatch — the name on your BVN record does not match the name you provided. Please check your name spelling and try again.\' };', "return { success: false, error: 'BVN name mismatch — the name on your BVN record does not match the name you provided. Please check your name spelling and try again.', data: null };")
content = content.replace('return { success: true as const, isMatch: true, error: null };', "return { success: true, error: null, data: { isMatch: true } };")

# Fix verifyNINAction
content = content.replace('return { success: true as const, isMatch: false, error: \'NIN name mismatch — the name on your NIN record does not match the name you provided. Please check your name spelling and try again.\' };', "return { success: false, error: 'NIN name mismatch — the name on your NIN record does not match the name you provided. Please check your name spelling and try again.', data: null };")
content = content.replace('return { success: true as const, isMatch: true, error: null };', "return { success: true, error: null, data: { isMatch: true } };")

# Fix verifyVotersCardAction
content = content.replace('return { success: true as const, isMatch: true, error: null };', "return { success: true, error: null, data: { isMatch: true } };")

# Fix saveKYCProfileAction
content = content.replace('Promise<\n    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }\n    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }\n>', 'Promise<ActionResponse<any>>')
content = content.replace('return { success: true as const, error: null };', 'return { success: true, error: null, data: null };')

with open(filepath, 'w') as f:
    f.write(content)

print("Repaired kyc.ts")
