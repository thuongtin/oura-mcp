# linux/arm64 image for MikroTik RouterOS containers (RB5009).
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build \
  && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app

RUN useradd --system --uid 1001 --create-home oura \
  && mkdir -p /data \
  && chown oura:oura /data

COPY --from=build --chown=oura:oura /app/package.json /app/package-lock.json ./
COPY --from=build --chown=oura:oura /app/node_modules ./node_modules
COPY --from=build --chown=oura:oura /app/dist ./dist
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod 755 /app/docker-entrypoint.sh

ENV HOME=/data \
    OURA_MCP_TRANSPORT=http \
    OURA_MCP_HOST=0.0.0.0 \
    OURA_MCP_PORT=3000 \
    OURA_TOKEN_PATH=/data/tokens.json \
    OURA_CACHE=0

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
