# Web build + API server in one image.
#   docker build -t cooking .
#   docker run -p 8792:8792 --env-file server/.env cooking

FROM node:24-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json tsconfig.node.json ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM node:24-alpine
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY server/src ./src
COPY --from=web /app/dist /app/dist
ARG APP_VERSION=dev
ENV NODE_ENV=production \
    PORT=8792 \
    DIST_DIR=/app/dist \
    APP_VERSION=$APP_VERSION
EXPOSE 8792
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:8792/api/health || exit 1
CMD ["node", "src/index.ts"]
