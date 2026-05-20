import json
import os

subagent_ids = [
    "0b5bbf2d-d1f0-4dcd-a6b8-12d1acffa17b",
    "cd36c07d-6b44-492e-8fcf-b67fcd12d60d",
    "4fbc2817-e0ac-4d16-9f43-e838a5e49b3d",
    "804bd77d-0784-4f87-b503-338dc0fe808d",
    "24adbac3-0b12-4032-b3ab-e50323140e3c",
    "98c3625c-02d3-4031-91f8-9d35ac4fe8bb",
    "4c3d0456-0e68-4bfe-a411-cf4c53085ec3",
    "08ce4475-fb7f-4e53-bfeb-28cececb7685"
]

for sub_id in subagent_ids:
    path = f"/Users/mac/.gemini/antigravity/brain/{sub_id}/.system_generated/logs/transcript.jsonl"
    print(f"\n=== {sub_id} ===")
    if not os.path.exists(path):
        print("Not found")
        continue
    
    longest_text = ""
    longest_step_idx = -1
    with open(path, "r", encoding="utf-8") as f:
        for idx, line in enumerate(f):
            try:
                data = json.loads(line)
                if data.get("source") == "MODEL":
                    content = data.get("content") or ""
                    # Filter out tool outputs
                    if content and not content.strip().startswith("Created At:"):
                        if len(content) > len(longest_text):
                            longest_text = content
                            longest_step_idx = idx
            except Exception:
                pass
                
    if longest_text:
        print(f"  Longest actual text step: {longest_step_idx} | Length: {len(longest_text)}")
        out_path = f"/Users/mac/Easy sales Export/easy-sales-export-nextjs/scratch/actual_report_{sub_id}.md"
        with open(out_path, "w", encoding="utf-8") as out_f:
            out_f.write(longest_text)
        print(f"  Saved to {out_path}")
        snippet = longest_text[:200].replace('\n', ' ')
        print(f"  Snippet: {snippet}...")
    else:
        print("  No actual text response found")
