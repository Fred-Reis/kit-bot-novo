FROM oven/bun:latest

WORKDIR /app

# Copy workspace root
COPY package.json bun.lock* ./
COPY packages/types ./packages/types/

# Copy bot app
COPY apps/bot/package.json ./apps/bot/
COPY apps/bot/prisma ./apps/bot/prisma/
COPY apps/bot/prisma.config.ts ./apps/bot/
COPY apps/bot/tsconfig.json ./apps/bot/

RUN bun install

ARG DIRECT_URL=postgresql://placeholder:5432/placeholder
ARG DATABASE_URL=postgresql://placeholder:5432/placeholder
RUN cd apps/bot && bunx prisma generate

COPY apps/bot/src ./apps/bot/src/

WORKDIR /app/apps/bot

EXPOSE 8000

CMD ["bun", "run", "src/app.ts"]
