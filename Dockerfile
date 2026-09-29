FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ghostscript \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

ENV NODE_ENV=production
CMD ["npm", "start"]
