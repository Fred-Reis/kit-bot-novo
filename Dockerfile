FROM oven/bun:latest

WORKDIR /app

COPY package.json bun.lock* ./
COPY prisma ./prisma/
COPY prisma.config.ts ./
RUN bun install --frozen-lockfile
RUN bunx prisma generate

COPY tsconfig.json ./
COPY src ./src/

EXPOSE 8000

CMD ["bun", "run", "src/app.ts"]
