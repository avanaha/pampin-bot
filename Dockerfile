FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++ sqlite

COPY package*.json ./

RUN npm install

COPY . .

RUN npm run build

RUN npm prune --production

RUN mkdir -p /app/data

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
