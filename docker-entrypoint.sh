#!/bin/sh
set -eu

fix_token() {
  file="$1"
  if [ -f "$file" ]; then
    chown oura:oura "$file" 2>/dev/null || true
    chmod 600 "$file" 2>/dev/null || true
  fi
}

token="${OURA_TOKEN_PATH:-/data/tokens.json}"
fix_token "$token"
fix_token /data/tokens.txt
fix_token /data/tokens.json

if [ "$(id -u)" = "0" ] && command -v runuser >/dev/null 2>&1; then
  exec runuser -u oura -- "$@"
fi

exec "$@"
