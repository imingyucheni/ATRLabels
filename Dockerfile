# ATR 面单系统
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# better-sqlite3 没有预编译包时需要编译工具
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .
RUN npx next build

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/app/data
ENV PORT=3000
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/scripts ./scripts
RUN npm prune --omit=dev
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
