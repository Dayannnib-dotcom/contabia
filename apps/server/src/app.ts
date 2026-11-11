import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { z, ZodError } from "zod";
import {
  ajudaNIF, lerQR, limparNIF, normalizarUtilizador, proximasObrigacoes, qrConsistente, REGRAS_BASE, taxasEm, utilizadorValido, validarNIF,
  type Documento, type Empresa, type Ligacao, type Pedido, type Regras, type ResumoEmpresa, type Sessao, type VerificacaoFecho,
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

export interface Config {
  segredoJWT: string;
  tokenAdmin?: string;
  chaveIA?: string;
  agora?: () => Date;
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

  await app.register(cors, { origin: true });
  await app.register(websocket);

  // ── Sessão ──
  app.addHook("onRequest", async (req) => {
    const h = req.headers.authorization;
    const q = (req.query as { token?: string } | undefined)?.token;
    const token = h?.startsWith("Bearer ") ? h.slice(7) : q;
    if (token) (req as FastifyRequest & { ator?: Ator }).ator = await tokens.verificar(token);
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
    const id = novoId();
    await db.query(`INSERT INTO empresas (id, utilizador, nif, nome, regiao, regime_iva, senha_hash, criada_em) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, utilizador, nif, b.nome, b.regiao, b.regimeIVA, await hashSenha(b.senha), agoraISO()]);
    return reply.code(201).send(await sessao({ papel: "empresa", id, nome: b.nome }));
  });

  app.post("/v1/auth/contabilistas", async (req, reply) => {
    const b = z.object({ email: z.string().email(), nome: z.string().min(2), numeroOCC: z.string().min(1), senha: z.string().min(8) }).parse(req.body);
    const email = b.email.trim().toLowerCase();
    const [existe] = await db.query(`SELECT 1 FROM contabilistas WHERE email = $1`, [email]);
    if (existe) throw new ErroApp("email_existe", "Este e-mail já está registado.", 409);
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
  type LinhaLig = { id: string; empresa_id: string; contabilista_id: string; estado: string; permissoes: string[]; criada_em: string; expira_em: string; versao: number };
  const ligacaoDe = (l: LinhaLig, extra: Partial<Ligacao> = {}): Ligacao => ({
    id: l.id, empresaId: l.empresa_id, contabilistaId: l.contabilista_id, estado: l.estado as Ligacao["estado"], permissoes: l.permissoes,
    criadaEm: l.criada_em, expiraEm: l.expira_em, versao: Number(l.versao), ...extra,
  });
  const expirarPendentes = () => db.query(`UPDATE ligacoes SET estado = 'expirada', versao = versao + 1 WHERE estado = 'pendente' AND expira_em < $1`, [agora().toISOString()]);

  app.post("/v1/ligacoes", async (req, reply) => {
    const a = ator(req);
    exigirPapel(a, "contabilista");
    const b = z.object({ utilizador: z.string(), nif: z.string() }).parse(req.body);
    const t = agora().getTime();
    const recentes = (tentativasLigacao.get(a.id) ?? []).filter((x) => t - x < 3600_000);
    if (recentes.length >= MAX_PEDIDOS_HORA) throw new ErroApp("demasiadas_tentativas", "Demasiadas tentativas. Tente de novo dentro de uma hora.", 429);
    tentativasLigacao.set(a.id, [...recentes, t]);
    const nif = limparNIF(b.nif);
    if (!validarNIF(nif)) throw new ErroApp("nif_invalido", "O NIF indicado não é válido.");
    const [e] = await db.query<{ id: string; nome: string; nif: string; utilizador: string }>(
      `SELECT id, nome, nif, utilizador FROM empresas WHERE utilizador = $1 AND nif = $2`, [normalizarUtilizador(b.utilizador), nif]);
    if (!e) throw new ErroApp("dados_nao_coincidem", "Utilizador e NIF não coincidem com nenhuma empresa.", 404);
    await expirarPendentes();
    const [ja] = await db.query<LinhaLig>(`SELECT * FROM ligacoes WHERE empresa_id = $1 AND contabilista_id = $2 AND estado IN ('pendente','ativa')`, [e.id, a.id]);
    const info = { empresa: { nome: e.nome, nif: e.nif, utilizador: e.utilizador } };
    if (ja) return ligacaoDe(ja, info);
    const [cc] = await db.query<{ nome: string; numero_occ: string }>(`SELECT nome, numero_occ FROM contabilistas WHERE id = $1`, [a.id]);
    const l: LinhaLig = {
      id: novoId(), empresa_id: e.id, contabilista_id: a.id, estado: "pendente", permissoes: PERMISSOES_PADRAO,
      criada_em: agora().toISOString(), expira_em: new Date(t + HORAS_PEDIDO * 3600_000).toISOString(), versao: 1,
    };
    await db.query(`INSERT INTO ligacoes (id, empresa_id, contabilista_id, estado, permissoes, criada_em, expira_em, atualizada_em, versao) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$6,$8)`,
      [l.id, l.empresa_id, l.contabilista_id, l.estado, JSON.stringify(l.permissoes), l.criada_em, l.expira_em, l.versao]);
    await publicar(db, hub, e.id, "ligacao.pedida", "contabilista", { ligacaoId: l.id, contabilista: { nome: cc.nome, numeroOCC: cc.numero_occ } }, a.id);
    return reply.code(201).send(ligacaoDe(l, info));
  });

  app.get("/v1/ligacoes", async (req) => {
    const a = ator(req);
    await expirarPendentes();
    if (a.papel === "empresa") {
      const ls = await db.query<LinhaLig & { cc_nome: string; cc_occ: string }>(
        `SELECT l.*, c.nome AS cc_nome, c.numero_occ AS cc_occ FROM ligacoes l JOIN contabilistas c ON c.id = l.contabilista_id WHERE l.empresa_id = $1 ORDER BY l.criada_em DESC`, [a.id]);
      return ls.map((l) => ligacaoDe(l, { contabilista: { nome: l.cc_nome, numeroOCC: l.cc_occ } }));
    }
    const ls = await db.query<LinhaLig & { e_nome: string; e_nif: string; e_user: string }>(
      `SELECT l.*, e.nome AS e_nome, e.nif AS e_nif, e.utilizador AS e_user FROM ligacoes l JOIN empresas e ON e.id = l.empresa_id WHERE l.contabilista_id = $1 ORDER BY l.criada_em DESC`, [a.id]);
    return ls.map((l) => ligacaoDe(l, { empresa: { nome: l.e_nome, nif: l.e_nif, utilizador: l.e_user } }));
  });

  const mudarEstado = async (req: FastifyRequest, para: "ativa" | "recusada" | "revogada") => {
    const a = ator(req);
    const { versao } = z.object({ versao: z.number().int() }).parse(req.body ?? {});
    await expirarPendentes();
    const [l] = await db.query<LinhaLig>(`SELECT * FROM ligacoes WHERE id = $1`, [params(req).id]);
    const dono = l && (a.papel === "empresa" ? l.empresa_id === a.id : l.contabilista_id === a.id);
    if (!dono) throw new ErroApp("nao_encontrada", "Ligação não encontrada.", 404);
    if (para !== "revogada") {
      exigirPapel(a, "empresa");
      if (l.estado === "expirada") throw new ErroApp("expirada", "Este pedido expirou. Peça ao contabilista para enviar outro.", 410);
      if (l.estado !== "pendente") throw new ErroApp("estado_invalido", `O pedido já está ${l.estado}.`, 409);
    } else if (l.estado !== "ativa" && l.estado !== "pendente") {
      return ligacaoDe(l);
    }
    const [n] = await db.query<LinhaLig>(`UPDATE ligacoes SET estado = $1, versao = versao + 1, atualizada_em = $2 WHERE id = $3 AND versao = $4 RETURNING *`,
      [para, agoraISO(), l.id, versao]);
    if (!n) throw new ErroApp("conflito_versao", "Os dados mudaram entretanto. Atualize e tente de novo.", 409);
    if (para === "ativa") hub.ligarContabilista(l.contabilista_id, l.empresa_id);
    const tipo = { ativa: "ligacao.aceite", recusada: "ligacao.recusada", revogada: "ligacao.revogada" }[para];
    await publicar(db, hub, l.empresa_id, tipo, a.papel, { ligacaoId: l.id }, l.contabilista_id);
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
  type LinhaDoc = { id: string; empresa_id: string; tipo: string; terceiro_nif: string; terceiro_nome: string; numero: string; atcud: string; data: string; base: string; iva: string; total: string; taxa: string; espaco_fiscal: string; estado: string; conta_sugerida: string; categoria: string; iva_dedutivel: boolean; origem: string; criado_em: string };
  const docDe = (d: LinhaDoc): Documento => ({
    id: d.id, empresaId: d.empresa_id, tipo: d.tipo as Documento["tipo"], terceiroNif: d.terceiro_nif, terceiroNome: d.terceiro_nome, numero: d.numero,
    atcud: d.atcud, data: d.data, base: Number(d.base), iva: Number(d.iva), total: Number(d.total), taxa: Number(d.taxa), espacoFiscal: d.espaco_fiscal,
    estado: d.estado as Documento["estado"], contaSugerida: d.conta_sugerida, categoria: d.categoria, ivaDedutivel: d.iva_dedutivel,
    origem: d.origem as Documento["origem"], criadoEm: d.criado_em,
  });

  app.get("/v1/empresas/:id/documentos", async (req) => {
    const id = params(req).id;
    await exigirAcesso(db, ator(req), id);
    const periodo = (req.query as { periodo?: string }).periodo;
    const rows = await db.query<LinhaDoc>(
      `SELECT * FROM documentos WHERE empresa_id = $1 ${periodo ? "AND data LIKE $2" : ""} ORDER BY data DESC, criado_em DESC`,
      periodo ? [id, `${periodo}%`] : [id]);
    return rows.map(docDe);
  });

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
    const cl = await classificar(db, id, d.tipo, d.terceiroNif, `${d.terceiroNome} ${String(corpo.descricao ?? "")}`);
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
    return reply.code(201).send(novo);
  });

  app.post("/v1/empresas/:id/documentos/:doc/validar", async (req) => {
    const a = ator(req);
    const { id, doc } = params(req);
    await exigirAcesso(db, a, id);
    const b = z.object({ contaSugerida: z.string().regex(/^\d{2,8}$/).optional(), ivaDedutivel: z.boolean().optional(), terceiroNome: z.string().optional() }).parse(req.body ?? {});
    const [d0] = await db.query<LinhaDoc>(`SELECT * FROM documentos WHERE id = $1 AND empresa_id = $2`, [doc, id]);
    if (!d0) throw new ErroApp("nao_encontrado", "Documento não encontrado.", 404);
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
