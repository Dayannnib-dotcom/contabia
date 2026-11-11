# Servidor Contabia (API + tempo real)
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
COPY apps/server/package.json apps/server/
COPY apps/empresa/package.json apps/empresa/
COPY apps/contabilista/package.json apps/contabilista/
RUN npm ci --ignore-scripts
COPY packages/shared packages/shared
COPY apps/server apps/server
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["npx", "tsx", "apps/server/src/main.ts"]
