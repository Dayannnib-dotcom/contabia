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
  type FamiliaCarteira, type LigacaoFamilia,
  ANO_FISCAL_CASA, ajudaNIF, arred, categoriaCasaSugerida, estimarDeducoes, limparNIF, prazosCasa, qrConsistente, validarNIF,
  type CategoriaCasa, type DespesaCasa, type MembroCasa, type ResumoCasa, type Sessao,
} from "@contabia/shared";
import type { Db } from "./db.ts";
import { ErroApp, ator, exigirPapel, hashSenha, lerQRSeguro, novoId, type Ator } from "./comum.ts";

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
  // Família da própria empresa: o gestor gere a casa na mesma app, sem outra conta
  `ALTER TABLE agregados ADD COLUMN IF NOT EXISTS empresa_id text`,
  `CREATE UNIQUE INDEX IF NOT EXISTS agregados_empresa ON agregados(empresa_id) WHERE empresa_id IS NOT NULL`,
  `ALTER TABLE agregados ALTER COLUMN email DROP NOT NULL`,
  `ALTER TABLE agregados ALTER COLUMN senha_hash DROP NOT NULL`,
  // Ligação família ↔ Contabilista Certificado (as duas partes consentem)
  `CREATE TABLE IF NOT EXISTS ligacoes_familia (
     id text PRIMARY KEY,
     agregado_id text NOT NULL REFERENCES agregados(id),
     contabilista_id text NOT NULL REFERENCES contabilistas(id),
     estado text NOT NULL,
     iniciada_por text NOT NULL,
     criada_em text NOT NULL,
     ativada_em text,
     terminada_em text
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ligacoes_familia_viva ON ligacoes_familia(agregado_id, contabilista_id) WHERE estado IN ('pendente', 'ativa')`,
];

export const ACOES_CASA: Record<string, string> = {
  "POST /v1/auth/casas": "criou a conta do Plano Família",
  "POST /v1/casa/despesas": "registou uma fatura da casa",
  "POST /v1/casa/despesas/importar": "importou faturas da casa do e-Fatura",
  "PUT /v1/casa/despesas/:did": "alterou uma fatura da casa",
  "POST /v1/casa/despesas/:did/anular": "anulou uma fatura da casa",
  "POST /v1/casa/membros": "acrescentou uma pessoa ao agregado",
  "POST /v1/casa/membros/:mid/desativar": "retirou uma pessoa do agregado",
  "PUT /v1/casa/consentimento-saude": "mudou o consentimento para faturas de saúde",
  "POST /v1/casa/servico-irs": "pediu o serviço de IRS",
  "POST /v1/casa/ativar": "ativou a área Família da empresa",
  "POST /v1/casa/apagar": "apagou a conta Família e os dados",
  "POST /v1/admin/familias/:fid/apagar": "apagou uma conta Família a pedido",
  "POST /v1/casa/ligacoes": "convidou um contabilista para a família",
  "POST /v1/casa/ligacoes/:lid/:acao": "respondeu a uma ligação com um contabilista",
  "POST /v1/familias/ligacoes": "pediu ligação a uma família",
  "POST /v1/familias/ligacoes/:lid/:acao": "respondeu a uma ligação com uma família",
  "PUT /v1/familias/:fid/despesas/:did": "mudou a categoria de uma fatura de uma família",
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
  /** Token de administração (para apagar uma família a pedido feito por e-mail). */
  tokenAdmin?: string;
  /** Confirma por e-mail à família que a conta foi apagada. */
  aoApagar?: (email: string, nome: string) => Promise<void>;
  /** Avisa a equipa de que uma família pediu o serviço de IRS. */
  aoPedirIRS?: (agregado: ResumoCasa["agregado"], tipo: "individual" | "familia") => Promise<void>;
}

export function rotasCasa(app: FastifyInstance, db: Db, agora: () => Date, extras: ExtrasCasa) {
  const agoraISO = () => agora().toISOString();
  const p = (req: FastifyRequest) => req.params as Record<string, string>;
  /** Agregado de quem pede: a conta Família, ou a família do gestor de uma empresa. */
  async function agregadoDoAtor(a: Ator): Promise<string> {
    if (a.papel === "casa") return a.id;
    if (a.papel === "empresa" && a.perfil !== "colaborador") {
      const [r] = await db.query<{ id: string }>(`SELECT id FROM agregados WHERE empresa_id = $1`, [a.id]);
      if (!r) throw new ErroApp("sem_familia", "Ainda não ativou a área Família.", 404);
      return r.id;
    }
    throw new ErroApp("sem_permissao", "Isto é só para contas Família.", 403);
  }
  const casaDe = async (req: FastifyRequest) => ({ id: await agregadoDoAtor(ator(req)) });

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
  async function resumo(id: string, ano = ANO_FISCAL_CASA): Promise<ResumoCasa> {
    const ag = await agregado(id);
    const ms = await membros(id);
    const ds = await despesas(id, ano);
    const titulares = ms.filter((m) => m.ativo && m.tipo === "titular").length;
    return {
      agregado: agregadoDe(ag), membros: ms, ano,
      deducoes: estimarDeducoes(ds, titulares, ano),
      prazos: prazosCasa(ano),
      despesasDoAno: ds.filter((d) => !d.anulada).length,
    };
  }
  app.get("/v1/casa", async (req): Promise<ResumoCasa> => {
    const a = await casaDe(req);
    return resumo(a.id, Number((req.query as { ano?: string }).ano) || ANO_FISCAL_CASA);
  });

  // ── Membros ──
  app.post("/v1/casa/membros", async (req, reply) => {
    const a = await casaDe(req);
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
    const a = await casaDe(req);
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
    const a = await casaDe(req);
    const b = z.object({ consentir: z.boolean() }).parse(req.body);
    await db.query(`UPDATE agregados SET consentimento_saude_em = $2 WHERE id = $1`, [a.id, b.consentir ? agoraISO() : null]);
    return agregadoDe(await agregado(a.id));
  });

  // ── Despesas ──
  app.get("/v1/casa/despesas", async (req) => {
    const a = await casaDe(req);
    const ano = Number((req.query as { ano?: string }).ano) || undefined;
    return despesas(a.id, ano);
  });

  app.post("/v1/casa/despesas", async (req, reply) => {
    const a = await casaDe(req);
    const ag = await agregado(a.id);
    const b = z.object({
      qr: z.string().optional(), nifEmitente: z.string().optional(), emitente: z.string().trim().max(120).optional(),
      data: zData.optional(), total: z.number().positive("O total tem de ser maior que zero.").optional(), iva: z.number().min(0).optional(),
      categoria: z.enum(CATEGORIAS).optional(), membroId: z.string().nullable().optional(), numero: z.string().trim().max(60).optional(),
    }).parse(req.body);
    let d: { nif: string; data: string; total: number; iva: number; numero: string | null; atcud: string | null; origem: "qr" | "manual" };
    if (b.qr) {
      const q = lerQRSeguro(b.qr);
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

  // ── Importar do e-Fatura (ficheiro exportado pela família no Portal das Finanças) ──
  app.post("/v1/casa/despesas/importar", async (req) => {
    const a = await casaDe(req);
    const ag = await agregado(a.id);
    const b = z.object({
      linhas: z.array(z.object({
        nif: z.string(), nome: z.string().max(200), numero: z.string().max(80), atcud: z.string().max(80).optional().default(""),
        data: zData, iva: z.number().min(0), total: z.number(),
      })).max(2000),
    }).parse(req.body);
    const resultados: { numero: string; estado: "importada" | "repetida" | "saude_sem_consentimento" | "erro"; categoria?: CategoriaCasa; mensagem?: string }[] = [];
    for (const l of b.linhas) {
      const nif = limparNIF(l.nif);
      if (!validarNIF(nif) || l.total <= 0) { resultados.push({ numero: l.numero, estado: "erro", mensagem: "NIF ou total inválido" }); continue; }
      const atcud = l.atcud && l.atcud !== "0" ? l.atcud : null;
      const [rep] = await db.query(
        atcud ? `SELECT 1 FROM despesas_casa WHERE agregado_id = $1 AND nif_emitente = $2 AND atcud = $3`
              : `SELECT 1 FROM despesas_casa WHERE agregado_id = $1 AND nif_emitente = $2 AND numero = $3`,
        [a.id, nif, atcud ?? l.numero]);
      if (rep) { resultados.push({ numero: l.numero, estado: "repetida" }); continue; }
      const categoria = categoriaCasaSugerida(l.nome);
      if (categoria === "saude" && !ag.consentimento_saude_em) { resultados.push({ numero: l.numero, estado: "saude_sem_consentimento", categoria }); continue; }
      await db.query(
        `INSERT INTO despesas_casa (id, agregado_id, membro_id, nif_emitente, emitente, data, total, iva, categoria, origem, numero, atcud, criada_em)
         VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,'efatura',$9,$10,$11)`,
        [novoId(), a.id, nif, l.nome || null, l.data, arred(l.total), arred(l.iva), categoria, l.numero, atcud, agoraISO()]);
      resultados.push({ numero: l.numero, estado: "importada", categoria });
    }
    const conta = (e: string) => resultados.filter((r) => r.estado === e).length;
    return { importadas: conta("importada"), repetidas: conta("repetida"), saudeSemConsentimento: conta("saude_sem_consentimento"), erros: conta("erro"), resultados };
  });

  async function despesaDoAgregado(agregadoId: string, did: string) {
    const [r] = await db.query<LinhaDespesa & { agregado_id: string }>(`SELECT * FROM despesas_casa WHERE id = $1`, [did]);
    if (!r || r.agregado_id !== agregadoId) throw new ErroApp("sem_despesa", "Fatura não encontrada.", 404);
    return r;
  }

  app.put("/v1/casa/despesas/:did", async (req) => {
    const a = await casaDe(req);
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
    const a = await casaDe(req);
    const r = await despesaDoAgregado(a.id, p(req).did);
    const b = z.object({ motivo: z.string().trim().min(3, "Indique o motivo.") }).parse(req.body);
    await db.query(`UPDATE despesas_casa SET anulada = true, motivo_anulacao = $2 WHERE id = $1`, [r.id, b.motivo]);
    return despesaDe({ ...r, anulada: true });
  });

  // ── Serviço de IRS com Contabilista Certificado ──
  app.post("/v1/casa/servico-irs", async (req) => {
    const a = await casaDe(req);
    const b = z.object({ tipo: z.enum(["individual", "familia"]) }).parse(req.body);
    await db.query(`UPDATE agregados SET servico_irs = $2, servico_irs_em = $3 WHERE id = $1`, [a.id, b.tipo, agoraISO()]);
    const ag = agregadoDe(await agregado(a.id));
    void extras.aoPedirIRS?.(ag, b.tipo).catch(() => undefined);
    return ag;
  });

  // ── Família da empresa: o gestor ativa a área Família na mesma app ──
  app.post("/v1/casa/ativar", async (req, reply) => {
    const a = ator(req);
    if (a.papel !== "empresa" || a.perfil === "colaborador") throw new ErroApp("so_gestor", "Só o gestor da empresa pode ativar a área Família.", 403);
    const b = z.object({ nome: z.string().trim().min(2, "Indique o seu nome."), nif: z.string() }).parse(req.body);
    const nif = limparNIF(b.nif);
    if (!validarNIF(nif)) throw new ErroApp("nif_invalido", ajudaNIF(nif).mensagem);
    const [ja] = await db.query<{ id: string }>(`SELECT id FROM agregados WHERE empresa_id = $1`, [a.id]);
    if (ja) return resumo(ja.id);
    const id = novoId();
    const em = agoraISO();
    await db.query(`INSERT INTO agregados (id, email, nome, senha_hash, criado_em, empresa_id) VALUES ($1,NULL,$2,NULL,$3,$4)`, [id, b.nome, em, a.id]);
    await db.query(`INSERT INTO membros_casa (id, agregado_id, nome, nif, tipo, criado_em) VALUES ($1,$2,$3,$4,'titular',$5)`, [novoId(), id, b.nome, nif, em]);
    return reply.code(201).send(await resumo(id));
  });

  // ── Ligação família ↔ Contabilista Certificado ──
  type LinhaLig = { id: string; agregado_id: string; contabilista_id: string; estado: string; iniciada_por: string; criada_em: string; ativada_em: string | null };
  const ligacaoDe = (l: LinhaLig, extra: Partial<LigacaoFamilia> = {}): LigacaoFamilia => ({
    id: l.id, agregadoId: l.agregado_id, estado: l.estado as LigacaoFamilia["estado"], iniciadaPor: l.iniciada_por as LigacaoFamilia["iniciadaPor"],
    criadaEm: l.criada_em, ativadaEm: l.ativada_em, ...extra,
  });
  async function ligacao(lid: string) {
    const [l] = await db.query<LinhaLig>(`SELECT * FROM ligacoes_familia WHERE id = $1`, [lid]);
    if (!l) throw new ErroApp("sem_ligacao", "Ligação não encontrada.", 404);
    return l;
  }
  async function criarLigacao(agregadoId: string, contabilistaId: string, por: "familia" | "contabilista") {
    const [viva] = await db.query<LinhaLig>(`SELECT * FROM ligacoes_familia WHERE agregado_id = $1 AND contabilista_id = $2 AND estado IN ('pendente','ativa')`, [agregadoId, contabilistaId]);
    if (viva?.estado === "ativa") throw new ErroApp("ja_ligada", "Já estão ligados.", 409);
    if (viva && viva.iniciada_por !== por) return mudarEstado(viva, "ativa"); // o outro lado já tinha convidado: os dois consentiram
    if (viva) throw new ErroApp("ja_pedida", "O pedido já foi enviado e está à espera de resposta.", 409);
    const l: LinhaLig = { id: novoId(), agregado_id: agregadoId, contabilista_id: contabilistaId, estado: "pendente", iniciada_por: por, criada_em: agoraISO(), ativada_em: null };
    await db.query(`INSERT INTO ligacoes_familia (id, agregado_id, contabilista_id, estado, iniciada_por, criada_em) VALUES ($1,$2,$3,'pendente',$4,$5)`, [l.id, agregadoId, contabilistaId, por, l.criada_em]);
    return l;
  }
  async function mudarEstado(l: LinhaLig, estado: "ativa" | "recusada" | "revogada") {
    const em = agoraISO();
    await db.query(`UPDATE ligacoes_familia SET estado = $2, ativada_em = CASE WHEN $2 = 'ativa' THEN $3 ELSE ativada_em END, terminada_em = CASE WHEN $2 <> 'ativa' THEN $3 ELSE terminada_em END WHERE id = $1`, [l.id, estado, em]);
    return { ...l, estado, ativada_em: estado === "ativa" ? em : l.ativada_em };
  }
  /** Regras de resposta: quem convidou pode cancelar; o outro lado aceita ou recusa; ativa, qualquer um termina. */
  async function responder(l: LinhaLig, lado: "familia" | "contabilista", acao: string) {
    if (acao === "revogar") {
      if (l.estado === "ativa" || (l.estado === "pendente" && l.iniciada_por === lado)) return mudarEstado(l, "revogada");
    } else if (l.estado === "pendente" && l.iniciada_por !== lado) {
      if (acao === "aceitar") return mudarEstado(l, "ativa");
      if (acao === "recusar") return mudarEstado(l, "recusada");
    }
    throw new ErroApp("acao_invalida", "Esta ligação já não aceita essa ação.", 409);
  }

  // lado da família
  app.get("/v1/casa/ligacoes", async (req) => {
    const a = await casaDe(req);
    const ls = await db.query<LinhaLig & { c_nome: string; c_occ: string; c_email: string }>(
      `SELECT l.*, c.nome AS c_nome, c.numero_occ AS c_occ, c.email AS c_email FROM ligacoes_familia l JOIN contabilistas c ON c.id = l.contabilista_id
       WHERE l.agregado_id = $1 ORDER BY l.criada_em DESC`, [a.id]);
    return ls.map((l) => ligacaoDe(l, { contabilista: { nome: l.c_nome, numeroOCC: l.c_occ, email: l.c_email } }));
  });
  app.post("/v1/casa/ligacoes", async (req, reply) => {
    const a = await casaDe(req);
    const b = z.object({ email: z.string().trim().toLowerCase().email("O e-mail não parece válido.") }).parse(req.body);
    const [c] = await db.query<{ id: string; nome: string; numero_occ: string; email: string }>(`SELECT id, nome, numero_occ, email FROM contabilistas WHERE email = $1`, [b.email]);
    if (!c) throw new ErroApp("sem_contabilista", "Não há nenhum Contabilista Certificado na Contabia com este e-mail. Confirme com o seu contabilista.", 404);
    const l = await criarLigacao(a.id, c.id, "familia");
    return reply.code(201).send(ligacaoDe(l, { contabilista: { nome: c.nome, numeroOCC: c.numero_occ, email: c.email } }));
  });
  app.post("/v1/casa/ligacoes/:lid/:acao", async (req) => {
    const a = await casaDe(req);
    const l = await ligacao(p(req).lid);
    if (l.agregado_id !== a.id) throw new ErroApp("sem_ligacao", "Ligação não encontrada.", 404);
    return ligacaoDe(await responder(l, "familia", p(req).acao));
  });

  // lado do contabilista
  const contabilistaDe = (req: FastifyRequest) => { const a = ator(req); exigirPapel(a, "contabilista"); return a; };
  async function exigirFamilia(contabilistaId: string, agregadoId: string) {
    const [l] = await db.query(`SELECT 1 FROM ligacoes_familia WHERE agregado_id = $1 AND contabilista_id = $2 AND estado = 'ativa'`, [agregadoId, contabilistaId]);
    if (!l) throw new ErroApp("sem_permissao", "Sem ligação ativa a esta família.", 403);
  }
  async function titular(agregadoId: string) {
    const [m] = await db.query<{ nome: string; nif: string }>(`SELECT nome, nif FROM membros_casa WHERE agregado_id = $1 AND tipo = 'titular' AND ativo ORDER BY criado_em LIMIT 1`, [agregadoId]);
    return m ?? { nome: "", nif: "" };
  }
  app.get("/v1/familias/ligacoes", async (req) => {
    const a = contabilistaDe(req);
    const ls = await db.query<LinhaLig & { f_nome: string }>(
      `SELECT l.*, g.nome AS f_nome FROM ligacoes_familia l JOIN agregados g ON g.id = l.agregado_id WHERE l.contabilista_id = $1 ORDER BY l.criada_em DESC`, [a.id]);
    return Promise.all(ls.map(async (l) => { const t = await titular(l.agregado_id); return ligacaoDe(l, { familia: { nome: l.f_nome, titular: t.nome, nif: t.nif } }); }));
  });
  app.post("/v1/familias/ligacoes", async (req, reply) => {
    const a = contabilistaDe(req);
    const b = z.object({ email: z.string().trim().toLowerCase().email("O e-mail não parece válido."), nif: z.string() }).parse(req.body);
    const nif = limparNIF(b.nif);
    const [g] = await db.query<{ id: string; nome: string }>(
      `SELECT g.id, g.nome FROM agregados g JOIN membros_casa m ON m.agregado_id = g.id AND m.tipo = 'titular' AND m.ativo AND m.nif = $2 WHERE g.email = $1`, [b.email, nif]);
    if (!g) throw new ErroApp("sem_familia", "Não encontrámos uma conta Família com este e-mail e NIF de titular. Confirme os dois com a família.", 404);
    const l = await criarLigacao(g.id, a.id, "contabilista");
    const t = await titular(g.id);
    return reply.code(201).send(ligacaoDe(l, { familia: { nome: g.nome, titular: t.nome, nif: t.nif } }));
  });
  app.post("/v1/familias/ligacoes/:lid/:acao", async (req) => {
    const a = contabilistaDe(req);
    const l = await ligacao(p(req).lid);
    if (l.contabilista_id !== a.id) throw new ErroApp("sem_ligacao", "Ligação não encontrada.", 404);
    return ligacaoDe(await responder(l, "contabilista", p(req).acao));
  });
  app.get("/v1/familias", async (req): Promise<FamiliaCarteira[]> => {
    const a = contabilistaDe(req);
    const ids = await db.query<{ agregado_id: string }>(`SELECT agregado_id FROM ligacoes_familia WHERE contabilista_id = $1 AND estado = 'ativa' ORDER BY ativada_em`, [a.id]);
    return Promise.all(ids.map(async ({ agregado_id }) => {
      const r = await resumo(agregado_id);
      return { agregadoId: agregado_id, nome: r.agregado.nome, pessoas: r.membros.filter((m) => m.ativo).length, despesasDoAno: r.despesasDoAno, deducoes: r.deducoes.total, servicoIRS: r.agregado.servicoIRS };
    }));
  });
  app.get("/v1/familias/:fid", async (req) => {
    const a = contabilistaDe(req);
    await exigirFamilia(a.id, p(req).fid);
    return resumo(p(req).fid, Number((req.query as { ano?: string }).ano) || ANO_FISCAL_CASA);
  });
  app.get("/v1/familias/:fid/despesas", async (req) => {
    const a = contabilistaDe(req);
    await exigirFamilia(a.id, p(req).fid);
    return despesas(p(req).fid, Number((req.query as { ano?: string }).ano) || undefined);
  });
  app.put("/v1/familias/:fid/despesas/:did", async (req) => {
    const a = contabilistaDe(req);
    const fid = p(req).fid;
    await exigirFamilia(a.id, fid);
    const ag = await agregado(fid);
    const r = await despesaDoAgregado(fid, p(req).did);
    if (r.anulada) throw new ErroApp("anulada", "Esta fatura está anulada.", 409);
    const b = z.object({ categoria: z.enum(CATEGORIAS) }).parse(req.body);
    exigirConsentimentoSaude(ag, b.categoria);
    await db.query(`UPDATE despesas_casa SET categoria = $2 WHERE id = $1`, [r.id, b.categoria]);
    return despesaDe({ ...r, categoria: b.categoria });
  });

  // ── Apagar a conta Família (direito ao apagamento, RGPD) ──
  /** Apaga a família e tudo o que é dela. Ao contrário das empresas, não há obrigação legal de guardar. */
  async function apagarFamilia(id: string) {
    const ag = await agregado(id);
    await db.query(`DELETE FROM ligacoes_familia WHERE agregado_id = $1`, [id]);
    await db.query(`DELETE FROM despesas_casa WHERE agregado_id = $1`, [id]);
    await db.query(`DELETE FROM membros_casa WHERE agregado_id = $1`, [id]);
    await db.query(`DELETE FROM agregados WHERE id = $1`, [id]);
    if (ag.email) void extras.aoApagar?.(ag.email, ag.nome).catch(() => undefined);
  }
  app.post("/v1/casa/apagar", async (req) => {
    const a = await casaDe(req);
    const b = z.object({ confirmacao: z.string() }).parse(req.body);
    if (b.confirmacao.trim().toUpperCase() !== "APAGAR") throw new ErroApp("confirmacao", "Escreva APAGAR para confirmar.", 400);
    await apagarFamilia(a.id);
    return { ok: true, mensagem: "A conta Família e todos os dados foram apagados. As cópias de segurança desaparecem no prazo de 30 dias." };
  });
  app.post("/v1/admin/familias/:fid/apagar", async (req) => {
    if (!extras.tokenAdmin || req.headers["x-admin-token"] !== extras.tokenAdmin) throw new ErroApp("sem_permissao", "Acesso reservado.", 403);
    await apagarFamilia(p(req).fid);
    return { ok: true };
  });
}
