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

os.makedirs("/Users/mac/Easy sales Export/easy-sales-export-nextjs/scratch", exist_ok=True)

for sub_id in subagent_ids:
    path = f"/Users/mac/.gemini/antigravity/brain/{sub_id}/.system_generated/logs/transcript.jsonl"
    print(f"=== {sub_id} ===")
    if not os.path.exists(path):
        print(f"Not found: {path}")
        continue
    
    last_response = None
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            try:
                data = json.loads(line)
                # Let's inspect all steps. If it's a step with 'content' and source is 'MODEL'
                # and doesn't just call tools without text.
                if data.get("source") == "MODEL":
                    content = data.get("content")
                    if content and len(content.strip()) > 50:
                        last_response = content
            except Exception as e:
                pass
    if last_response:
        print(f"Found content length: {len(last_response)}")
        out_path = f"/Users/mac/Easy sales Export/easy-sales-export-nextjs/scratch/report_{sub_id}.md"
        with open(out_path, "w", encoding="utf-8") as out_f:
            out_f.write(last_response)
        print(f"Saved to {out_path}")
    else:
        print("No model response content found")
