FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev
COPY server ./server
COPY views ./views
COPY migrations ./migrations
COPY public ./public
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
USER node
CMD ["node","server/index.mjs"]
