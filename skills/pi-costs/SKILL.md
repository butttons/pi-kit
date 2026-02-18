---
name: pi-costs
description: Analyze pi session costs. Use when the user asks about spending, costs, token usage, or session statistics.
allowed-tools: Bash(find:*, grep:*, python3:*, wc:*)
---

# Pi Session Cost Analysis

Analyze cost, token usage, and session statistics from pi session files stored in `~/.pi/agent/sessions/`.

## Session File Format

Sessions are stored as JSONL files at `~/.pi/agent/sessions/<project-dir>/<timestamp>_<uuid>.jsonl`.

Each line is a JSON object. Assistant messages have this structure:

```json
{
  "type": "message",
  "message": {
    "role": "assistant",
    "model": "claude-opus-4-6",
    "usage": {
      "input": 2450,
      "output": 351,
      "cacheRead": 0,
      "cacheWrite": 0,
      "cost": {
        "input": 0.01225,
        "output": 0.008775,
        "cacheRead": 0,
        "cacheWrite": 0,
        "total": 0.021025
      }
    }
  }
}
```

## Instructions

1. Run the analysis script below via `bash` with `python3`.
2. Present results as a clean summary.
3. If the user asks for a specific breakdown (by model, by project, by date), adjust the script accordingly.

## Analysis Script

```bash
find ~/.pi/agent/sessions -name '*.jsonl' -exec grep -h '"cost"' {} \; | python3 -c "
import sys, json
from collections import defaultdict

total_cost = 0
by_model = defaultdict(float)
by_project = defaultdict(float)
message_count = 0
total_input = 0
total_output = 0

for line in sys.stdin:
    try:
        e = json.loads(line.strip())
        if e.get('type') != 'message': continue
        msg = e.get('message', {})
        if msg.get('role') != 'assistant': continue
        usage = msg.get('usage', {})
        cost = usage.get('cost', {})
        t = cost.get('total', 0)
        if t > 0:
            total_cost += t
            message_count += 1
            total_input += usage.get('input', 0)
            total_output += usage.get('output', 0)
            by_model[msg.get('model', 'unknown')] += t
    except: pass

print(f'Total cost: \${total_cost:.2f}')
print(f'Assistant messages: {message_count}')
print(f'Tokens: {total_input:,} input / {total_output:,} output')
print()
print('By model:')
for model, cost in sorted(by_model.items(), key=lambda x: -x[1]):
    pct = (cost / total_cost * 100) if total_cost > 0 else 0
    print(f'  {model}: \${cost:.2f} ({pct:.1f}%)')
"
```

## Per-Project Breakdown

```bash
find ~/.pi/agent/sessions -name '*.jsonl' | while read f; do
  dir=$(basename "$(dirname "$f")")
  cost=$(grep '"cost"' "$f" 2>/dev/null | python3 -c "
import sys, json
total = 0
for line in sys.stdin:
    try:
        e = json.loads(line.strip())
        if e.get('type') == 'message' and e.get('message',{}).get('role') == 'assistant':
            total += e['message'].get('usage',{}).get('cost',{}).get('total',0)
    except: pass
print(f'{total:.4f}')
" 2>/dev/null)
  echo "$cost $dir"
done | python3 -c "
import sys
from collections import defaultdict
by_proj = defaultdict(float)
for line in sys.stdin:
    parts = line.strip().split(' ', 1)
    if len(parts) == 2:
        cost, proj = float(parts[0]), parts[1]
        name = proj.replace('--', '/').strip('/')
        name = name.split('/')[-1] if '/' in name else name
        by_proj[name] += cost

print('By project:')
for proj, cost in sorted(by_proj.items(), key=lambda x: -x[1]):
    if cost >= 0.01:
        print(f'  {proj}: \${cost:.2f}')
"
```

## Session Count

```bash
echo "Sessions: $(find ~/.pi/agent/sessions -name '*.jsonl' | wc -l | tr -d ' ')"
echo "Projects: $(find ~/.pi/agent/sessions -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
```

## Adapting Queries

- **Filter by date**: Add `find` flags like `-newer` or `-newermt '2026-01-01'`
- **Single project**: Replace `find` path with `~/.pi/agent/sessions/--Users-*-<project>--/`
- **Daily breakdown**: Parse the timestamp from the session filename or from `message.timestamp`
