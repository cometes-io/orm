FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY examples/nodejs ./examples/nodejs

CMD ["npm", "run", "example"]
