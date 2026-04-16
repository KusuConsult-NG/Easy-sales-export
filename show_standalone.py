import os
import re

files_to_check = [
    "src/app/admin/verify-id/page.tsx",
    "src/app/admin/content-approval/page.tsx",
    "src/app/admin/academy/page.tsx",
    "src/app/admin/academy/[courseId]/quiz/[quizId]/page.tsx",
    "src/app/admin/feature-toggles/page.tsx",
    "src/app/admin/wave/training/page.tsx",
    "src/app/admin/wave/resources/page.tsx",
    "src/app/admin/wave/registrations/page.tsx"
]

for filepath in files_to_check:
    print(f"\n--- {filepath} ---")
    with open(filepath, 'r') as f:
        lines = f.readlines()
        for i, line in enumerate(lines):
            if re.search(r'\b(result|res|data|updated)\.data\b(?!\.)', line):
                print(f"L{i+1}: {line.strip()}")
