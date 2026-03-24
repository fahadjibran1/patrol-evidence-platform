#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
SITE_CODE="${2:-OXF01}"
FILE_PATH="${3:-./sample.jpg}"
SENDER="${4:-ManualTester}"

if [[ ! -f "$FILE_PATH" ]]; then
  echo "File not found: $FILE_PATH"
  exit 1
fi

for i in {0..4}; do
  ts=$(date -u -d "+${i} hour" +"%Y-%m-%dT%H:%M:%SZ")
  echo "Uploading patrol $((i+1)) at $ts"
  curl -sS -X POST "$BASE_URL/patrol-images/manual-ingest" \
    -F "siteCode=$SITE_CODE" \
    -F "timestamp=$ts" \
    -F "senderName=$SENDER" \
    -F "file=@$FILE_PATH" 
  echo
  sleep 1
done
