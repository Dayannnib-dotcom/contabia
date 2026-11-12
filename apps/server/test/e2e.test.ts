import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import WebSocket from "ws";
import { abrirDb, type Db } from "../src/db.ts";
import { criarApp } from "../src/app.ts";
import { REGRAS_BASE } from "@contabia/shared";

let db: Db;
let app: Awaited<ReturnType<typeof criarApp>>["app"];
let url = "";
const S: Record<string, string> = {};

async function chamar(metodo: string, caminho: string, token?: string, corpo?: unknown, extra: Record<string, string> = {}) {
  const r = await app.inject({
    method: metodo as "GET",
    url: caminho,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(corpo !== undefined ? { "content-type": "application/json" } : {}), ...extra },
    payload: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  return { status: r.statusCode, json: r.body ? JSON.parse(r.body) : null };
}

before(async () => {
  db = await abrirDb(process.env.TEST_DATABASE_URL);
  ({ app } = await criarApp(db, { segredoJWT: "teste", tokenAdmin: "admin", agora: () => new Date("2026-11-11T10:00:00Z") }));
  url = await app.listen({ port: 0, host: "127.0.0.1" });
});
after(async () => {
  await app.close();
  await db.fechar();
});

test("1. registo e sessão", async () => {
  const e = await chamar("POST", "/v1/auth/empresas", undefined, { utilizador: "Empresa.A", nif: "509 999 999", nome: "Empresa A, Lda.", senha: "segredo123", regiao: "PT-MA", regimeIVA: "trimestral" });
  assert.equal(e.status, 201);
  S.emp = e.json.token; S.empId = e.json.id;
  const dup = await chamar("POST", "/v1/auth/empresas", undefined, { utilizador: "empresa.a", nif: "509999999", nome: "Outra", senha: "segredo123", regiao: "PT", regimeIVA: "mensal" });
  assert.equal(dup.json.codigo, "utilizador_existe");
  const nifRepetido = await chamar("POST", "/v1/auth/empresas", undefined, { utilizador: "outra.empresa", nif: "509999999", nome: "Outra", senha: "segredo123", regiao: "PT", regimeIVA: "mensal" });
  assert.equal(nifRepetido.json.codigo, "nif_existe");
  const nifMau = await chamar("POST", "/v1/auth/empresas", undefined, { utilizador: "empresa.b", nif: "509999998", nome: "Empresa B", senha: "segredo123", regiao: "PT", regimeIVA: "mensal" });
  assert.equal(nifMau.json.codigo, "nif_invalido");
  const c = await chamar("POST", "/v1/auth/contabilistas", undefined, { email: "cc@exemplo.pt", nome: "Ana CC", numeroOCC: "12345", senha: "segredo123" });
  S.cc = c.json.token; S.ccId = c.json.id;
  const login = await chamar("POST", "/v1/auth/sessoes", undefined, { papel: "empresa", identificador: "empresa.a", senha: "segredo123" });
  assert.equal(login.status, 200);
  const mau = await chamar("POST", "/v1/auth/sessoes", undefined, { papel: "contabilista", identificador: "cc@exemplo.pt", senha: "errada123" });
  assert.equal(mau.status, 401);
});

test("2. ligação em duas vias com utilizador + NIF", async () => {
  assert.equal((await chamar("POST", "/v1/ligacoes", S.cc, { utilizador: "empresa.a", nif: "500000000" })).json.codigo, "dados_nao_coincidem");
  assert.equal((await chamar("POST", "/v1/ligacoes", S.cc, { utilizador: "empresa.a", nif: "123" })).json.codigo, "nif_invalido");
  assert.equal((await chamar("POST", "/v1/ligacoes", S.emp, { utilizador: "empresa.a", nif: "509999999" })).status, 400);
  const p = await chamar("POST", "/v1/ligacoes", S.cc, { utilizador: "empresa.a", nif: "509999999" });
  assert.equal(p.status, 201);
  assert.equal(p.json.estado, "pendente");
  assert.equal((await chamar("GET", `/v1/empresas/${S.empId}/documentos`, S.cc)).status, 403);
  const lista = await chamar("GET", "/v1/ligacoes", S.emp);
  assert.equal(lista.json[0].contabilista.nome, "Ana CC");
  assert.equal((await chamar("POST", `/v1/ligacoes/${p.json.id}/aceitar`, S.cc, { versao: 1 })).status, 403);
  assert.equal(p.json.iniciadaPor, "contabilista");
  const ok = await chamar("POST", `/v1/ligacoes/${p.json.id}/aceitar`, S.emp, { versao: 1 });
  assert.equal(ok.json.estado, "ativa");
  S.lig = p.json.id;
  const cart = await chamar("GET", "/v1/carteira", S.cc);
  assert.equal(cart.json.length, 1);
  assert.equal(cart.json[0].empresa.nif, "509999999");
});

test("3. documentos pelo código QR, classificação e duplicados", async () => {
  const qr = "A:500000000*B:509999999*C:PT*D:FT*E:N*F:20261110*G:FT 2026/418*H:ABCD1234-418*I1:PT-MA*I7:120.00*I8:26.40*N:26.40*O:146.40*Q:Ab1C*R:9999";
  const d = await chamar("POST", `/v1/empresas/${S.empId}/documentos`, S.emp, { qr, tipo: "compra", terceiroNome: "Papelaria Atlântico" });
  assert.equal(d.status, 201);
  assert.equal(d.json.taxa, 22);
  assert.equal(d.json.contaSugerida, "6233");
  S.doc = d.json.id;
  assert.equal((await chamar("POST", `/v1/empresas/${S.empId}/documentos`, S.emp, { qr, tipo: "compra" })).json.codigo, "documento_duplicado");
  const outro = qr.replace("B:509999999", "B:500000000").replace("G:FT 2026/418", "G:FT 2026/419");
  assert.equal((await chamar("POST", `/v1/empresas/${S.empId}/documentos`, S.emp, { qr: outro })).json.codigo, "nif_adquirente");
  const v = await chamar("POST", `/v1/empresas/${S.empId}/documentos`, S.emp, { tipo: "venda", terceiroNif: "500000000", terceiroNome: "Cliente Funchal", numero: "FR A/112", data: "2026-11-05", base: 1000, iva: 220, taxa: 22 });
  assert.equal(v.status, 201);
  S.venda = v.json.id;
});

test("4. validação gera lançamento; o contabilista aprova; IVA apurado por campos", async () => {
  await chamar("POST", `/v1/empresas/${S.empId}/documentos/${S.doc}/validar`, S.emp, {});
  await chamar("POST", `/v1/empresas/${S.empId}/documentos/${S.venda}/validar`, S.emp, {});
  const props = await chamar("GET", `/v1/empresas/${S.empId}/lancamentos?estado=proposto`, S.cc);
  assert.equal(props.json.length, 2);
  const pend = await chamar("GET", `/v1/empresas/${S.empId}/iva/2026T4`, S.cc);
  assert.equal(pend.json.lancamentosPendentes, 2);
  assert.equal((await chamar("POST", `/v1/empresas/${S.empId}/iva/2026T4/ficheiro`, S.cc, {})).json.codigo, "lancamentos_pendentes");
  const compra = props.json.find((l: { documentoId: string }) => l.documentoId === S.doc);
  assert.equal((await chamar("POST", `/v1/empresas/${S.empId}/lancamentos/${compra.id}/aprovar`, S.emp, { versao: 1 })).status, 403);
  const a1 = await chamar("POST", `/v1/empresas/${S.empId}/lancamentos/${compra.id}/aprovar`, S.cc, { versao: 1 });
  assert.equal(a1.json.estado, "lancado");
  assert.equal((await chamar("POST", `/v1/empresas/${S.empId}/lancamentos/${compra.id}/aprovar`, S.cc, { versao: 1 })).status, 409);
  const alta = await chamar("POST", `/v1/empresas/${S.empId}/lancamentos/aprovar-confianca-alta`, S.cc, {});
  assert.equal(alta.json.aprovados, 1);
  const ap = await chamar("GET", `/v1/empresas/${S.empId}/iva/2026T4`, S.cc);
  const campo = (n: string) => ap.json.campos.find((c: { campo: string }) => c.campo === n)?.valor;
  assert.equal(campo("3"), 1000);
  assert.equal(campo("4"), 220);
  assert.equal(campo("24"), 26.4);
  assert.deepEqual(ap.json.resultado, { campo: "93", descricao: "Imposto a favor do Estado", valor: 193.6 });
});

test("5. ficheiro da declaração e registo da submissão", async () => {
  const f = await chamar("POST", `/v1/empresas/${S.empId}/iva/2026T4/ficheiro`, S.cc, {});
  assert.match(f.json.xml, /<Campo numero="93">193.60<\/Campo>/);
  const s = await chamar("POST", `/v1/empresas/${S.empId}/iva/2026T4/submissao`, S.cc, { comprovativo: "AT-123456" });
  assert.equal(s.status, 201);
  assert.equal((await chamar("POST", `/v1/empresas/${S.empId}/iva/2026T4/submissao`, S.cc, { comprovativo: "AT-1" })).json.codigo, "ja_submetida");
});

test("6. pedidos com idempotência e tempo real por WebSocket", async () => {
  const ws = new WebSocket(`${url.replace("http", "ws")}/v1/tempo-real?token=${S.emp}`);
  const recebidos: { tipo: string }[] = [];
  await new Promise<void>((ok) => ws.on("message", (m) => { const j = JSON.parse(String(m)); recebidos.push(j); if (j.tipo === "ligado") ok(); }));
  const extra = { "idempotency-key": "pedido-1" };
  const p1 = await chamar("POST", `/v1/empresas/${S.empId}/pedidos`, S.cc, { tipo: "Extrato bancário", detalhe: "outubro" }, extra);
  const p2 = await chamar("POST", `/v1/empresas/${S.empId}/pedidos`, S.cc, { tipo: "Extrato bancário", detalhe: "outubro" }, extra);
  assert.equal(p1.json.id, p2.json.id);
  assert.equal((await chamar("GET", `/v1/empresas/${S.empId}/pedidos`, S.emp)).json.length, 1);
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(recebidos.some((e) => e.tipo === "pedido.criado"));
  ws.close();
  const rec = await chamar("POST", `/v1/empresas/${S.empId}/pedidos/${p1.json.id}/recebido`, S.emp, {});
  assert.equal(rec.json.estado, "recebido");
});

test("7. fecho de período bloqueia alterações", async () => {
  const v = await chamar("GET", `/v1/empresas/${S.empId}/periodos/2026-11`, S.cc);
  assert.equal(v.json.podeFechar, true);
  const f = await chamar("POST", `/v1/empresas/${S.empId}/periodos/2026-11/fechar`, S.cc, {});
  assert.equal(f.json.fechado, true);
  const qr = "A:500000000*B:509999999*C:PT*D:FT*E:N*F:20261112*G:FT 2026/500*H:X-500*I1:PT-MA*I7:10.00*I8:2.20*N:2.20*O:12.20*Q:Ab1C*R:9999";
  const d = await chamar("POST", `/v1/empresas/${S.empId}/documentos`, S.emp, { qr });
  await chamar("POST", `/v1/empresas/${S.empId}/documentos/${d.json.id}/validar`, S.emp, {});
  const [l] = (await chamar("GET", `/v1/empresas/${S.empId}/lancamentos?estado=proposto`, S.cc)).json;
  assert.equal(l.confianca, "alta"); // fornecedor já conhecido
  assert.equal((await chamar("POST", `/v1/empresas/${S.empId}/lancamentos/${l.id}/aprovar`, S.cc, { versao: 1 })).json.codigo, "periodo_fechado");
});

test("8. SAF-T da contabilidade 1.04_01", async () => {
  const r = await chamar("POST", `/v1/empresas/${S.empId}/saft/2026`, S.cc, {});
  assert.match(r.json.xml, /<AuditFileVersion>1.04_01<\/AuditFileVersion>/);
  assert.match(r.json.xml, /<TotalDebit>1366.40<\/TotalDebit>/);
  assert.match(r.json.xml, /<TotalCredit>1366.40<\/TotalCredit>/);
  assert.ok(r.json.avisos.some((a: string) => a.includes("taxonomia")));
});

test("9. sincronização por cursor, assistente, prazos e regras", async () => {
  const s1 = await chamar("GET", `/v1/empresas/${S.empId}/sync?desde=0`, S.emp);
  assert.ok(s1.json.eventos.length > 5);
  const s2 = await chamar("GET", `/v1/empresas/${S.empId}/sync?desde=${s1.json.cursor}`, S.emp);
  assert.equal(s2.json.eventos.length, 0);
  const r = await chamar("POST", `/v1/empresas/${S.empId}/assistente`, S.emp, { pergunta: "Posso deduzir o IVA de um almoço com um cliente?" });
  assert.deepEqual(r.json.fontes, ["CIVA, art. 21.º"]);
  const pz = await chamar("GET", `/v1/empresas/${S.empId}/prazos`, S.emp);
  assert.equal(pz.json[0].codigo, "dp_iva");
  assert.equal(pz.json[0].prazo, "2026-11-20");
  assert.equal((await chamar("POST", "/v1/admin/regras", undefined, { ...REGRAS_BASE, versao: "2027.01" }, { "x-admin-token": "admin" })).status, 201);
  assert.equal((await chamar("GET", "/v1/regras", S.emp)).json.versao, "2027.01");
});

test("10. revogação corta o acesso", async () => {
  const [l] = (await chamar("GET", "/v1/ligacoes", S.emp)).json;
  assert.equal((await chamar("DELETE", `/v1/ligacoes/${S.lig}`, S.emp, { versao: l.versao })).json.estado, "revogada");
  assert.equal((await chamar("GET", `/v1/empresas/${S.empId}/documentos`, S.cc)).status, 403);
});

test("11. a empresa também convida o contabilista; aceita sempre o outro lado", async () => {
  const e = await chamar("POST", "/v1/auth/empresas", undefined, { utilizador: "empresa.c", nif: "500000000", nome: "Empresa C", senha: "segredo123", regiao: "PT", regimeIVA: "mensal" });
  const c = await chamar("POST", "/v1/auth/contabilistas", undefined, { email: "rui@gabinete.pt", nome: "Rui CC", numeroOCC: "777", senha: "segredo123" });
  assert.equal((await chamar("POST", "/v1/ligacoes", e.json.token, { contabilista: "ninguem@x.pt" })).json.codigo, "contabilista_nao_encontrado");
  const conv = await chamar("POST", "/v1/ligacoes", e.json.token, { contabilista: "777" });
  assert.equal(conv.status, 201);
  assert.equal(conv.json.iniciadaPor, "empresa");
  assert.equal(conv.json.contabilista.nome, "Rui CC");
  // quem convidou não pode aceitar o próprio convite
  assert.equal((await chamar("POST", `/v1/ligacoes/${conv.json.id}/aceitar`, e.json.token, { versao: 1 })).status, 403);
  // o contabilista vê o convite e aceita
  const lista = await chamar("GET", "/v1/ligacoes", c.json.token);
  assert.equal(lista.json[0].empresa.nome, "Empresa C");
  const ok = await chamar("POST", `/v1/ligacoes/${conv.json.id}/aceitar`, c.json.token, { versao: 1 });
  assert.equal(ok.json.estado, "ativa");
  assert.equal((await chamar("GET", "/v1/carteira", c.json.token)).json.length, 1);
  // convite repetido com e-mail devolve a ligação já ativa
  assert.equal((await chamar("POST", "/v1/ligacoes", e.json.token, { contabilista: "RUI@gabinete.pt" })).json.estado, "ativa");
});

test("12. convites cruzados ficam ativos logo (os dois lados consentiram)", async () => {
  const e = await chamar("POST", "/v1/auth/empresas", undefined, { utilizador: "empresa.d", nif: "509999980", nome: "Empresa D", senha: "segredo123", regiao: "PT-AC", regimeIVA: "mensal" });
  assert.equal(e.status, 201, JSON.stringify(e.json));
  const c = await chamar("POST", "/v1/auth/contabilistas", undefined, { email: "eva@gabinete.pt", nome: "Eva CC", numeroOCC: "888", senha: "segredo123" });
  const a = await chamar("POST", "/v1/ligacoes", e.json.token, { contabilista: "eva@gabinete.pt" });
  assert.equal(a.json.estado, "pendente");
  const b = await chamar("POST", "/v1/ligacoes", c.json.token, { utilizador: "empresa.d", nif: "509999980" });
  assert.equal(b.json.estado, "ativa");
  // recusa só se aplica a pendentes
  assert.equal((await chamar("POST", `/v1/ligacoes/${a.json.id}/recusar`, c.json.token, { versao: b.json.versao })).status, 409);
});

test("13. revogar corta também o tempo real do contabilista", async () => {
  const e = await chamar("POST", "/v1/auth/empresas", undefined, { utilizador: "empresa.e", nif: "509999972", nome: "Empresa E", senha: "segredo123", regiao: "PT", regimeIVA: "mensal" });
  assert.equal(e.status, 201, JSON.stringify(e.json));
  const c = await chamar("POST", "/v1/auth/contabilistas", undefined, { email: "teo@gabinete.pt", nome: "Teo CC", numeroOCC: "999", senha: "segredo123" });
  const l = await chamar("POST", "/v1/ligacoes", c.json.token, { utilizador: "empresa.e", nif: "509999972" });
  const ativa = await chamar("POST", `/v1/ligacoes/${l.json.id}/aceitar`, e.json.token, { versao: 1 });
  const ws = new WebSocket(`${url.replace("http", "ws")}/v1/tempo-real?token=${c.json.token}`);
  const tipos: string[] = [];
  await new Promise<void>((ok) => ws.on("message", (m) => { const j = JSON.parse(String(m)); tipos.push(j.tipo); if (j.tipo === "ligado") ok(); }));
  await chamar("POST", `/v1/empresas/${e.json.id}/documentos`, e.json.token, { tipo: "compra", terceiroNif: "500000000", terceiroNome: "X", numero: "FT 1", data: "2026-11-01", base: 10, iva: 2.3, taxa: 23 });
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(tipos.includes("documento.criado"));
  await chamar("DELETE", `/v1/ligacoes/${l.json.id}`, e.json.token, { versao: ativa.json.versao });
  tipos.length = 0;
  await chamar("POST", `/v1/empresas/${e.json.id}/documentos`, e.json.token, { tipo: "compra", terceiroNif: "500000000", terceiroNome: "X", numero: "FT 2", data: "2026-11-01", base: 10, iva: 2.3, taxa: 23 });
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(!tipos.includes("documento.criado"), tipos.join());
  ws.close();
});

test("14. sessão de uma conta que já não existe termina com 401", async () => {
  const e = await chamar("POST", "/v1/auth/empresas", undefined, { utilizador: "empresa.f", nif: "509999964", nome: "Empresa F", senha: "segredo123", regiao: "PT", regimeIVA: "mensal" });
  assert.equal(e.status, 201, JSON.stringify(e.json));
  await db.query(`DELETE FROM empresas WHERE id = $1`, [e.json.id]);
  const r = await chamar("GET", "/v1/auth/eu", e.json.token);
  assert.equal(r.status, 401);
  assert.equal(r.json.codigo, "sessao_invalida");
});
