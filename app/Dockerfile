# Builds the API image: docker build -t parakh-api .
FROM node:22-alpine AS build
WORKDIR /app
# Prisma's query engine needs OpenSSL on Alpine.
RUN apk add --no-cache openssl

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/question-parser/package.json packages/question-parser/
COPY apps/api/package.json apps/api/
RUN npm ci -w @parakh/shared -w @parakh/question-parser -w @parakh/api --include-workspace-root=false

COPY packages/shared packages/shared
COPY packages/question-parser packages/question-parser
COPY apps/api apps/api
# The API build also runs `prisma generate`; DATABASE_URL is only a placeholder for that step.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build \
    npm run build -w @parakh/shared -w @parakh/question-parser -w @parakh/api
# Drop dev dependencies for the runtime image (prisma CLI stays: it runs migrations).
RUN npm prune --omit=dev -w @parakh/shared -w @parakh/question-parser -w @parakh/api

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/packages/question-parser ./packages/question-parser
COPY --from=build /app/apps/api ./apps/api
COPY package.json ./
USER node
WORKDIR /app/apps/api
CMD ["node", "dist/main.js"]
