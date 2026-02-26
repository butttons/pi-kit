#!/bin/bash
# Generate daily briefs for the last N days (default: 30)

DAYS=${1:-30}

for i in $(seq 0 $((DAYS - 1))); do
  label=$(date -v-${i}d +%Y-%m-%d 2>/dev/null || date -d "today - ${i} days" +%Y-%m-%d)

  echo "=== ${label} ==="
  pi -p "/brief daily ${label}"
  echo ""
done
