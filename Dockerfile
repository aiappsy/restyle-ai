# Stage 1: Build the React frontend
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm config set fetch-retries 5 && npm config set fetch-retry-mintimeout 20000 && npm config set fetch-retry-maxtimeout 120000 && npm ci --no-audit --no-fund

# Copy source code and build
COPY . .
RUN npm run build

# Stage 2: Setup the production Node.js environment
FROM node:20-alpine

WORKDIR /app

# Install only production dependencies
COPY package*.json ./
RUN npm config set fetch-retries 5 && npm config set fetch-retry-mintimeout 20000 && npm config set fetch-retry-maxtimeout 120000 && npm ci --omit=dev --no-audit --no-fund

# Copy the built frontend and the Express server
COPY --from=builder /app/dist ./dist
COPY server.js ./
COPY db.js ./
COPY agents.js ./

# Expose the API port
EXPOSE 3001

# Set environments (Coolify will inject GEMINI_API_KEY)
ENV PORT=3001
ENV NODE_ENV=production

# Start the server
CMD ["npm", "start"]
