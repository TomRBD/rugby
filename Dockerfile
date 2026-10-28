# Image unique API + worker (le worker est le même code lancé avec une autre commande)
FROM node:22-bookworm-slim AS construction
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
COPY apps/web apps/web
RUN npm run build -w @rugby/shared && npm run build -w @rugby/api && npm run build -w @rugby/web

FROM node:22-bookworm-slim AS serveur
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core python3 ca-certificates curl \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/download/2024.11.18/yt-dlp -o /usr/local/bin/yt-dlp && chmod +x /usr/local/bin/yt-dlp \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci --omit=dev -w @rugby/api -w @rugby/shared
COPY --from=construction /app/packages/shared/dist packages/shared/dist
COPY --from=construction /app/apps/api/dist apps/api/dist
COPY apps/api/migrations apps/api/migrations
WORKDIR /app/apps/api
EXPOSE 3000
CMD ["node", "dist/server.js"]

# Front statique servi par Nginx (avec proxy vers l'API)
FROM nginx:1.27-alpine AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=construction /app/apps/web/dist /usr/share/nginx/html
