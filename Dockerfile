FROM node:24-bookworm-slim
ENV NODE_ENV=production GEOBRIDGE_HOST=0.0.0.0 GEOBRIDGE_DATA_DIR=/app/data
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node sources ./sources
COPY --chown=node:node examples ./examples
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 4317
CMD ["node", "src/server.mjs"]
