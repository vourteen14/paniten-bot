FROM node:20-alpine

RUN apk add --no-cache dumb-init

RUN addgroup -g 1001 -S nodejs && \
    adduser -S paniten -u 1001

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

COPY src/ ./src/

RUN mkdir -p data && chown paniten:nodejs data

USER paniten

EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/app.js"]