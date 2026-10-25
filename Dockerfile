FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ghostscript unzip \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p public/assets/math-adventure/art-pack \
  && unzip -oq public/math_adventure_art_pack.zip "maps/*" -d public/assets/math-adventure/art-pack

ENV NODE_ENV=production
CMD ["npm", "start"]
