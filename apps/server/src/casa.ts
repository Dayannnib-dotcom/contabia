/**
 * Plano Família: contabilidade da casa para famílias sem empresa (Guia 1, v1.1).
 *  - Uma conta por agregado; titulares e dependentes com o NIF de cada um.
 *  - Faturas pelo código QR ou à mão, classificadas pelas categorias de dedução do IRS.
 *  - Faturas de saúde só com consentimento expresso (dados de saúde, art. 9.º do RGPD).
 *  - Na app nada se apaga: as despesas anulam-se com motivo e os membros desativam-se.
 *    Ao contrário das empresas (10 anos por lei), uma família pode pedir para apagar a conta (direito ao apagamento, RGPD).
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  ANO_FISCAL_CASA, ajudaNIF, arred, categoriaCasaSugerida, estimarDeducoes, lerQR, limparNIF, prazosCasa, qrConsistente, validarNIF,
  type CategoriaCasa, type DespesaCasa, type MembroCasa, type ResumoCasa, type Sessao,
} from "@contabia/shared";
import type { Db } from "./db.ts";
import { ErroApp, ator, exigirPapel, hashSenha, novoId, type Ator } from "./comum.ts";

export const MIGRACOES_CASA = [
  `CREATE TABLE IF NOT EXISTS agregados (
     id text PRIMARY KEY,
     email text UNIQUE NOT NULL,
     nome text NOT NULL,
     senha_hash text NOT NULL,
     consentimento_saude_em text,
     servico_irs text,
     servico_irs_em text,
     senha_mudada_em text,
     criado_em text NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS membros_casa (
     id text PRIMARY KEY,
     agregado_id text NOT NULL REFERENCES agregados(id),
     nome text NOT NULL,
     nif text NOT NULL,
     tipo text NOT NULL,
     ativo boolean NOT NULL DEFAULT true,
     criado_em text NOT NULL,
     UNIQUE (agregado_id, nif)
   )`,
  `CREATE TABLE IF NOT EXISTS despesas_casa (
     id text PRIMARY KEY,
     agregado_id text NOT NULL REFERENCES agregados(id),
     membro_id text REFERENCES membros_casa(id),
     nif_emitente text NOT NULL,
     emitente text,
     data text NOT NULL,
     total numeric NOT NULL,
     iva numeric NOT NULL DEFAULT 0,
     categoria text NOT NULL,
     origem text NOT NULL,
     numero text,
     atcud text,
     anulada boolean NOT NULL DEFAULT false,
     motivo_anulacao text,
     criada_em text NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS despesas_casa_atcud ON despesas_casa(agregado_id, nif_emitente, atcud) WHERE atcud IS NOT NULL AND atcud <> '' AND atcud <> '0'`,
  `CREATE INDEX IF NOT EXISTS despesas_casa_data ON despesas_casa(agregado_id, data)`,
];

export const ACOES_CASA: Record<string, string> = {
  "POST /v1/auth/casas": "criou a conta do Plano Família",
  "POST /v1/casa/despesas": "registou uma fatura da casa",
  "PUT /v1/casa/despesas/:did": "alterou uma fatura da casa",
  "POST /v1/casa/despesas/:did/anular": "anulou uma fatura da casa",
  "POST /v1/casa/membros": "acrescentou uma pessoa ao agregado",
  "POST /v1/casa/membros/:mid/desativar": "retirou uma pessoa do agregado",
  "PUT /v1/casa/consentimento-saude": "mudou o consentimento para faturas de saúde",
  "POST /v1/casa/servico-irs": "pediu o serviço de IRS",
};

const CATEGORIAS = ["gerais", "saude", "educacao", "rendas", "exigencia", "sem_deducao"] as const;
const zData = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (AAAA-MM-DD).");

type LinhaAgregado = { id: string; email: string; nome: string; consentimento_saude_em: string | null; servico_irs: string | null; servico_irs_em: string | null };
type LinhaMembro = { id: string; nome: string; nif: string; tipo: string; ativo: boolean };
type LinhaDespesa = {
  id: string; membro_id: string | null; nif_emitente: string; emitente: string | null; data: string; total: string | number; iva: string | number;
  categoria: string; origem: string; numero: string | null; anulada: boolean; criada_em: string;
};

const membroDe = (r: LinhaMembro): MembroCasa => ({ id: r.id, nome: r.nome, nif: r.nif, tipo: r.tipo as MembroCasa["tipo"], ativo: r.ativo });
const despesaDe = (r: LinhaDespesa): DespesaCasa => ({
  id: r.id, membroId: r.membro_id, nifEmitente: r.nif_emitente, emitente: r.emitente, data: r.data, total: Number(r.total), iva: Number(r.iva),
  categoria: r.categoria as CategoriaCasa, origem: r.origem as DespesaCasa["origem"], numero: r.numero, anulada: r.anulada, criadaEm: r.criada_em,
});
const agregadoDe = (r: LinhaAgregado): ResumoCasa["agregado"] => ({
  id: r.id, nome: r.nome, email: r.email, consentimentoSaudeEm: r.consentimento_saude_em,
  servicoIRS: r.servico_irs && r.servico_irs_em ? { tipo: r.servico_irs as "individual" | "familia", pedidoEm: r.servico_irs_em } : null,
});

export interface ExtrasCasa {
  /** Emite a sessão (token) da conta criada. */
  sessao: (a: Ator) => Promise<Sessao>;
  /** Avisa a equipa de que uma família pediu o serviço de IRS. */
  aoPedirIRS?: (agregado: ResumoCasa["agregado"], tipo: "individual" | "familia") => Promise<void>;
}

export function rotasCasa(app: FastifyInstance, db: Db, agora: () => Date, extras: ExtrasCasa) {
  const agoraISO = () => agora().toISOString();
  const p = (req: FastifyRequest) => req.params as Record<string, string>;
  const casaDe = (req: FastifyRequest) => { const a = ator(req); exigirPapel(a, "casa"); return a; };

  async function agregado(id: string) {
    const [r] = await db.query<LinhaAgregado>(`SELECT id, email, nome, consentimento_saude_em, servico_irs, servico_irs_em FROM agregados WHERE id = $1`, [id]);
    if (!r) throw new ErroApp("sem_conta", "Conta não encontrada.", 404);
    return r;
  }
  async function membros(id: string) {
    return (await db.query<LinhaMembro>(`SELECT id, nome, nif, tipo, ativo FROM membros_casa WHERE agregado_id = $1 ORDER BY tipo DESC, criado_em`, [id])).map(membroDe);
  }
  async function despesas(id: string, ano?: number) {
    return (await db.query<LinhaDespesa>(
      `SELECT * FROM despesas_casa WHERE agregado_id = $1 ${ano ? "AND data LIKE $2" : ""} ORDER BY data DESC, criada_em DESC`,
      ano ? [id, `${ano}-%`] : [id])).map(despesaDe);
  }
  function exigirConsentimentoSaude(ag: LinhaAgregado, categoria: CategoriaCasa) {
    if (categoria === "saude" && !ag.consentimento_saude_em)
      throw new ErroApp("consentimento_saude", "Para guardar faturas de saúde precisa de dar o seu consentimento primeiro (são dados de saúde).", 409);
  }
  async function membroValido(agregadoId: string, membroId: string | null | undefined) {
    if (!membroId) return null;
    const [m] = await db.query(`SELECT 1 FROM membros_casa WHERE id = $1 AND agregado_id = $2 AND ativo`, [membroId, agregadoId]);
    if (!m) throw new ErroApp("membro_invalido", "Essa pessoa não faz parte do seu agregado.", 400);
    return membroId;
  }

  // ── Conta ──
  app.post("/v1/auth/casas", async (req, reply) => {
    const b = z.object({
      nome: z.string().trim().min(2, "Indique o seu nome."),
      email: z.string().trim().toLowerCase().email("O e-mail não parece válido."),
      nif: z.string(), senha: z.string().min(8, "A senha tem de ter pelo menos 8 caracteres."),
    }).parse(req.body);
    const nif = limparNIF(b.nif);
    if (!validarNIF(nif)) throw new ErroApp("nif_invalido", ajudaNIF(nif).mensagem);
    const [existe] = await db.query(`SELECT 1 FROM agregados WHERE email = $1`, [b.email]);
    if (existe) throw new ErroApp("email_existe", "Este e-mail já tem conta no Plano Família. Use «Entrar».", 409);
    const id = novoId();
    const em = agoraISO();
    await db.query(`INSERT INTO agregados (id, email, nome, senha_hash, criado_em) VALUES ($1,$2,$3,$4,$5)`, [id, b.email, b.nome, await hashSenha(b.senha), em]);
    await db.query(`INSERT INTO membros_casa (id, agregado_id, nome, nif, tipo, criado_em) VALUES ($1,$2,$3,$4,'titular',$5)`, [novoId(), id, b.nome, nif, em]);
    return reply.code(201).send(await extras.sessao({ papel: "casa", id, nome: b.nome }));
  });

  // ── Resumo ──
  app.get("/v1/casa", async (req): Promise<ResumoCasa> => {
    const a = casaDe(req);
    const ag = await agregado(a.id);
    const ms = await membros(a.id);
    const ano = Number((req.query as { ano?: string }).ano) || ANO_FISCAL_CASA;
    const ds = await despesas(a.id, ano);
    const titulares = ms.filter((m) => m.ativo && m.tipo === "titular").length;
    return {
      agregado: agregadoDe(ag), membros: ms, ano,
      deducoes: estimarDeducoes(ds, titulares, ano),
      prazos: prazosCasa(ano),
      despesasDoAno: ds.filter((d) => !d.anulada).length,
    };
  });

  // ── Membros ──
  app.post("/v1/casa/membros", async (req, reply) => {
    const a = casaDe(req);
    const b = z.object({ nome: z.string().trim().min(2, "Indique o nome."), nif: z.string(), tipo: z.enum(["titular", "dependente"]) }).parse(req.body);
    const nif = limparNIF(b.nif);
    if (!validarNIF(nif)) throw new ErroApp("nif_invalido", ajudaNIF(nif).mensagem);
    const ms = await membros(a.id);
    if (b.tipo === "titular" && ms.filter((m) => m.ativo && m.tipo === "titular").length >= 2)
      throw new ErroApp("titulares", "Um agregado tem no máximo dois titulares (casal ou unidos de facto).", 400);
    const ja = ms.find((m) => m.nif === nif);
    if (ja?.ativo) throw new ErroApp("nif_existe", "Essa pessoa já está no agregado.", 409);
    if (ja) {
      await db.query(`UPDATE membros_casa SET ativo = true, nome = $2, tipo = $3 WHERE id = $1`, [ja.id, b.nome, b.tipo]);
      return membroDe({ ...ja, nome: b.nome, tipo: b.tipo, ativo: true });
    }
    const id = novoId();
    await db.query(`INSERT INTO membros_casa (id, agregado_id, nome, nif, tipo, criado_em) VALUES ($1,$2,$3,$4,$5,$6)`, [id, a.id, b.nome, nif, b.tipo, agoraISO()]);
    return reply.code(201).send(membroDe({ id, nome: b.nome, nif, tipo: b.tipo, ativo: true }));
  });

  app.post("/v1/casa/membros/:mid/desativar", async (req) => {
    const a = casaDe(req);
    const [m] = await db.query<LinhaMembro & { agregado_id: string }>(`SELECT id, nome, nif, tipo, ativo, agregado_id FROM membros_casa WHERE id = $1`, [p(req).mid]);
    if (!m || m.agregado_id !== a.id) throw new ErroApp("membro_invalido", "Essa pessoa não faz parte do seu agregado.", 404);
    if (m.tipo === "titular") {
      const [{ n }] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM membros_casa WHERE agregado_id = $1 AND tipo = 'titular' AND ativo`, [a.id]);
      if (Number(n) <= 1) throw new ErroApp("ultimo_titular", "O agregado precisa de pelo menos um titular.", 400);
    }
    await db.query(`UPDATE membros_casa SET ativo = false WHERE id = $1`, [m.id]);
    return membroDe({ ...m, ativo: false });
  });

  // ── Consentimento para dados de saúde ──
  app.put("/v1/casa/consentimento-saude", async (req) => {
    const a = casaDe(req);
    const b = z.object({ consentir: z.boolean() }).parse(req.body);
    await db.query(`UPDATE agregados SET consentimento_saude_em = $2 WHERE id = $1`, [a.id, b.consentir ? agoraISO() : null]);
    return agregadoDe(await agregado(a.id));
  });

  // ── Despesas ──
  app.get("/v1/casa/despesas", async (req) => {
    const a = casaDe(req);
    const ano = Number((req.query as { ano?: string }).ano) || undefined;
    return despesas(a.id, ano);
  });

  app.post("/v1/casa/despesas", async (req, reply) => {
    const a = casaDe(req);
    const ag = await agregado(a.id);
    const b = z.object({
      qr: z.string().optional(), nifEmitente: z.string().optional(), emitente: z.string().trim().max(120).optional(),
      data: zData.optional(), total: z.number().positive("O total tem de ser maior que zero.").optional(), iva: z.number().min(0).optional(),
      categoria: z.enum(CATEGORIAS).optional(), membroId: z.string().nullable().optional(), numero: z.string().trim().max(60).optional(),
    }).parse(req.body);
    let d: { nif: string; data: string; total: number; iva: number; numero: string | null; atcud: string | null; origem: "qr" | "manual" };
    if (b.qr) {
      const q = lerQR(b.qr);
      if (!qrConsistente(q)) throw new ErroApp("qr_inconsistente", "Os valores do código QR não batem certo. Confirme a fatura.");
      d = { nif: q.nifEmitente, data: q.data, total: q.total, iva: q.totalImpostos, numero: q.identificacao || null, atcud: q.atcud || null, origem: "qr" };
    } else {
      if (!b.nifEmitente || !b.data || b.total === undefined) throw new ErroApp("dados_invalidos", "Indique o NIF de quem emitiu a fatura, a data e o total.");
      d = { nif: limparNIF(b.nifEmitente), data: b.data, total: arred(b.total), iva: arred(b.iva ?? 0), numero: b.numero ?? null, atcud: null, origem: "manual" };
    }
    if (!validarNIF(d.nif)) throw new ErroApp("nif_invalido", "O NIF de quem emitiu a fatura não é válido.");
    const categoria = b.categoria ?? categoriaCasaSugerida(b.emitente);
    exigirConsentimentoSaude(ag, categoria);
    const membroId = await membroValido(a.id, b.membroId);
    if (d.atcud) {
      const [rep] = await db.query(`SELECT 1 FROM despesas_casa WHERE agregado_id = $1 AND nif_emitente = $2 AND atcud = $3`, [a.id, d.nif, d.atcud]);
      if (rep) throw new ErroApp("repetida", "Esta fatura já está guardada.", 409);
    }
    const id = novoId();
    const criada = agoraISO();
    await db.query(
      `INSERT INTO despesas_casa (id, agregado_id, membro_id, nif_emitente, emitente, data, total, iva, categoria, origem, numero, atcud, criada_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [id, a.id, membroId, d.nif, b.emitente || null, d.data, d.total, d.iva, categoria, d.origem, d.numero, d.atcud, criada]);
    return reply.code(201).send(despesaDe({
      id, membro_id: membroId, nif_emitente: d.nif, emitente: b.emitente || null, data: d.data, total: d.total, iva: d.iva,
      categoria, origem: d.origem, numero: d.numero, anulada: false, criada_em: criada,
    }));
  });

  async function despesaDoAgregado(agregadoId: string, did: string) {
    const [r] = await db.query<LinhaDespesa & { agregado_id: string }>(`SELECT * FROM despesas_casa WHERE id = $1`, [did]);
    if (!r || r.agregado_id !== agregadoId) throw new ErroApp("sem_despesa", "Fatura não encontrada.", 404);
    return r;
  }

  app.put("/v1/casa/despesas/:did", async (req) => {
    const a = casaDe(req);
    const ag = await agregado(a.id);
    const r = await despesaDoAgregado(a.id, p(req).did);
    if (r.anulada) throw new ErroApp("anulada", "Esta fatura está anulada.", 409);
    const b = z.object({ categoria: z.enum(CATEGORIAS).optional(), membroId: z.string().nullable().optional(), emitente: z.string().trim().max(120).optional() }).parse(req.body);
    const categoria = (b.categoria ?? r.categoria) as CategoriaCasa;
    exigirConsentimentoSaude(ag, categoria);
    const membroId = b.membroId === undefined ? r.membro_id : await membroValido(a.id, b.membroId);
    const emitente = b.emitente === undefined ? r.emitente : b.emitente || null;
    await db.query(`UPDATE despesas_casa SET categoria = $2, membro_id = $3, emitente = $4 WHERE id = $1`, [r.id, categoria, membroId, emitente]);
    return despesaDe({ ...r, categoria, membro_id: membroId, emitente });
  });

  app.post("/v1/casa/despesas/:did/anular", async (req) => {
    const a = casaDe(req);
    const r = await despesaDoAgregado(a.id, p(req).did);
    const b = z.object({ motivo: z.string().trim().min(3, "Indique o motivo.") }).parse(req.body);
    await db.query(`UPDATE despesas_casa SET anulada = true, motivo_anulacao = $2 WHERE id = $1`, [r.id, b.motivo]);
    return despesaDe({ ...r, anulada: true });
  });

  // ── Serviço de IRS com Contabilista Certificado ──
  app.post("/v1/casa/servico-irs", async (req) => {
    const a = casaDe(req);
    const b = z.object({ tipo: z.enum(["individual", "familia"]) }).parse(req.body);
    await db.query(`UPDATE agregados SET servico_irs = $2, servico_irs_em = $3 WHERE id = $1`, [a.id, b.tipo, agoraISO()]);
    const ag = agregadoDe(await agregado(a.id));
    void extras.aoPedirIRS?.(ag, b.tipo).catch(() => undefined);
    return ag;
  });
}
