import { abrirDb } from "./db.ts";
import { criarApp } from "./app.ts";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const porta = Number(process.env.PORT ?? 3000);
const segredo = process.env.JWT_SECRET;
if (!segredo && process.env.NODE_ENV === "production") throw new Error("Defina JWT_SECRET em produção.");

// Em produção, sem base de dados permanente os dados perder-se-iam em cada atualização:
// é melhor o servidor não arrancar (o Render mostra o erro) do que perder dados em silêncio.
if (!process.env.DATABASE_URL && process.env.NODE_ENV === "production" && process.env.PERMITIR_SEM_BASE_DADOS !== "1")
  throw new Error("DATABASE_URL em falta: ligue a base de dados PostgreSQL (contabia-db-eu) no Render.");

const db = await abrirDb(process.env.DATABASE_URL, process.env.DATABASE_URL ? undefined : (process.env.PASTA_DADOS ?? "./data"));
const { app } = await criarApp(db, {
  agendarAvisosPrazos: true,
  segredoJWT: segredo ?? "desenvolvimento-apenas-mude-isto",
  tokenAdmin: process.env.ADMIN_TOKEN,
  chaveIA: process.env.ANTHROPIC_API_KEY,
  pastaWeb: process.env.PASTA_WEB ?? resolve(fileURLToPath(import.meta.url), "../../../../web"),
});

await app.listen({ port: porta, host: "0.0.0.0" });
console.log(`Contabia API em http://localhost:${porta} (${process.env.DATABASE_URL ? "PostgreSQL" : "PGlite local"})`);

for (const s of ["SIGINT", "SIGTERM"]) {
  process.on(s, async () => {
    await app.close();
    await db.fechar();
    process.exit(0);
  });
}
