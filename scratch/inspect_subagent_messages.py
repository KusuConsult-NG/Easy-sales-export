import json
import os

path = "/Users/mac/.gemini/antigravity/brain/eb7a3bda-93f1-4acf-a848-8456b6ab07ab/.system_generated/logs/transcript.jsonl"
if not os.path.exists(path):
    print("Parent log not found")
else:
    matching = []
    with open(path, "r", encoding="utf-8") as f:
        for idx, line in enumerate(f):
            try:
                data = json.loads(line)
                # We want to find any messages from/to subagents
                # Usually source == "SYSTEM" and type == "SUBAGENT_MESSAGE" or "MESSAGE"
                # Or tool_calls containing send_message
                is_subagent_related = False
                if data.get("type") in ["SUBAGENT_MESSAGE", "MESSAGE", "NOTIFICATION", "USER_INPUT"]:
                    is_subagent_related = True
                elif "subagent" in str(data.get("tool_calls", "")).lower():
                    is_subagent_related = True
                elif "send_message" in str(data.get("tool_calls", "")).lower():
                    is_subagent_related = True
                if is_subagent_related:
                    matching.append((idx, data))
            except Exception:
                pass
    print(f"Total matching steps: {len(matching)}")
    for idx, data in matching[-20:]:
        print(f"\n[Step {idx}] Source: {data.get('source')} | Type: {data.get('type')}")
        content = data.get("content") or ""
        tool_calls = data.get("tool_calls") or []
        if content:
            print(f"  Content: {content[:300]}...")
        if tool_calls:
            print(f"  ToolCalls: {str(tool_calls)[:300]}...")
