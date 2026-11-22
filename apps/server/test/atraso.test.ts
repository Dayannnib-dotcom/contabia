import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { abrirDb, type Db } from "../src/db.ts";
import { criarApp } from "../src/app.ts";

// Uma declaração de IVA por submeter não pode desaparecer da app quando o prazo passa.
let db: Db;
let app: Awaited<ReturnType<typeof criarApp>>["app"];
let relogio = new Date("2026-11-10T10:00:00Z"); // antes do prazo do 3.º trimestre (20/11)

async function chamar(metodo: string, caminho: string, tk?: string, corpo?: unknown) {
  const r = await app.inject({
    method: metodo as "GET", url: caminho,
    headers: { ...(tk ? { authorization: `Bearer ${tk}` } : {}), ...(corpo !== undefined ? { "content-type": "application/json" } : {}) },
    payload: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  return { status: r.statusCode, json: r.body ? JSON.parse(r.body) : null };
}

before(async () => {
  db = await abrirDb(process.env.TEST_DATABASE_URL);
  ({ app } = await criarApp(db, { segredoJWT: "teste", tokenAdmin: "admin", agora: () => relogio, enviarEmail: async () => true }));
});
after(async () => { await app.close(); await db.fechar(); });

test("IVA em atraso continua visível até ser submetido", async () => {
  const e = await chamar("POST", "/v1/auth/empresas", undefined, { utilizador: "atraso.lda", nif: "509999999", nome: "Atraso, Lda.", senha: "segredo123", regiao: "PT", regimeIVA: "trimestral" });
  assert.equal(e.status, 201);
  const c = await chamar("POST", "/v1/auth/contabilistas", undefined, { email: "cc.atraso@exemplo.pt", nome: "Rui CC", numeroOCC: "54321", senha: "segredo123" });
  const emp = e.json.token, cc = c.json.token, id = e.json.id;
  const lig = await chamar("POST", "/v1/ligacoes", cc, { utilizador: "atraso.lda", nif: "509999999" });
  assert.equal((await chamar("POST", `/v1/ligacoes/${lig.json.id}/aceitar`, emp, { versao: 1 })).status, 200);

  // compra de setembro (3.º trimestre), validada e lançada
  const d = await chamar("POST", `/v1/empresas/${id}/documentos`, emp, { tipo: "compra", terceiroNif: "500000000", terceiroNome: "Papelaria", numero: "FT 9/1", data: "2026-09-15", base: 100, iva: 23, taxa: 23 });
  assert.equal(d.status, 201);
  await chamar("POST", `/v1/empresas/${id}/documentos/${d.json.id}/validar`, emp, {});
  const props = await chamar("GET", `/v1/empresas/${id}/lancamentos?estado=proposto`, cc);
  for (const l of props.json) assert.equal((await chamar("POST", `/v1/empresas/${id}/lancamentos/${l.id}/aprovar`, cc, { versao: l.versao })).status, 200);

  // antes do prazo: 2026T3 é a próxima declaração, sem atraso
  let prazos = (await chamar("GET", `/v1/empresas/${id}/prazos`, cc)).json;
  assert.equal(prazos.find((p: { codigo: string }) => p.codigo === "dp_iva").periodo, "2026T3");
  assert.equal(prazos.some((p: { atrasada: boolean }) => p.atrasada), false);

  // o prazo passa sem submissão: a declaração continua lá, marcada em atraso e em primeiro lugar
  relogio = new Date("2026-11-22T10:00:00Z");
  prazos = (await chamar("GET", `/v1/empresas/${id}/prazos`, cc)).json;
  assert.deepEqual([prazos[0].codigo, prazos[0].periodo, prazos[0].atrasada, prazos[0].submetida], ["dp_iva", "2026T3", true, false]);
  assert.equal((await chamar("GET", "/v1/carteira", cc)).json[0].ivaSubmetido, false);
  // a empresa também vê o atraso
  assert.equal((await chamar("GET", `/v1/empresas/${id}/prazos`, emp)).json[0].atrasada, true);

  // submetida fora de prazo: deixa de aparecer em atraso
  assert.equal((await chamar("POST", `/v1/empresas/${id}/iva/2026T3/ficheiro`, cc, {})).status, 200);
  assert.equal((await chamar("POST", `/v1/empresas/${id}/iva/2026T3/submissao`, cc, { comprovativo: "AT-998877" })).status, 201);
  prazos = (await chamar("GET", `/v1/empresas/${id}/prazos`, cc)).json;
  assert.equal(prazos.some((p: { atrasada: boolean }) => p.atrasada), false);
  assert.equal(prazos.find((p: { codigo: string }) => p.codigo === "dp_iva").periodo, "2026T4");
});

test("sem lançamentos no período não há falso atraso", async () => {
  const e = await chamar("POST", "/v1/auth/empresas", undefined, { utilizador: "nova.lda", nif: "500000000", nome: "Nova, Lda.", senha: "segredo123", regiao: "PT", regimeIVA: "mensal" });
  const prazos = (await chamar("GET", `/v1/empresas/${e.json.id}/prazos`, e.json.token)).json;
  assert.equal(prazos.some((p: { atrasada: boolean }) => p.atrasada), false);
});
