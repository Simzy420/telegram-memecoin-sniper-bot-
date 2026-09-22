FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/bot/package.json apps/bot/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

COPY . .
RUN npm run build -w @snipr/shared && npm run build -w @snipr/bot

ENV NODE_ENV=production
CMD ["npm", "run", "start", "-w", "@snipr/bot"]
