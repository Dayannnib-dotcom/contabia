import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import WebSocket from "ws";
import { abrirDb, type Db } from "../src/db.ts";
import { criarApp } from "../src/app.ts";
import { criarPush, type MensagemPush } from "../src/push.ts";
import { REGRAS_BASE } from "@contabia/shared";

let db: Db;
let app: Awaited<ReturnType<typeof criarApp>>["app"];
let url = "";
const S: Record<string, string> = {};
const enviados: MensagemPush[] = [];
const naoRegistados = new Set<string>();
const enviarFalso = async (m: MensagemPush[]) => { enviados.push(...m); return m.map((x) => (naoRegistados.has(x.to) ? { status: "error" as const, details: { error: "DeviceNotRegistered" } } : { status: "ok" as const })); };

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
  ({ app } = await criarApp(db, { segredoJWT: "teste", tokenAdmin: "admin", agora: () => new Date("2026-11-11T10:00:00Z"), enviarPush: enviarFalso }));
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
  const qr = "A:500000000*B:509999999*C:PT*D:FT*E:N*F:20261110*G:FT 2026/500*H:X-500*I1:PT-MA*I7:10.00*I8:2.20*N:2.20*O:12.20*Q:Ab1C*R:9999";
  // a empresa já não consegue juntar documentos a um mês fechado
  const d = await chamar("POST", `/v1/empresas/${S.empId}/documentos`, S.emp, { qr });
  assert.equal(d.status, 409);
  assert.equal(d.json.codigo, "periodo_fechado");
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
  S.empC = e.json.token; S.empCId = e.json.id; S.ccC = c.json.token;
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

test("15. a empresa só pede a anulação; o contabilista decide; nada se apaga", async () => {
  const base = `/v1/empresas/${S.empCId}/documentos`;
  const doc = { tipo: "compra", terceiroNif: "509999999", terceiroNome: "Fornecedor Y", numero: "FT 2026/77", data: "2026-11-03", base: 100, iva: 23, taxa: 23 };
  // erros "sem querer"
  assert.equal((await chamar("POST", base, S.empC, { ...doc, data: "2026-12-01" })).json.codigo, "data_futura");
  assert.equal((await chamar("POST", base, S.empC, { ...doc, iva: 2.3 })).json.codigo, "iva_incoerente");
  assert.equal((await chamar("POST", base, S.empC, { ...doc, base: -5, iva: 0 })).json.codigo, "valor_negativo");
  const d = await chamar("POST", base, S.empC, doc);
  assert.equal(d.status, 201);
  // a mesma fatura escrita de outra forma é apanhada como repetida
  const rep = await chamar("POST", base, S.empC, { ...doc, numero: "ft2026/77" });
  assert.equal(rep.json.codigo, "documento_duplicado");
  await chamar("POST", `${base}/${d.json.id}/validar`, S.empC, {});
  // a empresa pede a anulação
  const p = await chamar("POST", `${base}/${d.json.id}/anulacao`, S.empC, { motivo: "duplicado" });
  assert.equal(p.json.estado, "anulacao_pedida");
  assert.equal(p.json.anulacao.pedidaPor, "empresa");
  // a empresa não pode aprovar a própria anulação
  assert.equal((await chamar("POST", `${base}/${d.json.id}/anulacao/aprovar`, S.empC, {})).status, 403);
  // o contabilista recusa → volta ao estado anterior
  const r = await chamar("POST", `${base}/${d.json.id}/anulacao/recusar`, S.ccC, {});
  assert.equal(r.json.estado, "validado");
  assert.equal(r.json.anulacao, null);
  // novo pedido, agora aprovado
  await chamar("POST", `${base}/${d.json.id}/anulacao`, S.empC, { motivo: "valores_errados", detalhe: "valor 1000 em vez de 100" });
  const ok = await chamar("POST", `${base}/${d.json.id}/anulacao/aprovar`, S.ccC, {});
  assert.equal(ok.json.estado, "anulado");
  // o documento continua guardado e o lançamento proposto deixou de contar
  const lista = (await chamar("GET", base, S.empC)).json;
  assert.equal(lista.find((x: { id: string }) => x.id === d.json.id).estado, "anulado");
  const propostos = (await chamar("GET", `/v1/empresas/${S.empCId}/lancamentos?estado=proposto`, S.ccC)).json;
  assert.equal(propostos.length, 0);
  // depois de anulado, a fatura correta já pode ser registada
  assert.equal((await chamar("POST", base, S.empC, { ...doc, base: 1000, iva: 230 })).status, 201);
  // não existe nenhuma forma de apagar documentos pela API
  assert.equal((await chamar("DELETE", `${base}/${d.json.id}`, S.empC)).status, 404);
});

test("16. sessão deslizante: quem usa a app recebe um token renovado", async () => {
  const { SignJWT } = await import("jose");
  const antigo = await new SignJWT({ papel: "empresa", nome: "Empresa C" }).setProtectedHeader({ alg: "HS256" })
    .setSubject(S.empCId).setIssuedAt(Math.floor(Date.now() / 1000) - 10 * 86400).setExpirationTime("20d").sign(new TextEncoder().encode("teste"));
  const r = await app.inject({ method: "GET", url: "/v1/auth/eu", headers: { authorization: `Bearer ${antigo}` } });
  assert.equal(r.statusCode, 200);
  const novo = r.headers["x-contabia-token"];
  assert.ok(typeof novo === "string" && novo !== antigo);
  const r2 = await app.inject({ method: "GET", url: "/v1/auth/eu", headers: { authorization: `Bearer ${novo}` } });
  assert.equal(r2.statusCode, 200);
  assert.equal(r2.headers["x-contabia-token"], undefined);
});

test("17. arquivo digital: foto/PDF de cada fatura guardado na nuvem", async () => {
  const base = `/v1/empresas/${S.empCId}/documentos`;
  const d = await chamar("POST", base, S.empC, { tipo: "compra", terceiroNif: "509999999", terceiroNome: "Fornecedor Z", numero: "FT 2026/90", data: "2026-11-05", base: 50, iva: 11.5, taxa: 23 });
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
  const env = (corpo: Buffer, tipo: string, token = S.empC) => app.inject({ method: "POST", url: `${base}/${d.json.id}/anexos`, headers: { authorization: `Bearer ${token}`, "content-type": tipo }, payload: corpo });
  // um ficheiro que diz ser PDF mas não é → recusado
  assert.equal((await env(Buffer.from("olá"), "application/pdf")).statusCode, 400);
  const r = await env(pdf, "application/pdf");
  assert.equal(r.statusCode, 201, r.body);
  const a = JSON.parse(r.body);
  assert.equal(a.nome, "FT_2026_90.pdf");
  // o mesmo ficheiro outra vez não duplica
  assert.equal(JSON.parse((await env(pdf, "application/pdf")).body).id, a.id);
  // o contabilista também vê e descarrega o original
  const lista = (await chamar("GET", `${base}/${d.json.id}/anexos`, S.ccC)).json;
  assert.equal(lista.length, 1);
  const f = await app.inject({ method: "GET", url: `${base}/${d.json.id}/anexos/${a.id}?token=${S.ccC}` });
  assert.equal(f.statusCode, 200);
  assert.equal(f.headers["content-type"], "application/pdf");
  assert.equal(f.rawPayload.toString(), pdf.toString());
  const docs = (await chamar("GET", base, S.empC)).json;
  assert.equal(docs.find((x: { id: string }) => x.id === d.json.id).anexos, 1);
});

test("18. importação do e-Fatura: importa, salta repetidas e explica erros", async () => {
  const url = `/v1/empresas/${S.empCId}/documentos/importar`;
  const linhas = [
    { nif: "500000000", nome: "Papelaria", numero: "FT 2026/700", atcud: "JFG3-700", data: "2026-10-15", base: 100, iva: 23, total: 123 },
    { nif: "509999999", nome: "Restaurante", numero: "FS 9/1", atcud: "", data: "2026-10-16", base: 20, iva: 2.6, total: 22.6 },
    { nif: "500000000", nome: "Papelaria", numero: "FT 2026/701", atcud: "", data: "2027-01-01", base: 10, iva: 2.3, total: 12.3 },
  ];
  const r = await chamar("POST", url, S.empC, { linhas });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.importados, 2);
  assert.equal(r.json.erros, 1);
  assert.match(r.json.resultados[2].mensagem, /ainda não chegou/);
  // importar o mesmo ficheiro outra vez não duplica nada
  const r2 = await chamar("POST", url, S.empC, { linhas: linhas.slice(0, 2) });
  assert.equal(r2.json.repetidos, 2);
  const docs = (await chamar("GET", `/v1/empresas/${S.empCId}/documentos`, S.empC)).json;
  const rest = docs.find((d: { numero: string }) => d.numero === "FS 9/1");
  assert.equal(rest.taxa, 13); // 2,60 / 20 = 13 % (taxa intermédia)
  assert.equal(rest.origem, "efatura");
});

test("19. conciliação bancária: sugere com explicação, concilia, pede a fatura em falta", async () => {
  const id = S.empCId;
  // faturas já existentes da Empresa C: FT 2026/700 (123 €, Papelaria 500000000, 15/10) e FS 9/1 (22,60 €, 16/10)
  const imp = await chamar("POST", `/v1/empresas/${id}/banco/importar`, S.empC, { movimentos: [
    { data: "2026-10-20", descricao: "COMPRA PAPELARIA FUNCHAL", valor: -123 },
    { data: "2026-10-16", descricao: "COMPRA RESTAUR 4421", valor: -22.6 },
    { data: "2026-10-21", descricao: "DD EDP COMERCIAL", valor: -45.3 },
    { data: "2026-10-22", descricao: "TRF RECEBIDA", valor: 500 },
  ] });
  assert.equal(imp.json.novos, 4);
  // importar o mesmo extrato outra vez não duplica
  assert.equal((await chamar("POST", `/v1/empresas/${id}/banco/importar`, S.empC, { movimentos: [{ data: "2026-10-21", descricao: "DD EDP COMERCIAL", valor: -45.3 }] })).json.novos, 0);
  const ms = (await chamar("GET", `/v1/empresas/${id}/banco/movimentos`, S.ccC)).json;
  const pap = ms.find((m: { descricao: string }) => m.descricao.includes("PAPELARIA"));
  assert.equal(pap.sugestao.numero, "FT 2026/700");
  assert.equal(pap.sugestao.confianca, "alta");
  assert.match(pap.sugestao.motivo, /mesmo valor \(123,00 €\), 5 dias depois da fatura, a descrição menciona «PAPELARIA»/);
  const rest = ms.find((m: { descricao: string }) => m.descricao.includes("RESTAUR"));
  assert.equal(rest.sugestao.confianca, "media"); // só valor e data: um humano confirma
  // a empresa não pode conciliar automaticamente; o contabilista sim
  assert.equal((await chamar("POST", `/v1/empresas/${id}/banco/conciliar-automatico`, S.empC, {})).status, 403);
  assert.equal((await chamar("POST", `/v1/empresas/${id}/banco/conciliar-automatico`, S.ccC, {})).json.conciliados, 1);
  // confirmar a sugestão média
  const c = await chamar("POST", `/v1/empresas/${id}/banco/movimentos/${rest.id}/conciliar`, S.ccC, { documentoId: rest.sugestao.documentoId });
  assert.equal(c.json.estado, "conciliado");
  // a mesma fatura não pode ficar ligada a dois movimentos
  const edp = ms.find((m: { descricao: string }) => m.descricao.includes("EDP"));
  assert.equal((await chamar("POST", `/v1/empresas/${id}/banco/movimentos/${edp.id}/conciliar`, S.ccC, { documentoId: rest.sugestao.documentoId })).json.codigo, "ja_conciliado");
  // pagamento sem fatura → pedido à empresa
  const p = await chamar("POST", `/v1/empresas/${id}/banco/movimentos/${edp.id}/pedir-fatura`, S.ccC, {});
  assert.equal(p.json.estado, "falta_documento");
  const pedidos = (await chamar("GET", `/v1/empresas/${id}/pedidos`, S.empC)).json;
  assert.ok(pedidos.some((x: { tipo: string; detalhe: string }) => x.tipo === "Fatura em falta (banco)" && x.detalhe.includes("EDP")));
});

test("20. vários utilizadores: o gestor adiciona e desativa; o colaborador faz o dia a dia; tudo fica registado", async () => {
  const id = S.empCId;
  // só o gestor da própria empresa gere utilizadores
  assert.equal((await chamar("POST", `/v1/empresas/${id}/colaboradores`, S.ccC, { nome: "X", email: "x@x.pt", senha: "segredo123" })).status, 403);
  const c = await chamar("POST", `/v1/empresas/${id}/colaboradores`, S.empC, { nome: "Marta Sousa", email: "Marta@EmpresaC.pt", senha: "segredo123" });
  assert.equal(c.status, 201, JSON.stringify(c.json));
  assert.equal((await chamar("POST", `/v1/empresas/${id}/colaboradores`, S.empC, { nome: "Outra", email: "marta@empresac.pt", senha: "segredo123" })).json.codigo, "email_existe");
  // a colaboradora entra com o próprio e-mail
  const s = await chamar("POST", "/v1/auth/sessoes", undefined, { papel: "empresa", identificador: "marta@empresac.pt", senha: "segredo123" });
  assert.equal(s.json.perfil, "colaborador");
  assert.equal(s.json.quem, "Marta Sousa");
  assert.equal(s.json.id, id);
  const marta = s.json.token;
  // faz o dia a dia: regista documentos
  const d = await chamar("POST", `/v1/empresas/${id}/documentos`, marta, { tipo: "compra", terceiroNif: "500000000", terceiroNome: "Papelaria", numero: "FT 2026/800", data: "2026-11-06", base: 10, iva: 2.3, taxa: 23 });
  assert.equal(d.status, 201);
  // mas não mexe na ligação ao contabilista, nem no banco, nem nos utilizadores
  assert.equal((await chamar("POST", "/v1/ligacoes", marta, { contabilista: "777" })).json.codigo, "so_gestor");
  assert.equal((await chamar("POST", `/v1/empresas/${id}/banco/importar`, marta, { movimentos: [{ data: "2026-11-01", descricao: "X", valor: -1 }] })).json.codigo, "so_gestor");
  assert.equal((await chamar("GET", `/v1/empresas/${id}/colaboradores`, marta)).status, 403);
  // o registo diz quem fez o quê
  const reg = (await chamar("GET", `/v1/empresas/${id}/atividade`, S.empC)).json;
  assert.equal(reg[0].quem, "Marta Sousa");
  assert.equal(reg[0].acao, "registou um documento");
  assert.ok(reg.some((x: { acao: string }) => x.acao === "adicionou um utilizador"));
  assert.ok(reg.some((x: { quem: string }) => x.quem === "Rui CC (contabilista)"));
  // o gestor desativa: a sessão da Marta acaba logo, em todos os dispositivos
  await chamar("POST", `/v1/empresas/${id}/colaboradores/${c.json.id}/desativar`, S.empC, {});
  assert.equal((await chamar("GET", `/v1/empresas/${id}/documentos`, marta)).status, 401);
  assert.equal((await chamar("POST", "/v1/auth/sessoes", undefined, { papel: "empresa", identificador: "marta@empresac.pt", senha: "segredo123" })).json.codigo, "desativado");
});

test("21. regras por fornecedor: o contabilista define; a conta vem certa e pode lançar sozinho", async () => {
  const id = S.empCId;
  const url = `/v1/empresas/${id}/regras-fornecedor/509999999`;
  // só o contabilista define regras
  assert.equal((await chamar("PUT", url, S.empC, { nome: "Combustíveis SA", conta: "62421", ivaDedutivel: false, autoLancar: true })).status, 403);
  assert.equal((await chamar("PUT", url, S.ccC, { nome: "Combustíveis SA", conta: "72", ivaDedutivel: false })).json.codigo, "conta_invalida");
  const r = await chamar("PUT", url, S.ccC, { nome: "Combustíveis SA", conta: "62421", ivaDedutivel: false, autoLancar: true });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  // a empresa regista e valida uma fatura deste fornecedor, mesmo escolhendo outra conta
  const d = await chamar("POST", `/v1/empresas/${id}/documentos`, S.empC, { tipo: "compra", terceiroNif: "509999999", terceiroNome: "Combustíveis SA", numero: "FT G/55", data: "2026-11-07", base: 40, iva: 9.2, taxa: 23 });
  assert.equal(d.json.contaSugerida, "62421");
  assert.equal(d.json.confianca ?? "alta", "alta");
  const v = await chamar("POST", `/v1/empresas/${id}/documentos/${d.json.id}/validar`, S.empC, { contaSugerida: "6268" });
  assert.equal(v.json.contaSugerida, "62421"); // a regra manda
  assert.equal(v.json.ivaDedutivel, false);
  // lançado sozinho, sem passar pela revisão
  const lancados = (await chamar("GET", `/v1/empresas/${id}/lancamentos?estado=lancado`, S.ccC)).json;
  const l = lancados.find((x: { documentoId: string }) => x.documentoId === d.json.id);
  assert.ok(l, "devia estar lançado");
  assert.equal(l.linhas[0].conta, "62421");
  assert.equal((await chamar("GET", `/v1/empresas/${id}/regras-fornecedor`, S.empC)).json[0].autoLancar, true);
});

test("22. avisos push: eventos para o outro lado e prazos sem repetir", async () => {
  const id = S.empCId;
  const tEmp = "ExponentPushToken[empresa-c]";
  const tCC = "ExponentPushToken[rui-cc]";
  assert.equal((await chamar("POST", "/v1/dispositivos", S.empC, { token: "lixo", plataforma: "ios" })).status, 400);
  await chamar("POST", "/v1/dispositivos", S.empC, { token: tEmp, plataforma: "android" });
  await chamar("POST", "/v1/dispositivos", S.ccC, { token: tCC, plataforma: "ios" });
  enviados.length = 0;
  // o contabilista pede um documento → aviso no telemóvel da empresa
  await chamar("POST", `/v1/empresas/${id}/pedidos`, S.ccC, { tipo: "Extrato bancário", detalhe: "novembro" });
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(enviados.some((m) => m.to === tEmp && m.title === "O seu contabilista pede um documento" && m.body.includes("novembro")), JSON.stringify(enviados));
  assert.ok(!enviados.some((m) => m.to === tCC));
  // a empresa pede uma anulação → aviso no telemóvel do contabilista
  enviados.length = 0;
  const d = await chamar("POST", `/v1/empresas/${id}/documentos`, S.empC, { tipo: "compra", terceiroNif: "500000000", terceiroNome: "Papelaria", numero: "FT 2026/900", data: "2026-11-08", base: 10, iva: 2.3, taxa: 23 });
  await chamar("POST", `/v1/empresas/${id}/documentos/${d.json.id}/anulacao`, S.empC, { motivo: "duplicado" });
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(enviados.some((m) => m.to === tCC && m.title === "Pedido de anulação"));
  // prazos: a 7 dias do dia 20 avisa a empresa e o contabilista, uma só vez
  const push = criarPush(db, enviarFalso);
  enviados.length = 0;
  await push.avisarPrazos("2026-11-13", REGRAS_BASE);
  assert.ok(enviados.some((m) => m.to === tEmp && m.title.startsWith("Faltam 7 dias")), JSON.stringify(enviados.map((m) => m.title)));
  assert.ok(enviados.some((m) => m.to === tCC && m.body.startsWith("Empresa C:")));
  enviados.length = 0;
  await push.avisarPrazos("2026-11-13", REGRAS_BASE);
  assert.equal(enviados.filter((m) => m.to === tEmp).length, 0, "não repete");
  // aparelho que já não existe deixa de receber
  naoRegistados.add(tEmp);
  await push.avisar({ empresaId: id }, "teste", "x");
  enviados.length = 0;
  await push.avisar({ empresaId: id }, "teste", "x");
  assert.equal(enviados.filter((m) => m.to === tEmp).length, 0);
  // rota de administração (para um cron externo)
  assert.equal((await chamar("POST", "/v1/admin/avisos-prazos", S.empC, {})).status, 403);
  assert.equal((await chamar("POST", "/v1/admin/avisos-prazos", undefined, {}, { "x-admin-token": "admin" })).status, 200);
});
