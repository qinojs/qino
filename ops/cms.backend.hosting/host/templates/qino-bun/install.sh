#!/bin/sh
# Runs as the new project's user, in its directory. NAME, DOMAIN, PORT and ROOT are set.
set -e
git clone -q https://github.com/qinojs/qino.git qino
mkdir -p data
cat > package.json <<'JSON'
{
  "private": true,
  "type": "module",
  "workspaces": ["qino"],
  "dependencies": { "@qino/qino": "workspace:*" }
}
JSON
cat > bunfig.toml <<'TOML'
[install]
minimumReleaseAge = 86400
minimumReleaseAgeExcludes = ["@nuxodin/item", "@nuxodin/dump", "@nuxodin/reporter"]
TOML
cp qino/.npmrc . # a workspace reads only the root's
/usr/local/bin/bun install --production
