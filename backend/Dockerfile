FROM oven/bun:1.3.5 AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN bun install --frozen-lockfile --production --filter @yds-atlas/backend --filter @yds-atlas/shared

FROM oven/bun:1.3.5 AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
COPY --from=dependencies /app /app
COPY backend/package.json ./backend/package.json
COPY backend/src ./backend/src
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/shared/src ./packages/shared/src
USER bun
EXPOSE 3000
CMD ["bun", "run", "backend/src/index.ts"]

