import os

filepath = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions/payments.ts"

with open(filepath, 'r') as f:
    content = f.read()

# Add import
if 'import { ActionResponse }' not in content:
    content = content.replace('import { requireSession } from "@/lib/session-guard";', 'import { requireSession } from "@/lib/session-guard";\nimport { ActionResponse } from "@/lib/safe-action";')

# Signature replacement pattern
sig_pattern = 'Promise<\n    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }\n    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }\n>'

content = content.replace(sig_pattern, 'Promise<ActionResponse<any>>')

# Fix return objects
content = content.replace('return { error: null, success: true as const, paymentId: docRef.id , data: null };', 'return { success: true, error: null, data: { paymentId: docRef.id } };')
content = content.replace('return { error: null, success: true as const , data: null };', 'return { success: true, error: null, data: null };')

# Error returns are already okay but let's be sure
content = content.replace('return { success: false as const, error: sessionResult.error.error, data: null };', 'return { success: false, error: sessionResult.error.error, data: null };')
content = content.replace('return { success: false as const, error: "Failed to create payment record", data: null };', 'return { success: false, error: "Failed to create payment record", data: null };')
content = content.replace('return { success: false as const, error: "Payment not found", data: null };', 'return { success: false, error: "Payment not found", data: null };')
content = content.replace('return { success: false as const, error: "Failed to verify payment", data: null };', 'return { success: false, error: "Failed to verify payment", data: null };')

with open(filepath, 'w') as f:
    f.write(content)

print("Repaired payments.ts")
