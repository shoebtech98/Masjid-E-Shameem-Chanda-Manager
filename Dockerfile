# Masjid E Shameem – Chanda Manager · production image
# Node.js >= 22.13 (uses the built-in node:sqlite and .env loader — no native
# dependencies, no build tooling).
FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

# Install dependencies first (layer caching). All deps are runtime deps.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy only the Express app and its runtime/build scripts.
COPY server.js env.js db.js auth.js ./
COPY lib/ ./lib/
COPY routes/ ./routes/
COPY scripts/ ./scripts/

# Syntax-check the API entry point.
RUN npm run build

# Persistent storage: the SQLite database + backups live under /app/data.
# Mount a named volume or bind mount here (see docker-compose.yml / DEPLOY.md).
RUN mkdir -p /app/data && chown -R node:node /app
VOLUME /app/data

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
