# syntax=docker/dockerfile:1

FROM oven/bun:1.3 AS build
WORKDIR /app
# vendor/pixel-art-icons is a `file:` dep — `bun install` needs it on disk to
# resolve the dependency, so copy it alongside the manifest before installing.
COPY package.json bun.lock ./
COPY vendor ./vendor
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1.3 AS production-deps
WORKDIR /app
COPY package.json bun.lock ./
COPY vendor ./vendor
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3 AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
ENV STATIC_DIR=/app/dist
ENV UPLOADS_DIR=/app/uploads

COPY --from=production-deps --chown=bun:bun /app/node_modules ./node_modules
COPY --from=build --chown=bun:bun /app/dist ./dist
COPY --chown=bun:bun package.json bun.lock ./
COPY --chown=bun:bun tsconfig*.json ./
COPY --chown=bun:bun server ./server
COPY --chown=bun:bun src ./src

RUN mkdir -p /app/uploads /app/data && chown -R bun:bun /app

USER bun
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["bun", "run", "server/healthcheck.ts"]

CMD ["bun", "run", "server/index.ts"]
