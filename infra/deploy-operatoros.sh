#!/bin/bash
# Lives at /opt/deploy-operatoros.sh on web-01 and web-02, triggered by
# the GitHub Actions deploy key (forced command, see
# .github/workflows/deploy.yml). Committed here too (not just on the
# boxes) after an edit to it once went un-deployed for several commits
# without anyone noticing -- a hand-maintained ops script with no
# version control is exactly how that kind of drift happens invisibly.
# Deploying a change: edit here, scp to /opt/deploy-operatoros.sh on
# BOTH boxes, chmod 755, chown ubuntu:ubuntu. There is currently no
# automation that does this sync step for you -- do it by hand and
# confirm on both boxes.
#
# Pulls main, rebuilds apps/api and apps/web, migrates the DB once per
# deploy (web-01 only -- alembic migrations must never run from both
# boxes concurrently, see docs/DECISIONS.md "First real production
# deploy"), and restarts all three services. Runs as `ubuntu` via the
# forced-command SSH key; individual steps escalate with sudo where
# needed (matching the original single-app script's chown-around-the-
# build pattern).
set -euo pipefail
cd /opt/operatoros-monorepo
sudo chown -R ubuntu:ubuntu /opt/operatoros-monorepo
# Explicit, FORCED refspec (leading +): the checkout on these boxes was
# originally made with --single-branch (rebuild/phase-2), which never
# configured a tracking ref for main, so a plain `origin main` fetch has
# nothing to fast-forward from and this creates the ref outright. The
# force matters on every *subsequent* deploy too -- --depth 1 means each
# fetch's single commit shares no history with the last one it fetched,
# which a non-forced update to a local ref refuses as "non-fast-forward"
# even though the `reset --hard` below makes that distinction moot
# anyway.
git fetch --depth 1 origin +main:refs/remotes/origin/main
git reset --hard origin/main

export PATH="$HOME/.local/bin:$PATH"

# --- backend -------------------------------------------------------------
cd apps/api
uv pip install --python .venv/bin/python -e .
if [ "$(hostname)" = "7090-web-01" ]; then
  set -a; source .env; set +a
  .venv/bin/alembic upgrade head
fi
cd ../..

# --- frontend --------------------------------------------------------------
# Standalone output (next.config.mjs `output: "standalone"`) keeps the
# runtime footprint small on these ~1GB boxes; the BUILD step itself is
# still the heaviest thing this script does, which is what the 2GB swap
# file added alongside this script exists for.
npm install --no-audit --no-fund
# V8 caps its own heap independent of whatever swap the OS has --
# `next build` OOM'd here even with the 2GB swap file in place, because
# node's default max-old-space-size is sized off perceived physical RAM
# (~921MB on these boxes), not physical+swap. Raising it explicitly lets
# the build actually spill into swap instead of crashing; it'll be
# slower, not smaller.
# NEXT_PUBLIC_API_BASE_URL must be a truthy string at BUILD time --
# lib/api/config.ts::USE_MOCK_API is `!process.env.NEXT_PUBLIC_API_BASE_URL`,
# and Next.js inlines NEXT_PUBLIC_* vars into the client bundle at build
# time, not read live at runtime. Leaving this unset was a real deploy
# bug the first time around: the site silently ran against mock data.
# The value itself doesn't matter beyond being non-empty (requests are
# always same-origin regardless, per the nginx /api/ routing), but it's
# set to the real domain for clarity.
NODE_OPTIONS="--max-old-space-size=1536" NEXT_PUBLIC_API_BASE_URL="https://operatoros.orion-labs.dev" npm run build --workspace apps/web
rm -rf apps/web/.next/standalone/apps/web/.next/static apps/web/.next/standalone/apps/web/public
cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static
# apps/web/public exists locally but is currently empty (git doesn't
# track empty directories) -- tolerate it being absent on a fresh
# checkout rather than assuming it's always there.
[ -d apps/web/public ] && cp -r apps/web/public apps/web/.next/standalone/apps/web/public || mkdir -p apps/web/.next/standalone/apps/web/public

deployed_commit=$(git rev-parse --short HEAD)
sudo chown -R www-data:www-data /opt/operatoros-monorepo
sudo systemctl restart operatoros-api operatoros-worker operatoros
echo "[deploy] operatoros updated to $deployed_commit on $(hostname)"
