import json
import os

path = "/Users/mac/.gemini/antigravity/brain/eb7a3bda-93f1-4acf-a848-8456b6ab07ab/.system_generated/logs/transcript.jsonl"
print(f"Parent Log: {path}")
if not os.path.exists(path):
    print("Parent log not found")
else:
    messages = []
    with open(path, "r", encoding="utf-8") as f:
        for idx, line in enumerate(f):
            try:
                data = json.loads(line)
                # Look for subagent messages or incoming messages
                if "message" in line.lower() or "recipient" in line.lower() or "subagent" in line.lower():
                    messages.append((idx, data.get("source"), data.get("type"), data))
            except Exception:
                pass
    print(f"Total matching steps in parent: {len(messages)}")
    for idx, source, dtype, data in messages[:20]:
        print(f"  [Step {idx}] Source: {source} | Type: {dtype}")
        # Print a snippet of content if there is one
        content = data.get("content") or ""
        tool_calls = data.get("tool_calls") or []
        if content:
            print(f"    Content: {content[:100]}...")
        if tool_calls:
            print(f"    ToolCalls: {str(tool_calls)[:100]}...")
