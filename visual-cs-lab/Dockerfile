# Visual CS Lab — one container that serves the built client and the API.
#
# The Studio writes SQLite and rendered MP4s under DATA_DIR/MEDIA_DIR, so mount a
# volume at /data and point both at it; everything else is stateless.
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    MEDIA_DIR=/data/media

WORKDIR /app

# Dependencies first so source edits do not bust the install layer.
COPY package.json package-lock.json ./
# The build needs vite and the runtime runs the server through tsx, so the whole
# lockfile is installed even though NODE_ENV is production.
RUN npm ci --include=dev --no-audit --no-fund

COPY . .
RUN npm run build

RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 3000

CMD ["npm", "start"]
