import os

filepath = "/Users/mac/Easy sales Export/easy-sales-export-nextjs/src/app/actions/sms-broadcast.ts"

with open(filepath, 'r') as f:
    content = f.read()

# Fix previewSmsBroadcastAction
content = content.replace('return { count: 0, sample: [], error: "Unauthorized: admin role required" };', 'return { success: false, error: "Unauthorized: admin role required", data: null };')
content = content.replace('return {\n            count: recipients.length,\n            sample: recipients.slice(0, 3) };', 'return {\n            success: true,\n            error: null,\n            data: {\n                count: recipients.length,\n                sample: recipients.slice(0, 3)\n            }\n        };')
content = content.replace('return { count: 0, sample: [], error: error.message };', 'return { success: false, error: error.message, data: null };')

# Fix sendSmsBroadcastAction
# (Already fixed some in my head but let's be thorough)
content = content.replace('return { success: false as const, sent: 0, failed: 0, skipped: 0, error: "Unauthorized: admin role required", data: null };', 'return { success: false, error: "Unauthorized: admin role required", data: null };')
content = content.replace('return { success: false as const, sent: 0, failed: 0, skipped: 0, error: "No recipients with valid phone numbers matched your filters.", data: null };', 'return { success: false, error: "No recipients with valid phone numbers matched your filters.", data: null };')
content = content.replace('return { error: null,  success: true as const, sent, failed, skipped, logId: logRef.id , data: null };', 'return { success: true, error: null, data: { sent, failed, skipped, logId: logRef.id } };')
content = content.replace('return { success: false as const, sent: 0, failed: 0, skipped: 0, error: error.message, data: null };', 'return { success: false, error: error.message, data: null };')

with open(filepath, 'w') as f:
    f.write(content)

print("Repaired sms-broadcast.ts")
