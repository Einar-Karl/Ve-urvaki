FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json index.html admin.html guest.html ./
COPY server ./server
COPY src ./src
COPY scripts ./scripts
COPY fixtures ./fixtures
COPY docs ./docs
COPY config ./config
RUN mkdir -p data && chown -R node:node /app
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
CMD ["node", "server/index.js"]
