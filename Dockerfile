# ── Stage 1 : build the custom node ─────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /build

COPY package.json tsconfig.json gulpfile.js ./
# --ignore-scripts skips native compilation of isolated-vm (n8n-workflow dep)
# we only need types + tsc here, not the runtime binaries
RUN npm install --ignore-scripts

COPY src ./src
RUN npm run build

# ── Stage 2 : n8n with the custom node baked in ──────────────────────────────
FROM n8nio/n8n:latest

USER root

# Custom extensions directory (not inside /home/node/.n8n so it won't be
# overridden by the data volume)
RUN mkdir -p /home/node/custom-extensions/n8n-nodes-webstatic

COPY --from=builder --chown=node:node \
  /build/dist \
  /home/node/custom-extensions/n8n-nodes-webstatic/dist

COPY --from=builder --chown=node:node \
  /build/package.json \
  /home/node/custom-extensions/n8n-nodes-webstatic/package.json

USER node
