# Stage 1: Build the React frontend
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source code and build
COPY . .
RUN npm run build

# Stage 2: Setup the production Node.js environment
FROM node:20-alpine

WORKDIR /app

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy the built frontend and the Express server
COPY --from=builder /app/dist ./dist
COPY server.js ./
COPY db.js ./

# Expose the API port
EXPOSE 3001

# Set environments (Coolify will inject GEMINI_API_KEY)
ENV PORT=3001
ENV NODE_ENV=production

# Start the server
CMD ["npm", "start"]
