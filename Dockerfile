# GSC-MCP — Laufzeit-Image ([docs/01]).
# Führt TypeScript direkt über tsx aus (die Quellen importieren mit .ts-Endung,
# tsconfig ist emitDeclarationOnly — es gibt bewusst kein JS-Build).
FROM node:22-slim

WORKDIR /app

# Nur Manifeste zuerst — nutzt den Layer-Cache für npm ci.
COPY package.json package-lock.json ./
COPY packages/core/package.json        packages/core/
COPY packages/analytics/package.json   packages/analytics/
COPY packages/db/package.json          packages/db/
COPY packages/gsc-client/package.json  packages/gsc-client/
COPY apps/app/package.json             apps/app/
COPY apps/worker/package.json          apps/worker/
RUN npm ci

# Danach der Rest.
COPY . .

ENV NODE_ENV=production
EXPOSE 8080

# Standard: der MCP-/OAuth-Server. Der Worker nutzt dasselbe Image mit anderem CMD.
CMD ["npx", "tsx", "apps/app/src/main.ts"]
