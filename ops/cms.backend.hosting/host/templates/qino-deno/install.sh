#!/bin/sh
# Runs as the new project's user, in its directory. NAME, DOMAIN, PORT and ROOT are set.
set -e
git clone -q https://github.com/qinojs/qino.git qino
mkdir -p data
cat > deno.json <<'JSON'
{
  "workspace": ["./qino"],
  "unstable": ["worker-options"],
  "nodeModulesDir": "none",
  "minimumDependencyAge": { "age": "P1D", "exclude": ["jsr:@nuxodin/item"] }
}
JSON
