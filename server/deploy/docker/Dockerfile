FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (production only)
RUN npm install --omit=dev

# Copy source
COPY src/ ./src/

# Create data directory
RUN mkdir -p /data

# Set defaults
ENV PORT=3000
ENV STORAGE_TYPE=filesystem
ENV STORAGE_PATH=/data

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "src/adapters/express.js"]
