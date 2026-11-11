import { abrirDb } from "./db.ts";
import { criarApp } from "./app.ts";

const porta = Number(process.env.PORT ?? 3000);
const segredo = process.env.JWT_SECRET;
if (!segredo && process.env.NODE_ENV === "production") throw new Error("Defina JWT_SECRET em produção.");

const db = await abrirDb(process.env.DATABASE_URL, process.env.DATABASE_URL ? undefined : (process.env.PASTA_DADOS ?? "./data"));
const { app } = await criarApp(db, {
  segredoJWT: segredo ?? "desenvolvimento-apenas-mude-isto",
  tokenAdmin: process.env.ADMIN_TOKEN,
  chaveIA: process.env.ANTHROPIC_API_KEY,
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
