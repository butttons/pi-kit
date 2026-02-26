#!/bin/bash
# Generate weekly briefs for the last N weeks (default: 6)

WEEKS=${1:-6}

for i in $(seq 0 $((WEEKS - 1))); do
  # Get the Monday of each week, then derive the ISO week string
  monday=$(date -v-${i}w -v-mon +%Y-%m-%d 2>/dev/null || date -d "last monday - ${i} weeks" +%Y-%m-%d)
  year=$(date -j -f "%Y-%m-%d" "$monday" +%G 2>/dev/null || date -d "$monday" +%G)
  week=$(date -j -f "%Y-%m-%d" "$monday" +%V 2>/dev/null || date -d "$monday" +%V)
  label="${year}-W${week}"

  echo "=== ${label} ==="
  pi -p "/brief weekly ${label}"
  echo ""
done
