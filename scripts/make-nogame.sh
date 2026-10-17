#!/bin/sh
# Makes file-log-nogame from file-log: the same tool, the game files left out and the game tab off.
# Run it again after each change to file-log.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
src="$root/file-log"
out="$root/file-log-nogame"

rm -rf "$out"
mkdir -p "$out/.claude-plugin" "$out/hooks" "$out/types" "$out/tests"

version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$src/.claude-plugin/plugin.json")
cat > "$out/.claude-plugin/plugin.json" <<JSON
{
  "name": "file-log-nogame",
  "version": "$version",
  "description": "右側面板列出這次對話修改與新增的檔案，並可查看今天所有對話的紀錄（不含小遊戲）",
  "types": "./types/index.d.ts"
}
JSON

cp "$src/hooks/hooks.json" "$out/hooks/hooks.json"
cat > "$out/hooks/features.ts" <<'TS'
// Made by scripts/make-nogame.sh from file-log: no game tab, no game files.
export const GAMES = false
TS
for f in hooks/register.tsx types/index.d.ts tests/file-log.test.ts; do
  sed "s/'file-log'/'file-log-nogame'/g" "$src/$f" > "$out/$f"
done
# The game view names the game files: it goes, from the GAMES:BEGIN line to the GAMES:END line.
sed '/GAMES:BEGIN/,/GAMES:END/d' "$out/hooks/register.tsx" > "$out/hooks/register.tmp"
mv "$out/hooks/register.tmp" "$out/hooks/register.tsx"
if grep -Eq 'module="\./(snake|dino)\.tsx"' "$out/hooks/register.tsx"; then
  echo "file-log-nogame still names a game file: check the GAMES:BEGIN / GAMES:END lines" >&2
  exit 1
fi
echo "made $out ($version)"
