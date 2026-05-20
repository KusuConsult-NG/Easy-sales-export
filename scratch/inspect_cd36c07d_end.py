import json
import os

path = "/Users/mac/.gemini/antigravity/brain/cd36c07d-6b44-492e-8fcf-b67fcd12d60d/.system_generated/logs/transcript.jsonl"
if not os.path.exists(path):
    print("Not found")
else:
    with open(path, "r", encoding="utf-8") as f:
        lines = f.readlines()
    print(f"Total lines: {len(lines)}")
    for i in range(max(0, len(lines)-10), len(lines)):
        try:
            data = json.loads(lines[i])
            print(f"\n[Step {i}] Source: {data.get('source')} | Type: {data.get('type')} | Status: {data.get('status')}")
            content = data.get("content") or ""
            tool_calls = data.get("tool_calls") or []
            if content:
                print(f"  Content: {content[:200]}...")
            if tool_calls:
                print(f"  ToolCalls: {str(tool_calls)[:200]}")
        except Exception as e:
            print(f"Error parsing line {i}: {e}")
