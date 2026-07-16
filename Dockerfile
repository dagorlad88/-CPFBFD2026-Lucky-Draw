# Lucky Draw — single Node service that serves the UI and the SQLite-backed API.
FROM node:20-slim

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package*.json ./
RUN npm ci

# Build the front-end.
COPY . .
RUN npm run build

# Runtime config: listen on 8080 and keep the SQLite file on a mounted volume
# so data survives restarts/redeploys.
ENV PORT=8080
ENV DB_PATH=/data/luckydraw.db
VOLUME ["/data"]
EXPOSE 8080

CMD ["node", "server.js"]
