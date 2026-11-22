/**
 * Teste de robustez: chama TODAS as rotas da API com dados errados (vazios, tipos trocados,
 * textos enormes, ids estranhos) com as sessões de empresa, contabilista e família.
 * Nenhuma resposta pode ser 5xx: um erro do utilizador tem de dar uma mensagem, nunca partir.
 * Uso: npx tsx test/fuzz.ts
 */
import { abrirDb } from "../src/db.ts";
import { criarApp } from "../src/app.ts";

const db = await abrirDb(undefined);
const rotas: { method: string; url: string }[] = [];
const { app } = await criarApp(db, {
  segredoJWT: "fuzz", tokenAdmin: "admin", agora: () => new Date("2026-11-22T10:00:00Z"),
  enviarEmail: async () => true, enviarPush: async () => [], emailEstudos: "e@x.pt",
});
await app.ready();

const chamar = async (method: string, url: string, tk?: string, corpo?: unknown, bruto?: string) => {
  const r = await app.inject({
    method: method as "GET", url,
    headers: { ...(tk ? { authorization: `Bearer ${tk}` } : {}), ...(corpo !== undefined || bruto !== undefined ? { "content-type": "application/json" } : {}) },
    payload: bruto ?? (corpo === undefined ? undefined : JSON.stringify(corpo)),
  });
  return { status: r.statusCode, json: (() => { try { return JSON.parse(r.body); } catch { return r.body; } })() };
};

// sessões reais
const emp = (await chamar("POST", "/v1/auth/empresas", undefined, { utilizador: "fuzz.lda", nif: "509999999", nome: "Fuzz, Lda.", senha: "segredo123", regiao: "PT", regimeIVA: "trimestral" })).json;
const cc = (await chamar("POST", "/v1/auth/contabilistas", undefined, { email: "fuzz@cc.pt", nome: "Fuzz CC", numeroOCC: "11111", senha: "segredo123" })).json;
const casa = (await chamar("POST", "/v1/auth/casas", undefined, { nome: "Fuzz Casa", email: "fuzz@casa.pt", nif: "123456789", senha: "segredo123" })).json;
const lig = (await chamar("POST", "/v1/ligacoes", cc.token, { utilizador: "fuzz.lda", nif: "509999999" })).json;
await chamar("POST", `/v1/ligacoes/${lig.id}/aceitar`, emp.token, { versao: 1 });
const doc = (await chamar("POST", `/v1/empresas/${emp.id}/documentos`, emp.token, { tipo: "compra", terceiroNif: "500000000", terceiroNome: "P", numero: "FT 1/1", data: "2026-09-15", base: 100, iva: 23, taxa: 23 })).json;

// rotas registadas (Fastify guarda-as na árvore do router; usamos o texto do printRoutes)
const texto = app.printRoutes({ commonPrefix: false });
let prefixo: string[] = [];
for (const l of texto.split("\n")) {
  const m = /^([│ ]*)[├└]── (.*?) \((.*)\)$/.exec(l) ?? /^([│ ]*)[├└]── (.*)$/.exec(l);
  if (!m) continue;
  const nivel = Math.round(m[1].length / 4);
  prefixo = prefixo.slice(0, nivel);
  prefixo.push(m[2]);
  if (m[3]) for (const met of m[3].split(", ")) if (met !== "HEAD" && met !== "OPTIONS") rotas.push({ method: met, url: prefixo.join("") });
}

const IDS: Record<string, string[]> = {
  id: [emp.id, "nao-existe", "x".repeat(300), "%2e%2e%2f", "1 OR 1=1"],
  periodo: ["2026T3", "2026-13", "abc", "9999T9"],
  ano: ["2026", "-1", "abc", "99999999999"],
};
const valorId = (nome: string, k: number) => {
  if (nome === "id") return IDS.id[k % IDS.id.length];
  if (nome === "did" || nome === "docId") return [doc.id, "nao-existe"][k % 2];
  if (IDS[nome]) return IDS[nome][k % IDS[nome].length];
  return ["nao-existe", "x".repeat(300), "%00", "😀"][k % 4];
};
const CORPOS: unknown[] = [
  undefined, {}, [], null, "texto", 123,
  { versao: "um", nome: 5, email: [], senha: {}, tipo: "???", data: "ontem", total: "muito", base: -1e308, iva: NaN, linhas: "x" },
  { nome: "x".repeat(100_000), detalhe: "y".repeat(50_000), texto: "z".repeat(20_000) },
  { qr: "A:*B:*", tipo: "compra", data: "2026-02-30", base: 1e20, iva: 1e20, taxa: 999, terceiroNif: "000000000" },
  { comprovativo: null, conta: "<script>", periodo: "2026T9", ano: "abc", cae: "∞", caes: ["1".repeat(500)] },
];

const falhas: string[] = [];
let n = 0;
const sessoes = [["empresa", emp.token], ["contabilista", cc.token], ["casa", casa.token], ["sem sessão", undefined]] as const;
for (const r of rotas) {
  if (r.url.includes("/ws") || r.url.endsWith("*")) continue;
  for (let k = 0; k < 4; k++) {
    const url = r.url.replace(/:(\w+)/g, (_, nome: string) => encodeURIComponent(valorId(nome, k)).replace(/%25/g, "%"));
    for (const [quem, tk] of sessoes) {
      const corpos = r.method === "GET" || r.method === "DELETE" ? [undefined] : CORPOS;
      for (const c of corpos) {
        const res = await chamar(r.method, url, tk, c, c === undefined && r.method !== "GET" && r.method !== "DELETE" ? "{inválido" : undefined);
        n++;
        // 503 com código próprio = serviço externo desligado de propósito (ex.: WhatsApp sem configuração)
        const intencional = res.status === 503 && typeof res.json === "object" && res.json?.codigo && res.json.codigo !== "erro_interno";
        if (res.status >= 500 && !intencional) falhas.push(`${res.status} ${r.method} ${url.slice(0, 90)} [${quem}] corpo=${JSON.stringify(c)?.slice(0, 60)} → ${JSON.stringify(res.json).slice(0, 120)}`);
      }
    }
  }
}
console.log(`${rotas.length} rotas, ${n} pedidos, ${falhas.length} respostas 5xx`);
for (const f of [...new Set(falhas)].slice(0, 80)) console.log(f);
await app.close(); await db.fechar();
process.exit(falhas.length ? 1 : 0);
