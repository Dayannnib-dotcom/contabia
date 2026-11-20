import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { abrirDb, type Db } from "../src/db.ts";
import { criarApp } from "../src/app.ts";
import { estimarDeducoes, categoriaCasaSugerida } from "@contabia/shared";

let db: Db;
let app: Awaited<ReturnType<typeof criarApp>>["app"];
const emails: { para: string; assunto: string }[] = [];
let token = "";

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
  ({ app } = await criarApp(db, { segredoJWT: "teste", tokenAdmin: "admin", agora: () => new Date("2026-11-20T10:00:00Z"),
    enviarEmail: async (e) => { emails.push(e); return true; }, emailEstudos: "equipa@contabia.test" }));
});
after(async () => { await app.close(); await db.fechar(); });

test("casa 1. deduções: taxas e limites", () => {
  const d = (categoria: "gerais" | "saude" | "exigencia", total: number, iva = 0) => ({ categoria, total, iva, data: "2026-05-01" });
  const r = estimarDeducoes([d("gerais", 1000), d("gerais", 500), d("saude", 200), d("exigencia", 123, 23), { ...d("saude", 999), anulada: true }, { ...d("gerais", 50), data: "2025-12-31" }], 1);
  const l = Object.fromEntries(r.linhas.map((x) => [x.categoria, x]));
  assert.equal(l.gerais.deducao, 250); // 35% de 1500 = 525, limite 250 por titular
  assert.equal(l.saude.deducao, 30); // 15% de 200; a anulada não conta
  assert.equal(l.exigencia.deducao, 3.45); // 15% do IVA
  assert.equal(estimarDeducoes([d("gerais", 1500)], 2).linhas[0].deducao, 500); // dois titulares
  assert.equal(categoriaCasaSugerida("Farmácia Central"), "saude");
  assert.equal(categoriaCasaSugerida("Restaurante O Mar"), "exigencia");
  assert.equal(categoriaCasaSugerida("Continente"), "gerais");
});

test("casa 2. conta, agregado, faturas e consentimento de saúde", async () => {
  const c = await chamar("POST", "/v1/auth/casas", undefined, { nome: "Rita Gomes", email: "Rita@Exemplo.pt", nif: "123456789", senha: "segredo123" });
  assert.equal(c.status, 201);
  assert.equal(c.json.papel, "casa");
  token = c.json.token;
  assert.equal((await chamar("POST", "/v1/auth/casas", undefined, { nome: "Outra", email: "rita@exemplo.pt", nif: "123456789", senha: "segredo123" })).json.codigo, "email_existe");
  const login = await chamar("POST", "/v1/auth/sessoes", undefined, { papel: "casa", identificador: "rita@exemplo.pt", senha: "segredo123" });
  assert.equal(login.status, 200);

  // a conta da casa não entra em rotas de empresa
  assert.ok([401, 403].includes((await chamar("GET", `/v1/empresas/${c.json.id}/documentos`, token)).status));

  const dep = await chamar("POST", "/v1/casa/membros", token, { nome: "Tiago", nif: "509999999", tipo: "dependente" });
  assert.equal(dep.status, 201);
  const qr = "A:500000000*B:123456789*C:PT*D:FT*E:N*F:20261110*G:FT 2026/7*H:ABCD-7*I1:PT*I7:100.00*I8:23.00*N:23.00*O:123.00*Q:Ab1C*R:9999";
  const f = await chamar("POST", "/v1/casa/despesas", token, { qr, emitente: "Supermercado Bom Dia" });
  assert.equal(f.status, 201);
  assert.equal(f.json.categoria, "gerais");
  assert.equal(f.json.total, 123);
  assert.equal((await chamar("POST", "/v1/casa/despesas", token, { qr })).json.codigo, "repetida");

  // saúde só com consentimento
  const semC = await chamar("POST", "/v1/casa/despesas", token, { nifEmitente: "500000000", emitente: "Farmácia Central", data: "2026-10-02", total: 40 });
  assert.equal(semC.json.codigo, "consentimento_saude");
  await chamar("PUT", "/v1/casa/consentimento-saude", token, { consentir: true });
  const saude = await chamar("POST", "/v1/casa/despesas", token, { nifEmitente: "500000000", emitente: "Farmácia Central", data: "2026-10-02", total: 40, membroId: dep.json.id });
  assert.equal(saude.status, 201);
  assert.equal(saude.json.categoria, "saude");

  const r = await chamar("GET", "/v1/casa", token);
  assert.equal(r.json.despesasDoAno, 2);
  assert.equal(r.json.deducoes.total, 49.05); // 35% de 123 + 15% de 40
  assert.equal(r.json.prazos.at(-1).data, "2027-06-30");

  // na app anula-se com motivo e deixa de contar
  const an = await chamar("POST", `/v1/casa/despesas/${saude.json.id}/anular`, token, { motivo: "Fatura em duplicado" });
  assert.equal(an.json.anulada, true);
  assert.equal((await chamar("GET", "/v1/casa", token)).json.deducoes.total, 43.05);

  const irs = await chamar("POST", "/v1/casa/servico-irs", token, { tipo: "familia" });
  assert.equal(irs.json.servicoIRS.tipo, "familia");
  await new Promise((ok) => setTimeout(ok, 50));
  assert.ok(emails.some((e) => e.para === "equipa@contabia.test" && e.assunto.includes("Rita Gomes")));
});

test("casa 3. contabilista ligado à família e família da empresa", async () => {
  const cc = await chamar("POST", "/v1/auth/contabilistas", undefined, { email: "sofia@gabinete.pt", nome: "Sofia CC", numeroOCC: "4321", senha: "segredo123" });
  const tcc = cc.json.token;
  // sem ligação, nada se vê
  const fam = (await chamar("GET", "/v1/casa", token)).json.agregado.id;
  assert.equal((await chamar("GET", `/v1/familias/${fam}`, tcc)).status, 403);
  // e-mail e NIF do titular têm de coincidir
  assert.equal((await chamar("POST", "/v1/familias/ligacoes", tcc, { email: "rita@exemplo.pt", nif: "509999999" })).json.codigo, "sem_familia");
  const pedido = await chamar("POST", "/v1/familias/ligacoes", tcc, { email: "rita@exemplo.pt", nif: "123456789" });
  assert.equal(pedido.status, 201);
  assert.equal(pedido.json.estado, "pendente");
  // o contabilista não aceita o próprio pedido; a família aceita
  assert.equal((await chamar("POST", `/v1/familias/ligacoes/${pedido.json.id}/aceitar`, tcc)).status, 409);
  const lig = (await chamar("GET", "/v1/casa/ligacoes", token)).json;
  assert.equal(lig[0].contabilista.nome, "Sofia CC");
  assert.equal((await chamar("POST", `/v1/casa/ligacoes/${lig[0].id}/aceitar`, token)).json.estado, "ativa");
  const carteira = (await chamar("GET", "/v1/familias", tcc)).json;
  assert.equal(carteira.length, 1);
  assert.equal(carteira[0].nome, "Rita Gomes");
  const ds = (await chamar("GET", `/v1/familias/${fam}/despesas`, tcc)).json;
  const geral = ds.find((d: { categoria: string; anulada: boolean }) => d.categoria === "gerais" && !d.anulada);
  assert.equal((await chamar("PUT", `/v1/familias/${fam}/despesas/${geral.id}`, tcc, { categoria: "educacao" })).json.categoria, "educacao");
  // a família termina a ligação e o acesso acaba
  await chamar("POST", `/v1/casa/ligacoes/${lig[0].id}/revogar`, token);
  assert.equal((await chamar("GET", `/v1/familias/${fam}`, tcc)).status, 403);

  // gestor de empresa gere a casa na mesma conta, separada da empresa
  const e = await chamar("POST", "/v1/auth/empresas", undefined, { utilizador: "loja.mar", nif: "509999999", nome: "Loja do Mar, Lda.", senha: "segredo123", regiao: "PT-MA", regimeIVA: "trimestral" });
  const te = e.json.token;
  assert.equal((await chamar("GET", "/v1/casa", te)).json.codigo, "sem_familia");
  const at = await chamar("POST", "/v1/casa/ativar", te, { nome: "João Mar", nif: "123456789" });
  assert.equal(at.status, 201);
  assert.equal(at.json.membros[0].nome, "João Mar");
  const f = await chamar("POST", "/v1/casa/despesas", te, { nifEmitente: "500000000", emitente: "Supermercado", data: "2026-11-01", total: 100 });
  assert.equal(f.status, 201);
  assert.equal((await chamar("GET", "/v1/casa", te)).json.despesasDoAno, 1);
  // a família da empresa convida o contabilista pelo e-mail dele
  const conv = await chamar("POST", "/v1/casa/ligacoes", te, { email: "sofia@gabinete.pt" });
  assert.equal(conv.json.estado, "pendente");
  assert.equal((await chamar("POST", `/v1/familias/ligacoes/${conv.json.id}/aceitar`, tcc)).json.estado, "ativa");
  assert.equal((await chamar("GET", "/v1/familias", tcc)).json.length, 1);
});
