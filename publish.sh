#!/bin/sh
# Usage: NPM_TOKEN=<your-token> ./publish.sh
set -e

if [ -z "$NPM_TOKEN" ]; then
  echo "Error: NPM_TOKEN is not set."
  echo "Usage: NPM_TOKEN=npm_xxxx ./publish.sh"
  exit 1
fi

echo "Building and publishing n8n-nodes-webstatic..."

docker run --rm \
  -e NPM_TOKEN="$NPM_TOKEN" \
  -v "$(pwd)":/app \
  -w /app \
  node:20-alpine \
  sh -c "
    apk add --no-cache python3 make g++ > /dev/null 2>&1 || true
    npm config set //registry.npmjs.org/:_authToken \"\$NPM_TOKEN\"
    npm install --ignore-scripts
    npm run build
    npm publish --access public
  "

echo "Done! https://www.npmjs.com/package/n8n-nodes-webstatic"
