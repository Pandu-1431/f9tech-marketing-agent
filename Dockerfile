# Local production build: web app + background worker (same image), see docker-compose.yml.
FROM node:22-bookworm-slim

# ffmpeg = Video Studio, fontconfig = poster/reel text rendering.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fontconfig ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    FFMPEG_PATH=/usr/bin/ffmpeg

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build && npm cache clean --force

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000", "-H", "0.0.0.0"]
