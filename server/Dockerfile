# syntax=docker/dockerfile:1
# Build context: repository root (npm workspaces).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --workspace server --include-workspace-root=false
COPY server server
RUN npm run build -w server

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --workspace server --include-workspace-root=false --omit=dev && npm cache clean --force
COPY --from=build /app/server/dist server/dist
WORKDIR /app/server
USER node
EXPOSE 4100
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:4100/api/v1/health || exit 1
CMD ["node", "dist/server.js"]
