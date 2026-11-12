import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import estatico from "@fastify/static";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { z, ZodError } from "zod";
import {
  ajudaNIF, lerQR, limparNIF, normalizarUtilizador, proximasObrigacoes, qrConsistente, REGRAS_BASE, taxasEm, utilizadorValido, validarNIF,
  type Anexo, type Documento, type MovimentoBancario, type Empresa, type Ligacao, type Pedido, type Regras, type ResumoEmpresa, type Sessao, type VerificacaoFecho,
} from "@contabia/shared";
import type { Db } from "./db.ts";
import {
  agoraISO, ator, criarTokens, ErroApp, exigirAcesso, exigirPapel, hashSenha, novoId, PERMISSOES_PADRAO, verificarSenha, type Ator,
} from "./comum.ts";
import { Hub, eventosDesde, publicar } from "./tempo-real.ts";
import {
  apurarIVA, aprender, classificar, diarioDe, equilibrado, gerarSAFT, lancamentoDeLinha, mesesDoPeriodo, periodoIVADoMes, proporLinhas, xmlDP,
} from "./contabilidade.ts";
import { perguntar } from "./assistente.ts";
import { sugerir, type DocConc } from "./conciliacao.ts";

export interface Config {
  segredoJWT: string;
  tokenAdmin?: string;
  chaveIA?: string;
  agora?: () => Date;
  /** Pasta com as builds web das apps (web/empresa e web/contabilista). */
  pastaWeb?: string;
}

const HORAS_PEDIDO = 72;
const MAX_PEDIDOS_HORA = 5;

export async function criarApp(db: Db, cfg: Config): Promise<{ app: FastifyInstance; hub: Hub }> {
  const app = Fastify({ logger: false });
  const hub = new Hub();
  const tokens = criarTokens(cfg.segredoJWT);
  const agora = cfg.agora ?? (() => new Date());
  const hojeISO = () => agora().toISOString().slice(0, 10);
  const tentativasLigacao = new Map<string, number[]>();

  await app.register(cors, { origin: true, exposedHeaders: ["x-contabia-token"] });
  await app.register(websocket);

  // ── Sessão ──
  app.addHook("onRequest", async (req, reply) => {
    const h = req.headers.authorization;
    const q = (req.query as { token?: string } | undefined)?.token;
    const token = h?.startsWith("Bearer ") ? h.slice(7) : q;
    if (!token) return;
    const a = await tokens.verificar(token);
    const [existe] = await db.query(a.papel === "empresa" ? `SELECT 1 FROM empresas WHERE id = $1` : `SELECT 1 FROM contabilistas WHERE id = $1`, [a.id]);
    if (!existe) throw new ErroApp("sessao_invalida", "A sua sessão terminou. Entre novamente.", 401);
    (req as FastifyRequest & { ator?: Ator }).ator = { papel: a.papel, id: a.id, nome: a.nome };
    // Sessão deslizante: quem usa a app pelo menos uma vez por mês nunca é posto fora.
    if (h && Date.now() / 1000 - a.emitidoEm > 24 * 3600) reply.header("x-contabia-token", await tokens.emitir(a));
  });

  // ── Idempotência: o mesmo pedido reenviado devolve a mesma resposta ──
  app.addHook("preHandler", async (req, reply) => {
    const k = req.headers["idempotency-key"];
    if (req.method === "GET" || typeof k !== "string") return;
    const chave = `${(req as FastifyRequest & { ator?: Ator }).ator?.id ?? "anon"}:${req.method}:${req.url}:${k}`;
    (req as FastifyRequest & { chaveIdem?: string }).chaveIdem = chave;
    const [r] = await db.query<{ estado: number; corpo: string }>(`SELECT estado, corpo FROM idempotencia WHERE chave = $1`, [chave]);
    if (r) {
      (req as FastifyRequest & { repetido?: boolean }).repetido = true;
      return reply.code(r.estado).header("content-type", "application/json").header("idempotent-replay", "true").send(r.corpo);
    }
  });
  app.addHook("onSend", async (req, reply, payload) => {
    const chave = (req as FastifyRequest & { chaveIdem?: string }).chaveIdem;
    if (chave && !(req as FastifyRequest & { repetido?: boolean }).repetido && reply.statusCode < 300 && typeof payload === "string") {
      await db.query(`INSERT INTO idempotencia (chave, estado, corpo, criada_em) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [chave, reply.statusCode, payload, agoraISO()]);
    }
    return payload;
  });

  app.setErrorHandler((erro, _req, reply) => {
    if (erro instanceof ErroApp) return reply.code(erro.status).send({ codigo: erro.codigo, mensagem: erro.message });
    if (erro instanceof ZodError) return reply.code(400).send({ codigo: "dados_invalidos", mensagem: erro.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
    const pgCode = (erro as { code?: string }).code;
    if (pgCode === "23505") return reply.code(409).send({ codigo: "duplicado", mensagem: "Este registo já existe." });
    console.error(erro);
    return reply.code(500).send({ codigo: "erro_interno", mensagem: "Ocorreu um erro. Tente de novo." });
  });

  // ── auxiliares ──
  const empresaPorId = async (id: string): Promise<Empresa> => {
    const [e] = await db.query<{ id: string; utilizador: string; nif: string; nome: string; regiao: string; regime_iva: string }>(
      `SELECT id, utilizador, nif, nome, regiao, regime_iva FROM empresas WHERE id = $1`, [id]);
    if (!e) throw new ErroApp("nao_encontrada", "Empresa não encontrada.", 404);
    return { id: e.id, utilizador: e.utilizador, nif: e.nif, nome: e.nome, regiao: e.regiao as Empresa["regiao"], regimeIVA: e.regime_iva as Empresa["regimeIVA"] };
  };
  const regrasAtuais = async (): Promise<Regras> => {
    const [r] = await db.query<{ regras: Regras }>(`SELECT regras FROM regras_versoes ORDER BY publicada_em DESC LIMIT 1`);
    return r?.regras ?? REGRAS_BASE;
  };
  const sessao = async (a: Ator): Promise<Sessao> => ({ token: await tokens.emitir(a), papel: a.papel, id: a.id, nome: a.nome });
  const params = (req: FastifyRequest) => req.params as Record<string, string>;

  // ═════════════ Autenticação ═════════════
  app.post("/v1/auth/empresas", async (req, reply) => {
    const b = z.object({
      utilizador: z.string(), nif: z.string(), nome: z.string().min(2), senha: z.string().min(8),
      regiao: z.enum(["PT", "PT-MA", "PT-AC"]), regimeIVA: z.enum(["mensal", "trimestral"]),
    }).parse(req.body);
    const utilizador = normalizarUtilizador(b.utilizador);
    if (!utilizadorValido(utilizador)) throw new ErroApp("utilizador_invalido", "O utilizador deve ter 3 a 40 letras, números, pontos ou hífenes.");
    const nif = limparNIF(b.nif);
    if (!validarNIF(nif)) throw new ErroApp("nif_invalido", ajudaNIF(nif).mensagem);
    const [existe] = await db.query(`SELECT 1 FROM empresas WHERE utilizador = $1`, [utilizador]);
    if (existe) throw new ErroApp("utilizador_existe", "Este utilizador já está registado. Escolha outro.", 409);
    const [nifUsado] = await db.query(`SELECT 1 FROM empresas WHERE nif = $1`, [nif]);
    if (nifUsado) throw new ErroApp("nif_existe", "Já existe uma conta Contabia com este NIF. Use «Entrar» com o utilizador dessa conta.", 409);
    const id = novoId();
    await db.query(`INSERT INTO empresas (id, utilizador, nif, nome, regiao, regime_iva, senha_hash, criada_em) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, utilizador, nif, b.nome, b.regiao, b.regimeIVA, await hashSenha(b.senha), agoraISO()]);
    return reply.code(201).send(await sessao({ papel: "empresa", id, nome: b.nome }));
  });

  app.post("/v1/auth/contabilistas", async (req, reply) => {
    const b = z.object({ email: z.string().email("E-mail inválido"), nome: z.string().min(2), numeroOCC: z.string().regex(/^\d{1,10}$/, "O n.º OCC só tem algarismos"), senha: z.string().min(8) }).parse(req.body);
    const email = b.email.trim().toLowerCase();
    const [existe] = await db.query(`SELECT 1 FROM contabilistas WHERE email = $1`, [email]);
    if (existe) throw new ErroApp("email_existe", "Este e-mail já está registado. Use «Entrar».", 409);
    const [occUsado] = await db.query(`SELECT 1 FROM contabilistas WHERE numero_occ = $1`, [b.numeroOCC]);
    if (occUsado) throw new ErroApp("occ_existe", "Já existe uma conta com este n.º OCC.", 409);
    const id = novoId();
    await db.query(`INSERT INTO contabilistas (id, email, nome, numero_occ, senha_hash, criado_em) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, email, b.nome, b.numeroOCC, await hashSenha(b.senha), agoraISO()]);
    return reply.code(201).send(await sessao({ papel: "contabilista", id, nome: b.nome }));
  });

  app.post("/v1/auth/sessoes", async (req) => {
    const b = z.object({ papel: z.enum(["empresa", "contabilista"]), identificador: z.string(), senha: z.string() }).parse(req.body);
    const sql = b.papel === "empresa"
      ? `SELECT id, nome, senha_hash FROM empresas WHERE utilizador = $1`
      : `SELECT id, nome, senha_hash FROM contabilistas WHERE email = $1`;
    const ident = b.papel === "empresa" ? normalizarUtilizador(b.identificador) : b.identificador.trim().toLowerCase();
    const [u] = await db.query<{ id: string; nome: string; senha_hash: string }>(sql, [ident]);
    if (!u || !(await verificarSenha(b.senha, u.senha_hash))) throw new ErroApp("credenciais", "Utilizador ou senha incorretos.", 401);
    return sessao({ papel: b.papel, id: u.id, nome: u.nome });
  });

  app.get("/v1/auth/eu", async (req) => {
    const a = ator(req);
    if (a.papel === "empresa") return { sessao: { ...a, token: "" }, empresa: await empresaPorId(a.id) };
    const [c] = await db.query<{ id: string; email: string; nome: string; numero_occ: string }>(`SELECT id, email, nome, numero_occ FROM contabilistas WHERE id = $1`, [a.id]);
    return { sessao: { ...a, token: "" }, contabilista: { id: c.id, email: c.email, nome: c.nome, numeroOCC: c.numero_occ } };
  });

  // ═════════════ Ligação em duas vias ═════════════
  // Qualquer lado pode iniciar: o contabilista com utilizador + NIF da empresa,
  // a empresa com o e-mail ou o n.º OCC do contabilista. Aceita sempre o OUTRO lado.
  // Se os dois lados se convidarem mutuamente, a ligação fica ativa logo.
  type LinhaLig = { id: string; empresa_id: string; contabilista_id: string; estado: string; permissoes: string[]; criada_em: string; expira_em: string; versao: number; iniciada_por: string };
  const ligacaoDe = (l: LinhaLig, extra: Partial<Ligacao> = {}): Ligacao => ({
    id: l.id, empresaId: l.empresa_id, contabilistaId: l.contabilista_id, estado: l.estado as Ligacao["estado"], permissoes: l.permissoes,
    criadaEm: l.criada_em, expiraEm: l.expira_em, versao: Number(l.versao), iniciadaPor: (l.iniciada_por ?? "contabilista") as Ligacao["iniciadaPor"], ...extra,
  });
  const expirarPendentes = () => db.query(`UPDATE ligacoes SET estado = 'expirada', versao = versao + 1 WHERE estado = 'pendente' AND expira_em < $1`, [agora().toISOString()]);
  const limitar = (id: string) => {
    const t = agora().getTime();
    const recentes = (tentativasLigacao.get(id) ?? []).filter((x) => t - x < 3600_000);
    if (recentes.length >= MAX_PEDIDOS_HORA) throw new ErroApp("demasiadas_tentativas", "Demasiadas tentativas. Tente de novo dentro de uma hora.", 429);
    tentativasLigacao.set(id, [...recentes, t]);
  };
  const infoEmpresa = async (id: string) => {
    const [e] = await db.query<{ nome: string; nif: string; utilizador: string }>(`SELECT nome, nif, utilizador FROM empresas WHERE id = $1`, [id]);
    return { nome: e.nome, nif: e.nif, utilizador: e.utilizador };
  };
  const infoCC = async (id: string) => {
    const [c] = await db.query<{ nome: string; numero_occ: string }>(`SELECT nome, numero_occ FROM contabilistas WHERE id = $1`, [id]);
    return { nome: c.nome, numeroOCC: c.numero_occ };
  };
  const ativar = async (l: LinhaLig, quem: Ator) => {
    const [n] = await db.query<LinhaLig>(`UPDATE ligacoes SET estado = 'ativa', versao = versao + 1, atualizada_em = $1 WHERE id = $2 AND versao = $3 RETURNING *`,
      [agoraISO(), l.id, l.versao]);
    if (!n) throw new ErroApp("conflito_versao", "Os dados mudaram entretanto. Atualize e tente de novo.", 409);
    hub.ligarContabilista(l.contabilista_id, l.empresa_id);
    await publicar(db, hub, l.empresa_id, "ligacao.aceite", quem.papel, { ligacaoId: l.id }, l.contabilista_id);
    return n;
  };

  app.post("/v1/ligacoes", async (req, reply) => {
    const a = ator(req);
    limitar(a.id);
    let empresaId: string, contabilistaId: string;
    if (a.papel === "contabilista") {
      const b = z.object({ utilizador: z.string().min(1), nif: z.string() }).parse(req.body);
      const nif = limparNIF(b.nif);
      if (!validarNIF(nif)) throw new ErroApp("nif_invalido", "O NIF indicado não é válido.");
      const [e] = await db.query<{ id: string }>(`SELECT id FROM empresas WHERE utilizador = $1 AND nif = $2`, [normalizarUtilizador(b.utilizador), nif]);
      if (!e) throw new ErroApp("dados_nao_coincidem", "Utilizador e NIF não coincidem com nenhuma empresa. Confirme os dados com a empresa.", 404);
      empresaId = e.id; contabilistaId = a.id;
    } else {
      const b = z.object({ contabilista: z.string().min(1) }).parse(req.body);
      const v = b.contabilista.trim().toLowerCase();
      const [c] = await db.query<{ id: string }>(
        v.includes("@") ? `SELECT id FROM contabilistas WHERE email = $1` : `SELECT id FROM contabilistas WHERE numero_occ = $1`, [v]);
      if (!c) throw new ErroApp("contabilista_nao_encontrado", "Não encontrámos nenhum contabilista com esse e-mail ou n.º OCC na Contabia. Confirme com ele os dados da conta.", 404);
      empresaId = a.id; contabilistaId = c.id;
    }
    await expirarPendentes();
    const [ja] = await db.query<LinhaLig>(`SELECT * FROM ligacoes WHERE empresa_id = $1 AND contabilista_id = $2 AND estado IN ('pendente','ativa')`, [empresaId, contabilistaId]);
    const extra = { empresa: await infoEmpresa(empresaId), contabilista: await infoCC(contabilistaId) };
    if (ja?.estado === "ativa") return ligacaoDe(ja, extra);
    if (ja && ja.iniciada_por === a.papel) return ligacaoDe(ja, extra);
    if (ja) return ligacaoDe(await ativar(ja, a), extra); // o outro lado já tinha convidado: ambos consentiram
    const t = agora().getTime();
    const l: LinhaLig = {
      id: novoId(), empresa_id: empresaId, contabilista_id: contabilistaId, estado: "pendente", permissoes: PERMISSOES_PADRAO,
      criada_em: agora().toISOString(), expira_em: new Date(t + HORAS_PEDIDO * 3600_000).toISOString(), versao: 1, iniciada_por: a.papel,
    };
    await db.query(`INSERT INTO ligacoes (id, empresa_id, contabilista_id, estado, permissoes, criada_em, expira_em, atualizada_em, versao, iniciada_por) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$6,$8,$9)`,
      [l.id, l.empresa_id, l.contabilista_id, l.estado, JSON.stringify(l.permissoes), l.criada_em, l.expira_em, l.versao, l.iniciada_por]);
    await publicar(db, hub, empresaId, "ligacao.pedida", a.papel, { ligacaoId: l.id, iniciadaPor: a.papel, ...extra }, contabilistaId);
    return reply.code(201).send(ligacaoDe(l, extra));
  });

  app.get("/v1/ligacoes", async (req) => {
    const a = ator(req);
    await expirarPendentes();
    const ls = await db.query<LinhaLig & { cc_nome: string; cc_occ: string; e_nome: string; e_nif: string; e_user: string }>(
      `SELECT l.*, c.nome AS cc_nome, c.numero_occ AS cc_occ, e.nome AS e_nome, e.nif AS e_nif, e.utilizador AS e_user
         FROM ligacoes l JOIN contabilistas c ON c.id = l.contabilista_id JOIN empresas e ON e.id = l.empresa_id
        WHERE ${a.papel === "empresa" ? "l.empresa_id" : "l.contabilista_id"} = $1 ORDER BY l.criada_em DESC`, [a.id]);
    return ls.map((l) => ligacaoDe(l, { contabilista: { nome: l.cc_nome, numeroOCC: l.cc_occ }, empresa: { nome: l.e_nome, nif: l.e_nif, utilizador: l.e_user } }));
  });

  const mudarEstado = async (req: FastifyRequest, para: "ativa" | "recusada" | "revogada") => {
    const a = ator(req);
    const { versao } = z.object({ versao: z.number().int() }).parse(req.body ?? {});
    await expirarPendentes();
    const [l] = await db.query<LinhaLig>(`SELECT * FROM ligacoes WHERE id = $1`, [params(req).id]);
    const dono = l && (a.papel === "empresa" ? l.empresa_id === a.id : l.contabilista_id === a.id);
    if (!dono) throw new ErroApp("nao_encontrada", "Ligação não encontrada.", 404);
    if (Number(l.versao) !== versao) throw new ErroApp("conflito_versao", "Os dados mudaram entretanto. Atualize e tente de novo.", 409);
    if (para !== "revogada") {
      if ((l.iniciada_por ?? "contabilista") === a.papel)
        throw new ErroApp("sem_permissao", "Este pedido foi enviado por si. Quem o recebe é que o aceita ou recusa.", 403);
      if (l.estado === "expirada") throw new ErroApp("expirada", "Este pedido expirou. Envie um novo pedido.", 410);
      if (l.estado !== "pendente") throw new ErroApp("estado_invalido", `O pedido já está ${l.estado}.`, 409);
      if (para === "ativa") return ligacaoDe(await ativar(l, a));
    } else if (l.estado !== "ativa" && l.estado !== "pendente") {
      return ligacaoDe(l);
    }
    const [n] = await db.query<LinhaLig>(`UPDATE ligacoes SET estado = $1, versao = versao + 1, atualizada_em = $2 WHERE id = $3 AND versao = $4 RETURNING *`,
      [para, agoraISO(), l.id, versao]);
    if (!n) throw new ErroApp("conflito_versao", "Os dados mudaram entretanto. Atualize e tente de novo.", 409);
    await publicar(db, hub, l.empresa_id, para === "recusada" ? "ligacao.recusada" : "ligacao.revogada", a.papel, { ligacaoId: l.id }, l.contabilista_id);
    if (para === "revogada") hub.desligarContabilista(l.contabilista_id, l.empresa_id);
    return ligacaoDe(n);
  };
  app.post("/v1/ligacoes/:id/aceitar", (req) => mudarEstado(req, "ativa"));
  app.post("/v1/ligacoes/:id/recusar", (req) => mudarEstado(req, "recusada"));
  app.delete("/v1/ligacoes/:id", (req) => mudarEstado(req, "revogada"));

  // ═════════════ Carteira e resumo ═════════════
  const resumo = async (empresaId: string): Promise<ResumoEmpresa> => {
    const empresa = await empresaPorId(empresaId);
    const [{ d }] = await db.query<{ d: number }>(`SELECT count(*)::int AS d FROM documentos WHERE empresa_id = $1 AND estado = 'validar'`, [empresaId]);
    const [{ l }] = await db.query<{ l: number }>(`SELECT count(*)::int AS l FROM lancamentos WHERE empresa_id = $1 AND estado = 'proposto'`, [empresaId]);
    const [{ p }] = await db.query<{ p: number }>(`SELECT count(*)::int AS p FROM pedidos WHERE empresa_id = $1 AND estado = 'pendente'`, [empresaId]);
    const prox = proximasObrigacoes(hojeISO(), empresa.regimeIVA, await regrasAtuais()).find((o) => o.codigo === "dp_iva");
    const [s] = prox ? await db.query(`SELECT 1 FROM submissoes WHERE empresa_id = $1 AND obrigacao = 'dp_iva' AND periodo = $2`, [empresaId, prox.periodo]) : [];
    return { empresa, documentosPorValidar: d, lancamentosPorRever: l, pedidosPendentes: p, ivaSubmetido: !!s };
  };
  app.get("/v1/carteira", async (req) => {
    const a = ator(req);
    exigirPapel(a, "contabilista");
    const ls = await db.query<{ empresa_id: string }>(`SELECT empresa_id FROM ligacoes WHERE contabilista_id = $1 AND estado = 'ativa'`, [a.id]);
    return Promise.all(ls.map((l) => resumo(l.empresa_id)));
  });
  app.get("/v1/empresas/:id/resumo", async (req) => {
    await exigirAcesso(db, ator(req), params(req).id);
    return resumo(params(req).id);
  });

  // ═════════════ Documentos ═════════════
  type LinhaDoc = { id: string; empresa_id: string; tipo: string; terceiro_nif: string; terceiro_nome: string; numero: string; atcud: string; data: string; base: string; iva: string; total: string; taxa: string; espaco_fiscal: string; estado: string; conta_sugerida: string; categoria: string; iva_dedutivel: boolean; origem: string; criado_em: string; estado_anterior?: string | null; anulacao_motivo?: string | null; anulacao_pedida_por?: string | null; anulacao_em?: string | null; n_anexos?: number };
  const docDe = (d: LinhaDoc): Documento => ({
    id: d.id, empresaId: d.empresa_id, tipo: d.tipo as Documento["tipo"], terceiroNif: d.terceiro_nif, terceiroNome: d.terceiro_nome, numero: d.numero,
    atcud: d.atcud, data: d.data, base: Number(d.base), iva: Number(d.iva), total: Number(d.total), taxa: Number(d.taxa), espacoFiscal: d.espaco_fiscal,
    estado: d.estado as Documento["estado"], contaSugerida: d.conta_sugerida, categoria: d.categoria, ivaDedutivel: d.iva_dedutivel,
    origem: d.origem as Documento["origem"], criadoEm: d.criado_em,
    anexos: Number(d.n_anexos ?? 0),
    anulacao: d.anulacao_motivo ? { motivo: d.anulacao_motivo, pedidaPor: d.anulacao_pedida_por as "empresa" | "contabilista", em: d.anulacao_em ?? "" } : null,
  });

  app.get("/v1/empresas/:id/documentos", async (req) => {
    const id = params(req).id;
    await exigirAcesso(db, ator(req), id);
    const periodo = (req.query as { periodo?: string }).periodo;
    const rows = await db.query<LinhaDoc>(
      `SELECT d.*, (SELECT count(*) FROM anexos a WHERE a.documento_id = d.id)::int AS n_anexos FROM documentos d WHERE d.empresa_id = $1 ${periodo ? "AND d.data LIKE $2" : ""} ORDER BY d.data DESC, d.criado_em DESC`,
      periodo ? [id, `${periodo}%`] : [id]);
    return rows.map(docDe);
  });

  /** Regista um documento com todas as verificações (usado pelo QR, manual e importação do e-Fatura). */
  async function registarDocumento(id: string, a: Ator, d: Omit<Documento, "id" | "empresaId" | "estado" | "contaSugerida" | "categoria" | "ivaDedutivel" | "criadoEm">, descricao = ""): Promise<Documento> {
    // Erros "sem querer" mais comuns: data errada, período já fechado, a mesma fatura duas vezes.
    const hoje = hojeISO();
    if (d.data > hoje) throw new ErroApp("data_futura", `A data ${d.data.split("-").reverse().join("/")} ainda não chegou. Confirme a data da fatura.`);
    if (d.data < "2000-01-01") throw new ErroApp("data_invalida", "A data do documento não parece correta.");
    if (await periodoFechado(id, d.data.slice(0, 7)))
      throw new ErroApp("periodo_fechado", `O mês ${d.data.slice(5, 7)}/${d.data.slice(0, 4)} já foi fechado pelo contabilista. Fale com ele antes de juntar documentos a esse mês.`, 409);
    if (d.base < 0 || d.iva < 0) throw new ErroApp("valor_negativo", "Os valores não podem ser negativos. Para devoluções, registe a nota de crédito.");
    if (d.origem === "manual" && d.taxa >= 0 && Math.abs(d.iva - (d.base * d.taxa) / 100) > Math.max(0.05, d.base * 0.005))
      throw new ErroApp("iva_incoerente", `O IVA (${d.iva.toFixed(2)} €) não corresponde a ${d.taxa}% de ${d.base.toFixed(2)} €. Confirme os valores.`);
    const [repetido] = await db.query<LinhaDoc>(
      `SELECT * FROM documentos WHERE empresa_id = $1 AND terceiro_nif = $2 AND tipo = $3 AND upper(replace(numero, ' ', '')) = upper(replace($4, ' ', '')) AND estado <> 'anulado'`,
      [id, d.terceiroNif, d.tipo, d.numero]);
    if (repetido) throw new ErroApp("documento_duplicado", `Este documento já foi registado a ${repetido.criado_em.slice(0, 10).split("-").reverse().join("/")} (${repetido.numero}). Não é preciso enviá-lo outra vez.`, 409);
    const cl = await classificar(db, id, d.tipo, d.terceiroNif, `${d.terceiroNome} ${descricao}`);
    const novo: Documento = { ...d, id: novoId(), empresaId: id, estado: "validar", contaSugerida: cl.conta, categoria: cl.categoria, ivaDedutivel: cl.ivaDedutivel, criadoEm: agoraISO() };
    await db.query(
      `INSERT INTO documentos (id, empresa_id, tipo, terceiro_nif, terceiro_nome, numero, atcud, data, base, iva, total, taxa, espaco_fiscal, estado, conta_sugerida, categoria, iva_dedutivel, origem, criado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [novo.id, id, novo.tipo, novo.terceiroNif, novo.terceiroNome, novo.numero, novo.atcud, novo.data, novo.base, novo.iva, novo.total, novo.taxa, novo.espacoFiscal, novo.estado, novo.contaSugerida, novo.categoria, novo.ivaDedutivel, novo.origem, novo.criadoEm],
    ).catch((e) => {
      if ((e as { code?: string }).code === "23505") throw new ErroApp("documento_duplicado", "Este documento já foi registado.", 409);
      throw e;
    });
    await publicar(db, hub, id, "documento.criado", a.papel, { documentoId: novo.id, numero: novo.numero, total: novo.total });
    return novo;
  }

  app.post("/v1/empresas/:id/documentos", async (req, reply) => {
    const a = ator(req);
    const id = params(req).id;
    await exigirAcesso(db, a, id);
    const empresa = await empresaPorId(id);
    const regras = await regrasAtuais();
    const corpo = req.body as Record<string, unknown>;
    let d: Omit<Documento, "id" | "empresaId" | "estado" | "contaSugerida" | "categoria" | "ivaDedutivel" | "criadoEm">;
    if (typeof corpo.qr === "string") {
      const tipo = z.enum(["compra", "venda"]).parse(corpo.tipo ?? "compra");
      const q = lerQR(corpo.qr);
      if (!qrConsistente(q)) throw new ErroApp("qr_inconsistente", "Os valores do código QR não batem certo. Verifique a fatura.");
      if (tipo === "compra" && q.nifAdquirente !== empresa.nif)
        throw new ErroApp("nif_adquirente", "Esta fatura não foi passada ao NIF da empresa. Peça uma fatura com o NIF correto.");
      if (tipo === "venda" && q.nifEmitente !== empresa.nif)
        throw new ErroApp("nif_emitente", "Esta fatura não foi emitida pela empresa.");
      const base = q.bases.isenta + q.bases.reduzida + q.bases.intermedia + q.bases.normal + q.naoSujeito;
      const reg = (["PT", "PT-MA", "PT-AC"].includes(q.espacoFiscal) ? q.espacoFiscal : "PT") as Empresa["regiao"];
      const t = taxasEm(regras, reg, q.data);
      const taxa = q.bases.normal ? t.normal : q.bases.intermedia ? t.intermedia : q.bases.reduzida ? t.reduzida : 0;
      const terceiro = tipo === "compra" ? q.nifEmitente : q.nifAdquirente;
      d = {
        tipo, terceiroNif: terceiro, terceiroNome: String(corpo.terceiroNome ?? `NIF ${terceiro}`), numero: q.identificacao, atcud: q.atcud,
        data: q.data, base, iva: q.totalImpostos, total: q.total, taxa, espacoFiscal: q.espacoFiscal, origem: "qr",
      };
    } else {
      const m = z.object({
        tipo: z.enum(["compra", "venda", "banco", "pessoal"]), terceiroNif: z.string(), terceiroNome: z.string().min(1), numero: z.string().min(1),
        data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), base: z.number(), iva: z.number(), taxa: z.number(), atcud: z.string().optional(),
      }).parse(corpo);
      if (m.terceiroNif && !validarNIF(m.terceiroNif)) throw new ErroApp("nif_invalido", "O NIF do fornecedor/cliente não é válido.");
      d = { ...m, atcud: m.atcud ?? "", total: Math.round((m.base + m.iva) * 100) / 100, espacoFiscal: empresa.regiao, origem: "manual" };
    }
    const novo = await registarDocumento(id, a, d, String(corpo.descricao ?? ""));
    return reply.code(201).send(novo);
  });


  // Importação do e-Fatura: a app lê o CSV, mostra a pré-visualização e envia as linhas aqui.
  app.post("/v1/empresas/:id/documentos/importar", async (req) => {
    const a = ator(req);
    const id = params(req).id;
    await exigirAcesso(db, a, id);
    const empresa = await empresaPorId(id);
    const regras = await regrasAtuais();
    const b = z.object({
      tipo: z.enum(["compra", "venda"]).default("compra"),
      linhas: z.array(z.object({
        nif: z.string(), nome: z.string().min(1), numero: z.string().min(1), atcud: z.string().default(""),
        data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), base: z.number(), iva: z.number(), total: z.number(),
      })).min(1).max(500),
    }).parse(req.body);
    const resultados: { numero: string; estado: "importado" | "repetido" | "erro"; mensagem?: string; id?: string }[] = [];
    for (const l of b.linhas) {
      try {
        if (!validarNIF(l.nif)) throw new ErroApp("nif_invalido", "NIF inválido.");
        // taxa: a mais próxima das taxas da região naquela data
        const t = taxasEm(regras, empresa.regiao, l.data);
        const efetiva = l.base ? (l.iva / l.base) * 100 : 0;
        const taxa = [0, t.reduzida, t.intermedia, t.normal].reduce((m, x) => (Math.abs(x - efetiva) < Math.abs(m - efetiva) ? x : m), 0);
        const d = await registarDocumento(id, a, {
          tipo: b.tipo, terceiroNif: l.nif, terceiroNome: l.nome, numero: l.numero, atcud: l.atcud, data: l.data,
          base: l.base, iva: l.iva, total: l.total, taxa, espacoFiscal: empresa.regiao, origem: "efatura",
        });
        resultados.push({ numero: l.numero, estado: "importado", id: d.id });
      } catch (e) {
        if (e instanceof ErroApp && e.codigo === "documento_duplicado") resultados.push({ numero: l.numero, estado: "repetido" });
        else resultados.push({ numero: l.numero, estado: "erro", mensagem: e instanceof ErroApp ? e.message : "Não foi possível importar." });
      }
    }
    return {
      importados: resultados.filter((r) => r.estado === "importado").length,
      repetidos: resultados.filter((r) => r.estado === "repetido").length,
      erros: resultados.filter((r) => r.estado === "erro").length,
      resultados,
    };
  });

  app.post("/v1/empresas/:id/documentos/:doc/validar", async (req) => {
    const a = ator(req);
    const { id, doc } = params(req);
    await exigirAcesso(db, a, id);
    const b = z.object({ contaSugerida: z.string().regex(/^\d{2,8}$/).optional(), ivaDedutivel: z.boolean().optional(), terceiroNome: z.string().optional() }).parse(req.body ?? {});
    const [d0] = await db.query<LinhaDoc>(`SELECT * FROM documentos WHERE id = $1 AND empresa_id = $2`, [doc, id]);
    if (!d0) throw new ErroApp("nao_encontrado", "Documento não encontrado.", 404);
    if (d0.estado === "anulado" || d0.estado === "anulacao_pedida") throw new ErroApp("documento_anulado", "Este documento está anulado ou com anulação pedida.", 409);
    const [d1] = await db.query<LinhaDoc>(
      `UPDATE documentos SET estado = 'validado', conta_sugerida = COALESCE($1, conta_sugerida), iva_dedutivel = COALESCE($2, iva_dedutivel), terceiro_nome = COALESCE($3, terceiro_nome) WHERE id = $4 RETURNING *`,
      [b.contaSugerida ?? null, b.ivaDedutivel ?? null, b.terceiroNome ?? null, doc]);
    const d = docDe(d1);
    if (d.tipo !== "venda") await aprender(db, id, d.terceiroNif, d.contaSugerida);
    const [ja] = await db.query(`SELECT 1 FROM lancamentos WHERE documento_id = $1 AND estado IN ('proposto','lancado')`, [doc]);
    if (!ja) {
      const cl = b.contaSugerida ? { confianca: "alta" as const } : await classificar(db, id, d.tipo, d.terceiroNif, d.terceiroNome);
      const linhas = proporLinhas(d);
      await db.query(
        `INSERT INTO lancamentos (id, empresa_id, documento_id, diario, data, periodo, descricao, linhas, estado, confianca, versao, criado_em) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'proposto',$9,1,$10)`,
        [novoId(), id, doc, diarioDe(d.tipo), d.data, d.data.slice(0, 7), `${d.numero} · ${d.terceiroNome}`, JSON.stringify(linhas), cl.confianca, agoraISO()]);
      await publicar(db, hub, id, "lancamento.proposto", "sistema", { documentoId: doc });
    }
    await publicar(db, hub, id, "documento.validado", a.papel, { documentoId: doc });
    return d;
  });

  // ═════════════ Anulação de documentos ═════════════
  // Nada é apagado: a lei obriga a guardar documentos e registos 10 anos (CIRC, art. 123.º, n.º 4).
  // A empresa só PEDE a anulação; quem decide é o Contabilista Certificado.
  const MOTIVOS = ["duplicado", "valores_errados", "nao_e_da_empresa", "pessoal", "outro"] as const;
  async function docDaEmpresa(id: string, doc: string) {
    const [d] = await db.query<LinhaDoc>(`SELECT * FROM documentos WHERE id = $1 AND empresa_id = $2`, [doc, id]);
    if (!d) throw new ErroApp("nao_encontrado", "Documento não encontrado.", 404);
    return d;
  }
  async function concretizarAnulacao(id: string, d: LinhaDoc, motivo: string, por: "empresa" | "contabilista") {
    const lancs = await db.query<LinhaLanc>(`SELECT * FROM lancamentos WHERE documento_id = $1 AND estado IN ('proposto','lancado')`, [d.id]);
    const hoje = hojeISO();
    for (const l of lancs) {
      if (l.estado === "proposto") {
        await db.query(`UPDATE lancamentos SET estado = 'estornado', versao = versao + 1 WHERE id = $1`, [l.id]);
        continue;
      }
      // Já lançado: o original fica e faz-se um estorno com data de hoje (o período original pode estar fechado).
      if (await periodoFechado(id, hoje.slice(0, 7))) throw new ErroApp("periodo_fechado", "O período atual está fechado; reabra-o para anular este documento.", 409);
      await db.query(`UPDATE lancamentos SET estado = 'estornado', versao = versao + 1 WHERE id = $1`, [l.id]);
      const inversas = l.linhas.map((x) => ({ ...x, debito: x.credito, credito: x.debito, descricao: `Anulação: ${x.descricao}` }));
      await db.query(`INSERT INTO lancamentos (id, empresa_id, documento_id, diario, data, periodo, descricao, linhas, estado, confianca, versao, criado_em) VALUES ($1,$2,NULL,$3,$4,$5,$6,$7::jsonb,'lancado','alta',1,$8)`,
        [novoId(), id, l.diario, hoje, hoje.slice(0, 7), `Anulação de ${l.descricao}`, JSON.stringify(inversas), agoraISO()]);
    }
    const [r] = await db.query<LinhaDoc>(
      `UPDATE documentos SET estado = 'anulado', estado_anterior = COALESCE(estado_anterior, estado), anulacao_motivo = $1, anulacao_pedida_por = COALESCE(anulacao_pedida_por, $2), anulacao_em = $3 WHERE id = $4 RETURNING *`,
      [motivo, por, agoraISO(), d.id]);
    await publicar(db, hub, id, "documento.anulado", "contabilista", { documentoId: d.id, numero: d.numero });
    return docDe(r);
  }

  app.post("/v1/empresas/:id/documentos/:doc/anulacao", async (req) => {
    const a = ator(req);
    const { id, doc } = params(req);
    await exigirAcesso(db, a, id);
    const b = z.object({ motivo: z.enum(MOTIVOS), detalhe: z.string().max(300).optional() }).parse(req.body ?? {});
    const d = await docDaEmpresa(id, doc);
    if (d.estado === "anulado") throw new ErroApp("ja_anulado", "Este documento já está anulado.", 409);
    const motivo = b.detalhe?.trim() ? `${b.motivo}: ${b.detalhe.trim()}` : b.motivo;
    if (a.papel === "contabilista") return concretizarAnulacao(id, d, motivo, "contabilista");
    if (d.estado === "anulacao_pedida") return docDe(d);
    const [r] = await db.query<LinhaDoc>(
      `UPDATE documentos SET estado = 'anulacao_pedida', estado_anterior = $1, anulacao_motivo = $2, anulacao_pedida_por = 'empresa', anulacao_em = $3 WHERE id = $4 RETURNING *`,
      [d.estado, motivo, agoraISO(), doc]);
    await publicar(db, hub, id, "documento.anulacao_pedida", "empresa", { documentoId: doc, numero: d.numero, motivo });
    return docDe(r);
  });
  app.post("/v1/empresas/:id/documentos/:doc/anulacao/aprovar", async (req) => {
    const a = ator(req);
    const { id, doc } = params(req);
    exigirPapel(a, "contabilista");
    await exigirAcesso(db, a, id, "lancamentos.escrever");
    const d = await docDaEmpresa(id, doc);
    if (d.estado !== "anulacao_pedida") throw new ErroApp("estado_invalido", "Não há pedido de anulação para este documento.", 409);
    return concretizarAnulacao(id, d, d.anulacao_motivo ?? "outro", "empresa");
  });
  app.post("/v1/empresas/:id/documentos/:doc/anulacao/recusar", async (req) => {
    const a = ator(req);
    const { id, doc } = params(req);
    exigirPapel(a, "contabilista");
    await exigirAcesso(db, a, id);
    const d = await docDaEmpresa(id, doc);
    if (d.estado !== "anulacao_pedida") throw new ErroApp("estado_invalido", "Não há pedido de anulação para este documento.", 409);
    const [r] = await db.query<LinhaDoc>(
      `UPDATE documentos SET estado = COALESCE(estado_anterior, 'validar'), estado_anterior = NULL, anulacao_motivo = NULL, anulacao_pedida_por = NULL, anulacao_em = NULL WHERE id = $1 RETURNING *`, [doc]);
    await publicar(db, hub, id, "documento.anulacao_recusada", "contabilista", { documentoId: doc, numero: d.numero });
    return docDe(r);
  });

  // ═════════════ Arquivo digital (fotos e PDF das faturas) ═════════════
  const TIPOS_ANEXO: Record<string, (b: Buffer) => boolean> = {
    "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8,
    "image/png": (b) => b[0] === 0x89 && b.subarray(1, 4).toString() === "PNG",
    "image/webp": (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP",
    "application/pdf": (b) => b.subarray(0, 4).toString() === "%PDF",
  };
  const MAX_ANEXO = 10 * 1024 * 1024;
  app.addContentTypeParser(Object.keys(TIPOS_ANEXO), { parseAs: "buffer", bodyLimit: MAX_ANEXO }, (_req, corpo, feito) => feito(null, corpo));
  type LinhaAnexo = { id: string; documento_id: string; tipo: string; nome: string; tamanho: number; enviado_por: string; criado_em: string };
  const anexoDe = (a: LinhaAnexo): Anexo => ({ id: a.id, documentoId: a.documento_id, tipo: a.tipo, nome: a.nome, tamanho: Number(a.tamanho), enviadoPor: a.enviado_por as Anexo["enviadoPor"], criadoEm: a.criado_em });

  app.post("/v1/empresas/:id/documentos/:doc/anexos", async (req, reply) => {
    const a = ator(req);
    const { id, doc } = params(req);
    await exigirAcesso(db, a, id);
    const d = await docDaEmpresa(id, doc);
    const tipo = String(req.headers["content-type"] ?? "").split(";")[0].trim();
    const corpo = req.body as Buffer;
    if (!Buffer.isBuffer(corpo) || !TIPOS_ANEXO[tipo]) throw new ErroApp("tipo_anexo", "Envie uma fotografia (JPG, PNG) ou um PDF.");
    if (!corpo.length) throw new ErroApp("anexo_vazio", "O ficheiro está vazio.");
    if (!TIPOS_ANEXO[tipo](corpo)) throw new ErroApp("anexo_invalido", "O ficheiro não é uma imagem ou PDF válido.");
    const sha256 = createHash("sha256").update(corpo).digest("hex");
    const [ja] = await db.query<LinhaAnexo>(`SELECT id, documento_id, tipo, nome, tamanho, enviado_por, criado_em FROM anexos WHERE documento_id = $1 AND sha256 = $2`, [doc, sha256]);
    if (ja) return anexoDe(ja); // o mesmo ficheiro enviado duas vezes
    const ext = tipo === "application/pdf" ? "pdf" : tipo.split("/")[1].replace("jpeg", "jpg");
    const nome = `${d.numero.replace(/[^\w.-]+/g, "_")}.${ext}`;
    const novo: LinhaAnexo = { id: novoId(), documento_id: doc, tipo, nome, tamanho: corpo.length, enviado_por: a.papel, criado_em: agoraISO() };
    await db.query(`INSERT INTO anexos (id, empresa_id, documento_id, tipo, nome, tamanho, sha256, dados, enviado_por, criado_em) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [novo.id, id, doc, tipo, nome, corpo.length, sha256, corpo, a.papel, novo.criado_em]);
    if (d.estado === "sem_anexo") await db.query(`UPDATE documentos SET estado = 'validar' WHERE id = $1`, [doc]);
    await publicar(db, hub, id, "documento.anexo", a.papel, { documentoId: doc, anexoId: novo.id });
    return reply.code(201).send(anexoDe(novo));
  });
  app.get("/v1/empresas/:id/documentos/:doc/anexos", async (req) => {
    const { id, doc } = params(req);
    await exigirAcesso(db, ator(req), id);
    return (await db.query<LinhaAnexo>(`SELECT id, documento_id, tipo, nome, tamanho, enviado_por, criado_em FROM anexos WHERE documento_id = $1 AND empresa_id = $2 ORDER BY criado_em`, [doc, id])).map(anexoDe);
  });
  app.get("/v1/empresas/:id/documentos/:doc/anexos/:aid", async (req, reply) => {
    const { id, doc, aid } = params(req);
    await exigirAcesso(db, ator(req), id);
    const [x] = await db.query<{ tipo: string; nome: string; dados: Uint8Array }>(`SELECT tipo, nome, dados FROM anexos WHERE id = $1 AND documento_id = $2 AND empresa_id = $3`, [aid, doc, id]);
    if (!x) throw new ErroApp("nao_encontrado", "Ficheiro não encontrado.", 404);
    return reply.header("content-type", x.tipo).header("content-disposition", `inline; filename="${x.nome}"`)
      .header("cache-control", "private, max-age=86400").send(Buffer.from(x.dados));
  });

  // ═════════════ Banco e conciliação ═════════════
  type LinhaMov = { id: string; empresa_id: string; data: string; descricao: string; valor: string; estado: string; documento_id: string | null; sugestao_documento_id: string | null; sugestao_motivo: string | null; sugestao_confianca: string | null };
  async function movimentosDe(id: string, so?: string): Promise<MovimentoBancario[]> {
    const ms = await db.query<LinhaMov>(`SELECT * FROM movimentos WHERE empresa_id = $1 ${so ? "AND id = $2" : ""} ORDER BY data DESC, criado_em DESC`, so ? [id, so] : [id]);
    const ids = [...new Set(ms.flatMap((m) => [m.documento_id, m.sugestao_documento_id]).filter((x): x is string => !!x))];
    const docs = ids.length ? await db.query<{ id: string; numero: string; terceiro_nome: string; total: string; data: string }>(
      `SELECT id, numero, terceiro_nome, total, data FROM documentos WHERE id = ANY($1)`, [ids]) : [];
    const porId = new Map(docs.map((d) => [d.id, { numero: d.numero, terceiroNome: d.terceiro_nome, total: Number(d.total), data: d.data }]));
    return ms.map((m) => ({
      id: m.id, empresaId: m.empresa_id, data: m.data, descricao: m.descricao, valor: Number(m.valor), estado: m.estado as MovimentoBancario["estado"],
      documentoId: m.documento_id, documento: m.documento_id ? porId.get(m.documento_id) ?? null : null,
      sugestao: m.sugestao_documento_id && porId.get(m.sugestao_documento_id)
        ? { documentoId: m.sugestao_documento_id, ...porId.get(m.sugestao_documento_id)!, motivo: m.sugestao_motivo ?? "", confianca: (m.sugestao_confianca ?? "media") as "alta" | "media" } : null,
    }));
  }
  /** Volta a calcular as sugestões dos movimentos por conciliar. */
  async function recalcularSugestoes(id: string) {
    const docs = (await db.query<DocConc>(`SELECT id, tipo, terceiro_nif, terceiro_nome, numero, data, total FROM documentos WHERE empresa_id = $1 AND estado <> 'anulado'`, [id])).map((d) => ({ ...d, total: Number(d.total) }));
    const usados = new Set((await db.query<{ documento_id: string }>(`SELECT documento_id FROM movimentos WHERE empresa_id = $1 AND documento_id IS NOT NULL`, [id])).map((x) => x.documento_id));
    const pendentes = await db.query<LinhaMov>(`SELECT * FROM movimentos WHERE empresa_id = $1 AND estado IN ('por_conciliar','falta_documento') ORDER BY data`, [id]);
    for (const m of pendentes) {
      const s = sugerir({ data: m.data, descricao: m.descricao, valor: Number(m.valor) }, docs, usados);
      if (s?.confianca === "alta") usados.add(s.documentoId); // não sugerir a mesma fatura a dois movimentos
      await db.query(`UPDATE movimentos SET sugestao_documento_id = $1, sugestao_motivo = $2, sugestao_confianca = $3 WHERE id = $4`,
        [s?.documentoId ?? null, s?.motivo ?? null, s?.confianca ?? null, m.id]);
    }
  }

  app.post("/v1/empresas/:id/banco/importar", async (req) => {
    const a = ator(req);
    const id = params(req).id;
    await exigirAcesso(db, a, id);
    const b = z.object({ movimentos: z.array(z.object({ data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), descricao: z.string(), valor: z.number() })).min(1).max(5000) }).parse(req.body);
    let novos = 0;
    const vistos = new Map<string, number>();
    for (const m of b.movimentos) {
      // dois cafés iguais no mesmo dia são dois movimentos: a ordem entra na impressão digital
      const base = `${m.data}|${m.descricao}|${m.valor.toFixed(2)}`;
      const n = (vistos.get(base) ?? 0) + 1;
      vistos.set(base, n);
      const r = await db.query(`INSERT INTO movimentos (id, empresa_id, data, descricao, valor, impressao, estado, criado_em) VALUES ($1,$2,$3,$4,$5,$6,'por_conciliar',$7) ON CONFLICT (empresa_id, impressao) DO NOTHING RETURNING id`,
        [novoId(), id, m.data, m.descricao, m.valor, `${base}|${n}`, agoraISO()]);
      if (r.length) novos++;
    }
    await recalcularSugestoes(id);
    await publicar(db, hub, id, "banco.importado", a.papel, { novos });
    const todos = await movimentosDe(id);
    return { novos, repetidos: b.movimentos.length - novos, comSugestao: todos.filter((m) => m.estado === "por_conciliar" && m.sugestao).length };
  });
  app.get("/v1/empresas/:id/banco/movimentos", async (req) => {
    const id = params(req).id;
    await exigirAcesso(db, ator(req), id);
    return movimentosDe(id);
  });
  async function conciliar(id: string, mid: string, documentoId: string) {
    const [m] = await db.query<LinhaMov>(`SELECT * FROM movimentos WHERE id = $1 AND empresa_id = $2`, [mid, id]);
    if (!m) throw new ErroApp("nao_encontrado", "Movimento não encontrado.", 404);
    const d = await docDaEmpresa(id, documentoId);
    if (d.estado === "anulado") throw new ErroApp("documento_anulado", "Esse documento está anulado.", 409);
    const [outro] = await db.query(`SELECT 1 FROM movimentos WHERE documento_id = $1 AND id <> $2`, [documentoId, mid]);
    if (outro) throw new ErroApp("ja_conciliado", "Essa fatura já está ligada a outro movimento do banco.", 409);
    await db.query(`UPDATE movimentos SET estado = 'conciliado', documento_id = $1 WHERE id = $2`, [documentoId, mid]);
  }
  app.post("/v1/empresas/:id/banco/movimentos/:mid/conciliar", async (req) => {
    const a = ator(req);
    const { id, mid } = params(req);
    await exigirAcesso(db, a, id);
    const b = z.object({ documentoId: z.string() }).parse(req.body);
    await conciliar(id, mid, b.documentoId);
    await recalcularSugestoes(id);
    await publicar(db, hub, id, "banco.conciliado", a.papel, { movimentoId: mid });
    return (await movimentosDe(id, mid))[0];
  });
  app.post("/v1/empresas/:id/banco/conciliar-automatico", async (req) => {
    const a = ator(req);
    const id = params(req).id;
    exigirPapel(a, "contabilista");
    await exigirAcesso(db, a, id, "lancamentos.escrever");
    const altas = await db.query<LinhaMov>(`SELECT * FROM movimentos WHERE empresa_id = $1 AND estado = 'por_conciliar' AND sugestao_confianca = 'alta'`, [id]);
    let n = 0;
    for (const m of altas) {
      try { await conciliar(id, m.id, m.sugestao_documento_id!); n++; } catch { /* já usada: fica para revisão */ }
    }
    await recalcularSugestoes(id);
    if (n) await publicar(db, hub, id, "banco.conciliado", a.papel, { n });
    return { conciliados: n };
  });
  app.post("/v1/empresas/:id/banco/movimentos/:mid/desfazer", async (req) => {
    const a = ator(req);
    const { id, mid } = params(req);
    await exigirAcesso(db, a, id);
    await db.query(`UPDATE movimentos SET estado = 'por_conciliar', documento_id = NULL WHERE id = $1 AND empresa_id = $2`, [mid, id]);
    await recalcularSugestoes(id);
    return (await movimentosDe(id, mid))[0];
  });
  /** Pagamento sem fatura: pede-a à empresa (o pedido aparece no Painel dela). */
  app.post("/v1/empresas/:id/banco/movimentos/:mid/pedir-fatura", async (req) => {
    const a = ator(req);
    const { id, mid } = params(req);
    exigirPapel(a, "contabilista");
    await exigirAcesso(db, a, id);
    const [m] = await db.query<LinhaMov>(`SELECT * FROM movimentos WHERE id = $1 AND empresa_id = $2`, [mid, id]);
    if (!m) throw new ErroApp("nao_encontrado", "Movimento não encontrado.", 404);
    const detalhe = `${m.data.split("-").reverse().join("/")} · ${m.descricao} · ${Math.abs(Number(m.valor)).toFixed(2).replace(".", ",")} €`;
    const pid = novoId();
    await db.query(`INSERT INTO pedidos (id, empresa_id, contabilista_id, tipo, detalhe, estado, criado_em) VALUES ($1,$2,$3,$4,$5,'pendente',$6)`,
      [pid, id, a.id, "Fatura em falta (banco)", detalhe, agoraISO()]);
    await db.query(`UPDATE movimentos SET estado = 'falta_documento' WHERE id = $1`, [mid]);
    await publicar(db, hub, id, "pedido.criado", "contabilista", { pedidoId: pid, tipo: "Fatura em falta (banco)", detalhe });
    return (await movimentosDe(id, mid))[0];
  });
  app.post("/v1/empresas/:id/banco/movimentos/:mid/ignorar", async (req) => {
    const a = ator(req);
    const { id, mid } = params(req);
    exigirPapel(a, "contabilista");
    await exigirAcesso(db, a, id);
    await db.query(`UPDATE movimentos SET estado = 'ignorado' WHERE id = $1 AND empresa_id = $2`, [mid, id]);
    return (await movimentosDe(id, mid))[0];
  });

  // ═════════════ Lançamentos ═════════════
  type LinhaLanc = Parameters<typeof lancamentoDeLinha>[0];
  const periodoFechado = async (empresaId: string, periodo: string) =>
    (await db.query(`SELECT 1 FROM periodos WHERE empresa_id = $1 AND periodo = $2`, [empresaId, periodo])).length > 0;

  app.get("/v1/empresas/:id/lancamentos", async (req) => {
    const id = params(req).id;
    await exigirAcesso(db, ator(req), id);
    const estado = (req.query as { estado?: string }).estado;
    const rows = await db.query<LinhaLanc>(`SELECT * FROM lancamentos WHERE empresa_id = $1 ${estado ? "AND estado = $2" : ""} ORDER BY data DESC, criado_em DESC`, estado ? [id, estado] : [id]);
    return rows.map(lancamentoDeLinha);
  });

  const aprovar = async (empresaId: string, l: LinhaLanc, versao: number, contaDebito?: string) => {
    if (await periodoFechado(empresaId, l.periodo)) throw new ErroApp("periodo_fechado", "Este período já está fechado.", 409);
    if (l.estado !== "proposto") throw new ErroApp("estado_invalido", "Este lançamento já foi tratado.", 409);
    let linhas = l.linhas;
    if (contaDebito) {
      linhas = linhas.map((x, i) => (i === 0 ? { ...x, conta: contaDebito } : x));
      if (l.documento_id) {
        await db.query(`UPDATE documentos SET conta_sugerida = $1 WHERE id = $2`, [contaDebito, l.documento_id]);
        const [d] = await db.query<{ terceiro_nif: string; tipo: string }>(`SELECT terceiro_nif, tipo FROM documentos WHERE id = $1`, [l.documento_id]);
        if (d && d.tipo !== "venda") await aprender(db, empresaId, d.terceiro_nif, contaDebito);
      }
    }
    if (!equilibrado(linhas)) throw new ErroApp("desequilibrado", "O lançamento não está equilibrado (débito ≠ crédito).");
    const [n] = await db.query<LinhaLanc>(`UPDATE lancamentos SET estado = 'lancado', linhas = $1::jsonb, versao = versao + 1 WHERE id = $2 AND versao = $3 RETURNING *`,
      [JSON.stringify(linhas), l.id, versao]);
    if (!n) throw new ErroApp("conflito_versao", "Este lançamento mudou entretanto. Atualize e tente de novo.", 409);
    return n;
  };

  app.post("/v1/empresas/:id/lancamentos/:lid/aprovar", async (req) => {
    const a = ator(req);
    const { id, lid } = params(req);
    exigirPapel(a, "contabilista");
    await exigirAcesso(db, a, id, "lancamentos.escrever");
    const b = z.object({ versao: z.number().int(), contaDebito: z.string().regex(/^\d{2,8}$/).optional() }).parse(req.body);
    const [l] = await db.query<LinhaLanc>(`SELECT * FROM lancamentos WHERE id = $1 AND empresa_id = $2`, [lid, id]);
    if (!l) throw new ErroApp("nao_encontrado", "Lançamento não encontrado.", 404);
    const n = await aprovar(id, l, b.versao, b.contaDebito);
    await publicar(db, hub, id, "lancamento.lancado", "contabilista", { lancamentoId: lid });
    return lancamentoDeLinha(n);
  });

  app.post("/v1/empresas/:id/lancamentos/aprovar-confianca-alta", async (req) => {
    const a = ator(req);
    const id = params(req).id;
    exigirPapel(a, "contabilista");
    await exigirAcesso(db, a, id, "lancamentos.escrever");
    const ls = await db.query<LinhaLanc>(`SELECT * FROM lancamentos WHERE empresa_id = $1 AND estado = 'proposto' AND confianca = 'alta'`, [id]);
    let aprovados = 0;
    for (const l of ls) {
      try { await aprovar(id, l, Number(l.versao)); aprovados++; } catch { /* período fechado ou conflito: fica para revisão manual */ }
    }
    if (aprovados) await publicar(db, hub, id, "lancamento.lancado", "contabilista", { quantidade: aprovados });
    return { aprovados };
  });

  app.post("/v1/empresas/:id/lancamentos/:lid/estornar", async (req) => {
    const a = ator(req);
    const { id, lid } = params(req);
    exigirPapel(a, "contabilista");
    await exigirAcesso(db, a, id, "lancamentos.escrever");
    const { versao } = z.object({ versao: z.number().int() }).parse(req.body);
    const [l] = await db.query<LinhaLanc>(`SELECT * FROM lancamentos WHERE id = $1 AND empresa_id = $2`, [lid, id]);
    if (!l || l.estado !== "lancado") throw new ErroApp("estado_invalido", "Só se estornam lançamentos lançados.", 409);
    const hoje = hojeISO();
    if (await periodoFechado(id, hoje.slice(0, 7))) throw new ErroApp("periodo_fechado", "O período atual está fechado.", 409);
    const [orig] = await db.query<LinhaLanc>(`UPDATE lancamentos SET estado = 'estornado', versao = versao + 1 WHERE id = $1 AND versao = $2 RETURNING *`, [lid, versao]);
    if (!orig) throw new ErroApp("conflito_versao", "Este lançamento mudou entretanto. Atualize e tente de novo.", 409);
    const inversas = l.linhas.map((x) => ({ ...x, debito: x.credito, credito: x.debito, descricao: `Estorno: ${x.descricao}` }));
    await db.query(`INSERT INTO lancamentos (id, empresa_id, documento_id, diario, data, periodo, descricao, linhas, estado, confianca, versao, criado_em) VALUES ($1,$2,NULL,$3,$4,$5,$6,$7::jsonb,'lancado','alta',1,$8)`,
      [novoId(), id, l.diario, hoje, hoje.slice(0, 7), `Estorno de ${l.descricao}`, JSON.stringify(inversas), agoraISO()]);
    if (l.documento_id) {
      await db.query(`INSERT INTO lancamentos (id, empresa_id, documento_id, diario, data, periodo, descricao, linhas, estado, confianca, versao, criado_em) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'proposto','media',1,$9)`,
        [novoId(), id, l.documento_id, l.diario, l.data, l.periodo, l.descricao, JSON.stringify(l.linhas), agoraISO()]);
    }
    await publicar(db, hub, id, "lancamento.estornado", "contabilista", { lancamentoId: lid });
    return lancamentoDeLinha(orig);
  });

  // ═════════════ IVA ═════════════
  const validarPeriodo = (p: string) => { try { mesesDoPeriodo(p); } catch { throw new ErroApp("periodo_invalido", "Período inválido (use 2026-10 ou 2026T3)."); } return p; };

  app.get("/v1/empresas/:id/iva/:periodo", async (req) => {
    const a = ator(req);
    const { id, periodo } = params(req);
    await exigirAcesso(db, a, id, a.papel === "contabilista" ? "iva.apurar" : "documentos.ler");
    return apurarIVA(db, await empresaPorId(id), validarPeriodo(periodo), await regrasAtuais());
  });

  app.post("/v1/empresas/:id/iva/:periodo/ficheiro", async (req) => {
    const a = ator(req);
    const { id, periodo } = params(req);
    exigirPapel(a, "contabilista");
    await exigirAcesso(db, a, id, "iva.apurar");
    const empresa = await empresaPorId(id);
    const ap = await apurarIVA(db, empresa, validarPeriodo(periodo), await regrasAtuais());
    if (ap.lancamentosPendentes) throw new ErroApp("lancamentos_pendentes", `Há ${ap.lancamentosPendentes} lançamentos por rever neste período.`, 409);
    await publicar(db, hub, id, "iva.ficheiro_gerado", "contabilista", { periodo });
    return { nome: `DP_${empresa.nif}_${periodo.replace("-", "")}.xml`, xml: xmlDP(empresa, ap) };
  });

  app.post("/v1/empresas/:id/iva/:periodo/submissao", async (req, reply) => {
    const a = ator(req);
    const { id, periodo } = params(req);
    exigirPapel(a, "contabilista");
    await exigirAcesso(db, a, id, "iva.apurar");
    const { comprovativo } = z.object({ comprovativo: z.string().min(3) }).parse(req.body);
    const empresa = await empresaPorId(id);
    const ap = await apurarIVA(db, empresa, validarPeriodo(periodo), await regrasAtuais());
    const s = { id: novoId(), empresaId: id, obrigacao: "dp_iva", periodo, comprovativo, submetidaEm: agoraISO() };
    await db.query(`INSERT INTO submissoes (id, empresa_id, obrigacao, periodo, comprovativo, submetida_em) VALUES ($1,$2,$3,$4,$5,$6)`,
      [s.id, id, s.obrigacao, periodo, comprovativo, s.submetidaEm]).catch((e) => {
      if ((e as { code?: string }).code === "23505") throw new ErroApp("ja_submetida", "Esta declaração já foi registada.", 409);
      throw e;
    });
    await publicar(db, hub, id, "iva.submetida", "contabilista", { periodo, resultado: ap.resultado });
    return reply.code(201).send(s);
  });

  // ═════════════ Pedidos à empresa ═════════════
  type LinhaPed = { id: string; empresa_id: string; contabilista_id: string; tipo: string; detalhe: string; estado: string; criado_em: string; recebido_em: string | null };
  const pedDe = (p: LinhaPed): Pedido => ({ id: p.id, empresaId: p.empresa_id, contabilistaId: p.contabilista_id, tipo: p.tipo, detalhe: p.detalhe, estado: p.estado as Pedido["estado"], criadoEm: p.criado_em, recebidoEm: p.recebido_em });

  app.get("/v1/empresas/:id/pedidos", async (req) => {
    const id = params(req).id;
    await exigirAcesso(db, ator(req), id);
    return (await db.query<LinhaPed>(`SELECT * FROM pedidos WHERE empresa_id = $1 ORDER BY estado DESC, criado_em DESC`, [id])).map(pedDe);
  });
  app.post("/v1/empresas/:id/pedidos", async (req, reply) => {
    const a = ator(req);
    const id = params(req).id;
    exigirPapel(a, "contabilista");
    await exigirAcesso(db, a, id, "documentos.pedir");
    const b = z.object({ tipo: z.string().min(2), detalhe: z.string().default("") }).parse(req.body);
    const p: LinhaPed = { id: novoId(), empresa_id: id, contabilista_id: a.id, tipo: b.tipo, detalhe: b.detalhe, estado: "pendente", criado_em: agoraISO(), recebido_em: null };
    await db.query(`INSERT INTO pedidos (id, empresa_id, contabilista_id, tipo, detalhe, estado, criado_em) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [p.id, id, a.id, p.tipo, p.detalhe, p.estado, p.criado_em]);
    await publicar(db, hub, id, "pedido.criado", "contabilista", { pedidoId: p.id, tipo: p.tipo, detalhe: p.detalhe });
    return reply.code(201).send(pedDe(p));
  });
  app.post("/v1/empresas/:id/pedidos/:pid/recebido", async (req) => {
    const a = ator(req);
    const { id, pid } = params(req);
    await exigirAcesso(db, a, id);
    const [p] = await db.query<LinhaPed>(`UPDATE pedidos SET estado = 'recebido', recebido_em = $1 WHERE id = $2 AND empresa_id = $3 RETURNING *`, [agoraISO(), pid, id]);
    if (!p) throw new ErroApp("nao_encontrado", "Pedido não encontrado.", 404);
    await publicar(db, hub, id, "pedido.recebido", a.papel, { pedidoId: pid });
    return pedDe(p);
  });

  // ═════════════ SAF-T ═════════════
  app.post("/v1/empresas/:id/saft/:ano", async (req) => {
    const a = ator(req);
    const { id, ano } = params(req);
    exigirPapel(a, "contabilista");
    await exigirAcesso(db, a, id, "saft.gerar");
    const empresa = await empresaPorId(id);
    const r = await gerarSAFT(db, empresa, Number(ano));
    return { nome: `SAFT_${empresa.nif}_${ano}_C.xml`, ...r };
  });

  // ═════════════ Fecho de período ═════════════
  const verificarFecho = async (empresaId: string, periodo: string): Promise<VerificacaoFecho> => {
    if (!/^\d{4}-\d{2}$/.test(periodo)) throw new ErroApp("periodo_invalido", "Use o formato 2026-10.");
    const empresa = await empresaPorId(empresaId);
    const [{ n: lp }] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM lancamentos WHERE empresa_id = $1 AND estado = 'proposto' AND periodo = $2`, [empresaId, periodo]);
    const [{ n: dv }] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM documentos WHERE empresa_id = $1 AND estado = 'validar' AND data LIKE $2`, [empresaId, `${periodo}%`]);
    const [{ n: pp }] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM pedidos WHERE empresa_id = $1 AND estado = 'pendente'`, [empresaId]);
    const mes = Number(periodo.slice(5, 7));
    const fimIVA = empresa.regimeIVA === "mensal" || mes % 3 === 0;
    const pIVA = periodoIVADoMes(periodo, empresa.regimeIVA);
    const sub = fimIVA ? (await db.query(`SELECT 1 FROM submissoes WHERE empresa_id = $1 AND obrigacao = 'dp_iva' AND periodo = $2`, [empresaId, pIVA])).length > 0 : true;
    const passos = [
      { codigo: "documentos", descricao: "Documentos do mês validados pela empresa", ok: dv === 0 },
      { codigo: "lancamentos", descricao: "Lançamentos revistos e lançados", ok: lp === 0 },
      { codigo: "pedidos", descricao: "Documentos pedidos à empresa recebidos", ok: pp === 0 },
      ...(fimIVA ? [{ codigo: "iva", descricao: `Declaração de IVA (${pIVA}) submetida e registada`, ok: sub }] : []),
    ];
    const fechado = await periodoFechado(empresaId, periodo);
    return { periodo, passos, podeFechar: !fechado && passos.every((p) => p.ok), fechado };
  };
  app.get("/v1/empresas/:id/periodos/:periodo", async (req) => {
    const { id, periodo } = params(req);
    await exigirAcesso(db, ator(req), id);
    return verificarFecho(id, periodo);
  });
  app.post("/v1/empresas/:id/periodos/:periodo/fechar", async (req) => {
    const a = ator(req);
    const { id, periodo } = params(req);
    exigirPapel(a, "contabilista");
    await exigirAcesso(db, a, id, "periodo.fechar");
    const v = await verificarFecho(id, periodo);
    if (!v.podeFechar) throw new ErroApp("nao_pode_fechar", v.fechado ? "O período já está fechado." : "Ainda há passos por concluir.", 409);
    await db.query(`INSERT INTO periodos (empresa_id, periodo, fechado_em) VALUES ($1,$2,$3)`, [id, periodo, agoraISO()]);
    await publicar(db, hub, id, "periodo.fechado", "contabilista", { periodo });
    return { ...v, podeFechar: false, fechado: true };
  });

  // ═════════════ Prazos, regras, assistente, sincronização ═════════════
  app.get("/v1/empresas/:id/prazos", async (req) => {
    const id = params(req).id;
    await exigirAcesso(db, ator(req), id);
    const e = await empresaPorId(id);
    const subs = await db.query<{ obrigacao: string; periodo: string }>(`SELECT obrigacao, periodo FROM submissoes WHERE empresa_id = $1`, [id]);
    return proximasObrigacoes(hojeISO(), e.regimeIVA, await regrasAtuais(), 10).map((o) => ({
      ...o, submetida: subs.some((s) => s.obrigacao === o.codigo && s.periodo === o.periodo),
    }));
  });

  app.get("/v1/regras", async () => regrasAtuais());

  app.post("/v1/admin/regras", async (req, reply) => {
    if (!cfg.tokenAdmin || req.headers["x-admin-token"] !== cfg.tokenAdmin) throw new ErroApp("sem_permissao", "Acesso reservado.", 403);
    const r = req.body as Regras;
    if (!r?.versao || !Array.isArray(r.taxasIVA)) throw new ErroApp("dados_invalidos", "Regras incompletas.");
    await db.query(`INSERT INTO regras_versoes (versao, regras, publicada_em) VALUES ($1, $2::jsonb, $3)`, [r.versao, JSON.stringify(r), agoraISO()]);
    hub.difundir({ tipo: "regras.atualizadas", versao: r.versao });
    return reply.code(201).send({ versao: r.versao });
  });

  app.post("/v1/empresas/:id/assistente", async (req) => {
    const a = ator(req);
    const id = params(req).id;
    await exigirAcesso(db, a, id);
    const { pergunta } = z.object({ pergunta: z.string().min(2).max(1000) }).parse(req.body);
    const empresa = await empresaPorId(id);
    const regras = await regrasAtuais();
    const prox = proximasObrigacoes(hojeISO(), empresa.regimeIVA, regras);
    const dp = prox.find((o) => o.codigo === "dp_iva");
    const ap = dp ? await apurarIVA(db, empresa, dp.periodo, regras) : undefined;
    const peds = await db.query<{ tipo: string; detalhe: string }>(`SELECT tipo, detalhe FROM pedidos WHERE empresa_id = $1 AND estado = 'pendente'`, [id]);
    const [{ n }] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM documentos WHERE empresa_id = $1 AND estado = 'validar'`, [id]);
    const r = await perguntar(pergunta, {
      empresa,
      ivaPeriodo: ap && { periodo: ap.periodo, valor: ap.resultado.valor, aFavorDoEstado: ap.resultado.campo === "93", pendentes: ap.lancamentosPendentes },
      pedidosPendentes: peds.map((p) => (p.detalhe ? `${p.tipo}: ${p.detalhe}` : p.tipo)),
      documentosPorValidar: n,
      proximoPrazo: prox.at(0) && { descricao: prox[0].descricao, prazo: prox[0].prazo },
    }, cfg.chaveIA);
    if (r.encaminharParaContabilista) await publicar(db, hub, id, "assistente.encaminhado", a.papel, { pergunta });
    return r;
  });

  app.get("/v1/empresas/:id/sync", async (req) => {
    const id = params(req).id;
    await exigirAcesso(db, ator(req), id);
    const desde = Number((req.query as { desde?: string }).desde ?? 0) || 0;
    return eventosDesde(db, id, desde, 200);
  });

  app.get("/v1/saude", async () => ({ ok: true, versao: "0.1.0" }));

  // ═════════════ Apps web (mesma origem que a API) ═════════════
  const apps = ["empresa", "contabilista"].filter((n) => cfg.pastaWeb && existsSync(join(cfg.pastaWeb, n, "index.html")));
  apps.forEach((nome, i) => {
    app.register(estatico, { root: join(cfg.pastaWeb!, nome), prefix: `/${nome}/`, decorateReply: i === 0, wildcard: false });
  });
  app.setNotFoundHandler((req, reply) => {
    const nome = apps.find((n) => req.url === `/${n}` || req.url.startsWith(`/${n}/`));
    if (nome && req.method === "GET") return reply.type("text/html").sendFile("index.html", join(cfg.pastaWeb!, nome));
    return reply.code(404).send({ codigo: "nao_encontrado", mensagem: "Endereço não encontrado." });
  });
  app.get("/", async (_req, reply) => reply.type("text/html; charset=utf-8").send(PAGINA_INICIAL));


  // ═════════════ Tempo real ═════════════
  app.get("/v1/tempo-real", { websocket: true }, async (socket, req) => {
    const a = (req as FastifyRequest & { ator?: Ator }).ator;
    if (!a) { socket.close(4401, "sessao_invalida"); return; }
    const empresas = a.papel === "empresa"
      ? [a.id]
      : (await db.query<{ empresa_id: string }>(`SELECT empresa_id FROM ligacoes WHERE contabilista_id = $1 AND estado = 'ativa'`, [a.id])).map((x) => x.empresa_id);
    hub.subscrever(socket, empresas, a.papel === "contabilista" ? a.id : undefined);
    socket.on("close", () => hub.remover(socket));
    socket.send(JSON.stringify({ tipo: "ligado", empresas }));
  });

  return { app, hub };
}

const PAGINA_INICIAL = `<!doctype html><html lang="pt-PT"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Contabia</title>
<style>body{margin:0;font-family:system-ui,sans-serif;background:#12232E;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center}
main{max-width:420px;padding:32px;display:flex;flex-direction:column;gap:18px;text-align:center}h1{font-size:40px;margin:8px 0 0;letter-spacing:-1px}p{color:#C9D6DC;margin:0 0 12px}
a{display:block;padding:16px;border-radius:14px;font-weight:600;font-size:17px;text-decoration:none}.a{background:#3CC6A0;color:#0C1A22}.b{border:1px solid #4B6878;color:#fff}</style></head>
<body><main><svg width="88" height="88" viewBox="0 0 64 64" style="margin:0 auto" aria-hidden="true"><circle cx="32" cy="32" r="32" fill="#1F3B4A"/><path d="M43 19a16 16 0 1 0 0 26" fill="none" stroke="#fff" stroke-width="5.5" stroke-linecap="round"/><path d="M27 37q5-5 10 0t10 0t10 0" fill="none" stroke="#3CC6A0" stroke-width="4.5" stroke-linecap="round"/></svg>
<h1>contabia</h1><p>A contabilidade da sua empresa, em dia.</p>
<a class="a" href="/empresa/">App da empresa</a><a class="b" href="/contabilista/">App do Contabilista Certificado</a></main></body></html>`;
