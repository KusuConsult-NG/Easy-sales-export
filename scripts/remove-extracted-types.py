#!/usr/bin/env python3
"""
Remove inline type definitions from firestore.ts that have been extracted
to domain-specific type files.

Strategy: parse the file line by line, detect `export interface <Name>` or
`export type <Name>` blocks for the extracted types, and skip them.

Only removes the EXACT interfaces that were extracted — nothing else.
"""

import os, re

TYPES_DIR = os.path.join(os.path.dirname(__file__), "..", "src", "lib", "types")
FIRESTORE  = os.path.join(TYPES_DIR, "firestore.ts")

# These are the interface names now defined in domain files.
# We need to remove their inline `export interface X { ... }` blocks from firestore.ts.
EXTRACTED_INTERFACES = {
    # wave.ts
    "WaveApplication", "WaveCertificate", "WaveShipment", "WaveResource",
    "WaveWithdrawal", "WaveEarning", "BriefingSubmission",
    # academy.ts
    "Course", "Enrollment", "Certificate",
    # export.ts
    "ExportWindow", "ExportOnboardingApplication", "ExportInvestment", "ExportSlot",
    # farm-nation.ts
    "LandListing",
    # shared.ts
    "Notification", "Payment", "UnifiedTransaction", "PlatformSettings",
    "PasswordResetToken", "Announcement", "AuditLog",
}

with open(FIRESTORE, "r", encoding="utf-8") as f:
    lines = f.readlines()

output = []
i = 0
skipped_blocks = []

while i < len(lines):
    line = lines[i]

    # Detect start of an `export interface <Name>` or `export interface <Name>` block
    m = re.match(r'^export interface (\w+)', line)
    if m and m.group(1) in EXTRACTED_INTERFACES:
        iface_name = m.group(1)
        # Skip lines until we find the closing `}` at the same nesting level
        depth = 0
        start_i = i
        while i < len(lines):
            c = lines[i]
            depth += c.count("{") - c.count("}")
            i += 1
            if depth <= 0 and i > start_i + 1:
                break
        # Also skip any trailing blank lines
        while i < len(lines) and lines[i].strip() == "":
            i += 1
        skipped_blocks.append(iface_name)
        continue

    output.append(line)
    i += 1

with open(FIRESTORE, "w", encoding="utf-8") as f:
    f.writelines(output)

print(f"✅ Removed {len(skipped_blocks)} inline interfaces from firestore.ts:")
for name in sorted(skipped_blocks):
    print(f"   - {name}")
print(f"\n   Original: {len(lines)} lines → After: {len(output)} lines")
