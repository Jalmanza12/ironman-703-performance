#!/bin/sh
# Rebuilds js/vendor/supabase.js: a single self-contained ES module of @supabase/supabase-js,
# loaded lazily only when the athlete opens cloud backup. Versions are pinned; the app keeps
# no runtime npm dependencies. Usage: sh scripts/vendor-supabase.sh
set -eu
SUPABASE_JS=2.117.2
ESBUILD=0.28.2
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"
npm init -y >/dev/null
npm install --ignore-scripts --no-audit --no-fund "@supabase/supabase-js@$SUPABASE_JS" >/dev/null
printf "export { createClient } from '@supabase/supabase-js';\n" > entry.js
npx -y "esbuild@$ESBUILD" entry.js --bundle --format=esm --platform=browser --target=es2020 --minify --legal-comments=eof \
  --banner:js="/* @supabase/supabase-js $SUPABASE_JS — bundled with esbuild $ESBUILD by scripts/vendor-supabase.sh. MIT License. */" \
  --outfile="$ROOT/js/vendor/supabase.js" --log-level=warning
cd "$ROOT"
shasum -a 256 js/vendor/supabase.js
