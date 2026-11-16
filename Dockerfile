FROM node:22-alpine
LABEL org.opencontainers.image.title="Veredicto" \
      org.opencontainers.image.description="El juez de tu tiempo, en tu servidor." \
      org.opencontainers.image.source="https://github.com/joacoAviles/veredicto" \
      org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production PORT=8080 DATOS_DIR=/datos
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY sql ./sql
COPY public ./public
COPY themes ./themes
RUN mkdir -p /datos && chown node:node /datos
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:8080/salud || exit 1
CMD ["node", "src/server.js"]
