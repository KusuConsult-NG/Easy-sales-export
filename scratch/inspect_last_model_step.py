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
    
    last_model_step = None
    last_step_num = -1
    with open(path, "r", encoding="utf-8") as f:
        for idx, line in enumerate(f):
            try:
                data = json.loads(line)
                if data.get("source") == "MODEL":
                    last_model_step = data
                    last_step_num = idx
            except Exception:
                pass
                
    if last_model_step:
        content = last_model_step.get("content") or ""
        tool_calls = last_model_step.get("tool_calls") or []
        tc_summary = ", ".join([tc.get("name", tc.get("ToolName", "")) for tc in tool_calls]) if isinstance(tool_calls, list) else str(tool_calls)
        print(f"  Step {last_step_num} | Type: {last_model_step.get('type')} | Content Len: {len(content)} | ToolCalls: {tc_summary}")
        if content:
            snippet = content[:300].replace('\n', ' ')
            print(f"    Content: {snippet}...")
    else:
        print("  No model step found")
