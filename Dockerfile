FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/bot/package.json apps/bot/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

COPY . .
RUN npm run build -w @snipr/shared && npm run build -w @snipr/bot \
  && chmod +x apps/bot/docker-entrypoint.sh

ENV NODE_ENV=production
ENV NODE_OPTIONS=--disable-warning=ExperimentalWarning
ENV PORT=7860
ENV DATA_DIR=/data
ENV LIVE_TRADING=false
ENV LEARN_NIGHTLY=false
EXPOSE 7860

ENTRYPOINT ["sh", "apps/bot/docker-entrypoint.sh"]
