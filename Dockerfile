# Render may deploy as Docker (default when no native runtime is selected).
# Build context: repo root. Server lives in server/

FROM node:20-alpine

WORKDIR /app

COPY server/package.json server/package-lock.json ./
RUN npm ci

COPY server/tsconfig.json ./
COPY server/src ./src

RUN npm run build && npm prune --production

ENV NODE_ENV=production

# Render sets PORT at runtime (typically 10000)
EXPOSE 10000

CMD ["node", "dist/index.js"]
