# Stage 1: Build the dashboard and core packages
FROM node:22-alpine AS builder

# Install pnpm
RUN npm install -g pnpm

WORKDIR /app

# Copy lockfile and workspace configuration
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

# Copy package.json files for dependency caching
COPY homepage/package.json ./homepage/
COPY understand-anything-plugin/package.json ./understand-anything-plugin/
COPY understand-anything-plugin/packages/core/package.json ./understand-anything-plugin/packages/core/
COPY understand-anything-plugin/packages/dashboard/package.json ./understand-anything-plugin/packages/dashboard/

# Install dependencies (use --ignore-scripts to prevent tsc from running before source code is copied)
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy the rest of the application files
COPY . .

# Build the required packages (core and dashboard)
RUN pnpm --filter @understand-anything/core build && pnpm --filter @understand-anything/dashboard build

# Stage 2: Serve the dashboard using Nginx
FROM nginx:alpine

# Copy built dashboard assets to the Nginx html directory
COPY --from=builder /app/understand-anything-plugin/packages/dashboard/dist /usr/share/nginx/html

# Expose port 80
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
