#!/usr/bin/env bash
# steam-cartridges layer audit: the mechanical scans of the audit plan § 5 (steps S2-S4).
# Read-only. Run from C:\game\millennium\steam-cartridges in Git Bash:
#     bash ../docs/plans/steam-cartridges-architecture-audit/scan.sh > "$SCRATCH/scan.txt"
# then compare with scan-expected.txt (recorded on 08b2960, audit plan § 12):
#     diff ../docs/plans/steam-cartridges-architecture-audit/scan-expected.txt "$SCRATCH/scan.txt"
# Every scan prints a header line "## <id> <what>" and then its hits (git grep order, which is stable).
# A hit is not yet a finding: the audit plan § 5 S5-S7 classifies each one.
set -u
export LC_ALL=C

h() { printf '\n## %s\n' "$*"; }

# All scans run inside scans(); its output goes through `tr -d '\r'` because git grep reads the working tree,
# where a checkout may hold CRLF files although the index is LF (three .ts files did on the dry-run machine).
scans() {

h "L1 network I/O outside ports/ (fetch, XHR, FileReader, wsrv, callServerMethod)"
git grep -nE "\bfetch\(|XMLHttpRequest|FileReader|wsrv\.nl|callServerMethod" -- frontend ':!frontend/ports'

h "L2 window/Steam globals in kernel/, domain/, app/, ports/ (ports/transport.ts reaching Millennium is its job)"
git grep -nE "window\.|\(window as|SteamClient|globalThis|document\.|localStorage" -- frontend/kernel frontend/domain frontend/app frontend/ports

h "L3 timers, clocks and logging in kernel/ and domain/"
git grep -nE "setTimeout|setInterval|Date\.now|new Date\(|logger|console\." -- frontend/kernel frontend/domain

h "L4 Steam patches outside surfaces/ and the shared jsx hook"
git grep -nE "afterPatch\(|beforePatch\(|replacePatch\(" -- frontend ':!frontend/surfaces' ':!frontend/steam/jsx-hook.ts'

h "L5 detection (the sensors' job) outside sensors/ and the steam/ helpers they use"
git grep -nE "onPopupCreate\(|onLocationChange\(|onAppLaunch\(|watchGamepadAppid\(" -- frontend ':!frontend/sensors' ':!frontend/steam'

h "L6 webpack module lookups outside steam/ (guardrail 3: steam/modules.ts is the one scanner)"
git grep -nE "findModuleByExport|findModule\(|webpackChunk|__webpack_require__" -- frontend ':!frontend/steam'

h "L7 Steam stores read by the composition root, app/ or settings/ (a sensor's job)"
git grep -nE "\(window as any\)\.(appStore|collectionStore|appDetailsStore|appActivityStore|appAchievementProgressCache|SteamClient)" -- frontend/index.tsx frontend/app frontend/settings

h "L8 what each surface is given besides SurfaceDeps (composition root)"
awk '/create[A-Za-z]+Surface\(/ { p = 1 } p { printf "frontend/index.tsx:%d:%s\n", NR, $0 } p && /(\)\);|^[[:space:]]*\);)[[:space:]]*$/ { p = 0 }' frontend/index.tsx

h "L9 ad-hoc appid math outside kernel/ (kernel/appid.ts is the only place, migration plan § 1.5)"
git grep -nE ">>> 0|\| 0\)|0x8000_?0000|0x0?200_?0000|<< 32" -- frontend ':!frontend/kernel'

h "L10 appData.details assignments (guardrail 8)"
git grep -nE "\.details\s*=[^=]" -- frontend

h "L11 touches entries that share a Steam member (a '#' suffix passes assertDisjointTouches)"
for f in frontend/surfaces/*/index.ts; do
    awk -v f="$f" '/touches:[[:space:]]*\[/ { p = 1 } p { while (match($0, /"[^"]+"/)) { t = substr($0, RSTART + 1, RLENGTH - 2); print t "\t" f; $0 = substr($0, RSTART + RLENGTH) } } p && /\]/ { p = 0 }' "$f"
done | awk -F'\t' '{ base = $1; sub(/#.*/, "", base); n[base]++; w[base] = w[base] " " $1 " (" $2 ")" } END { for (b in n) if (n[b] > 1) print b ":" w[b] }' | sort

h "L12 composition-time setters (D3) still exported"
git grep -nE "export function set[A-Z][A-Za-z]*\(" -- frontend ':!frontend/settings/settings.ts'

h "L13 app/ modules that import the backend port as a value instead of taking it as a dependency"
git grep -nE "^import \{[^}]*\bbackend\b[^}]*\} from" -- frontend/app frontend/surfaces frontend/sensors frontend/domain

h "L14 module-level mutable state in app/ (every other app file is a create* factory)"
git grep -nE "^(let |const [A-Za-z]+ = new (Map|Set))" -- frontend/app

h "L15 window CustomEvents (a second event bus beside kernel/events.ts)"
git grep -nE "CustomEvent\(|addEventListener\(\"(steam-cartridges|cartridges):" -- frontend

h "D1 function or const names defined in more than one file"
git grep -nE "^(export )?(async )?(function|const) [A-Za-z_][A-Za-z0-9_]*" -- frontend \
    | sed -E 's/^([^:]+):[0-9]+:(export )?(async )?(function|const) ([A-Za-z_][A-Za-z0-9_]*).*/\5 \1/' \
    | sort -u | awk '{ n[$1]++; f[$1] = f[$1] " " $2 } END { for (k in n) if (n[k] > 1) print k ":" f[k] }' | sort

h "D2 type or interface names defined in more than one file"
git grep -nE "^(export )?(interface|type) [A-Za-z_][A-Za-z0-9_]*" -- frontend \
    | sed -E 's/^([^:]+):[0-9]+:(export )?(interface|type) ([A-Za-z_][A-Za-z0-9_]*).*/\4 \1/' \
    | sort -u | awk '{ n[$1]++; f[$1] = f[$1] " " $2 } END { for (k in n) if (n[k] > 1) print k ":" f[k] }' | sort

h "D3 copies of the route shape (kernel/record.ts GameRecord.route is the one definition)"
git grep -nE "bucket: \"steam-store\" \| \"web-scraping\" \| \"none\"" -- frontend

h "D4 retry/TTL policy written in more than one layer"
git grep -nE "RETRY_MS\s*=|^\s+error\s*=\s*[0-9]" -- frontend backend/fresh_policy.lua

h "D5 shortcut title resolution (sensor-side reads of display_name)"
git grep -nE "display_name" -- frontend/index.tsx frontend/app frontend/steam

h "D6 hosts named in more than one file"
git grep -ohE "https?://[A-Za-z0-9.-]+" -- frontend backend | sort -u | while read -r host; do
    files=$(git grep -lF "$host" -- frontend backend | tr '\n' ' ')
    [ "$(echo "$files" | wc -w)" -gt 1 ] && echo "$host: $files"
done

h "X1 RPCs registered in backend/main.lua that frontend/ports/backend.ts never names"
comm -23 \
    <(grep -oE "^[A-Z][A-Za-z0-9]+" backend/main.lua | sort -u) \
    <(grep -oE "['\"][A-Z][A-Za-z0-9]+['\"]" frontend/ports/backend.ts | tr -d "'\"" | sort -u) \
    | while read -r n; do echo "$n <- also named in: $(git grep -lw "$n" -- frontend backend tests ':!backend/main.lua' | tr '\n' ' ')"; done

h "X2 frontend/ports/backend.ts methods no other frontend file calls"
grep -oE "^    [a-z][A-Za-z0-9]+\(" frontend/ports/backend.ts | tr -d ' (' | sort -u | while read -r m; do
    git grep -qwE "$m" -- frontend ':!frontend/ports/backend.ts' || echo "$m"
done

h "X3 record parts the kernel declares and no app/ module writes"
for p in route identity metadata achievements media artwork; do
    git grep -qE "update\([a-zA-Z]+, \{ ?$p\b" -- frontend/app || echo "$p"
done

h "X4 backend binary downloads (Millennium's Lua http.get cuts a body at its first NUL byte)"
git grep -nE "download_image|local function download|base64_encode\(res\.body" -- backend

h "B1 backend modules that use an RPC module as a library"
git grep -nE "require\(\"(web_rpc|steam_store_rpc|record_rpc|achievements_rpc)\"\)" -- backend ':!backend/main.lua'

h "B2 HTTP outside backend/net.lua"
git grep -nE "http\.(get|post|request)\(" -- backend ':!backend/net.lua' ':!backend/_lib'

h "B3 persistence modules that also fetch (a store is not a source)"
git grep -nE "require\(\"net\"\)" -- backend/achievements_store.lua backend/steam_store_store.lua backend/web_metadata_db.lua backend/fresh_policy.lua backend/registry.lua

h "B4 services that declare sources with the § 4.3 source contract (supports = function)"
git grep -cE "supports\s*=\s*function" -- backend

h "B5 data files and the modules that name them"
git grep -nE "\"[a-z_]+\.json\"" -- backend ':!backend/_lib' | grep -v "Goldberg"
}

scans 2>&1 | tr -d '\r'
