FROM node:22-alpine

WORKDIR /app

# Copy package files first for layer caching
COPY package*.json ./

RUN npm ci --only=production

COPY . .

# Ensure the node user owns all app files (including the SQLite DB directory)
RUN chown -R node:node /app

EXPOSE 3001

USER node

CMD ["node", "server.js"]
