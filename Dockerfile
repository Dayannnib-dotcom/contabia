# Contabia — servidor (API + tempo real) e as duas apps web na mesma morada
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
COPY apps/server/package.json apps/server/
COPY apps/empresa/package.json apps/empresa/
COPY apps/contabilista/package.json apps/contabilista/
# Só as dependências do servidor (as apps web já vêm compiladas em web/)
RUN npm ci --workspace @contabia/server --omit=dev --ignore-scripts
COPY packages/shared packages/shared
COPY apps/server apps/server
COPY web web
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["node", "--import", "tsx", "apps/server/src/main.ts"]
