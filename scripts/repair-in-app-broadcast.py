import os

filepath = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions/in-app-broadcast.ts"

with open(filepath, 'r') as f:
    content = f.read()

# Add import
if 'import { ActionResponse }' not in content:
    content = content.replace('import { requireAdmin } from "@/lib/require-admin";', 'import { requireAdmin } from "@/lib/require-admin";\nimport { ActionResponse } from "@/lib/safe-action";')

# Refactor types
content = content.replace('export interface InAppBroadcastPreview { count: number;\n    sample: { name: string; userId: string }[];\n}', 'export type InAppBroadcastPreview = ActionResponse<{\n    count: number;\n    sample: { name: string; userId: string }[];\n}>;')
content = content.replace('export interface InAppBroadcastResult { error: null, success: boolean;\n    delivered: number;\n    logId?: string; }', 'export type InAppBroadcastResult = ActionResponse<{\n    delivered: number;\n    logId?: string;\n}>;')

# Fix previewInAppBroadcastAction
content = content.replace('if ("error" in authCheck) return { count: 0, sample: [], error: "Unauthorized: admin role required" };', 'if ("error" in authCheck) return { success: false, error: "Unauthorized: admin role required", data: null };')
content = content.replace('return {\n            count: recipients.length,\n            sample: recipients.slice(0, 3) };', 'return {\n            success: true,\n            error: null,\n            data: {\n                count: recipients.length,\n                sample: recipients.slice(0, 3)\n            }\n        };')
content = content.replace('return { count: 0, sample: [], error: error.message };', 'return { success: false, error: error.message, data: null };')

# Fix sendInAppBroadcastAction
content = content.replace('if ("error" in authCheck) return { success: false as const, delivered: 0, error: "Unauthorized: admin role required"};', 'if ("error" in authCheck) return { success: false, error: "Unauthorized: admin role required", data: null };')
content = content.replace('return { success: false as const, delivered: 0, error: "No recipients matched the selected filters."};', 'return { success: false, error: "No recipients matched the selected filters.", data: null };')
content = content.replace('return { error: null,  success: true as const, delivered, logId: logRef.id , data: null };', 'return { success: true, error: null, data: { delivered, logId: logRef.id } };')
content = content.replace('return { success: false as const, delivered: 0, error: error.message, data: null };', 'return { success: false, error: error.message, data: null };')

with open(filepath, 'w') as f:
    f.write(content)

print("Repaired in-app-broadcast.ts")
