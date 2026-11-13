import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import estatico from "@fastify/static";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { z, ZodError } from "zod";
import {
  apoiosCompativeis, CATALOGO_BASE, erroCAE, normalizarCAE, seccaoDoCAE, validarCatalogo, type ApoioCompativel, type Catalogo, type Dimensao, type PedidoEstudo, type PerfilApoios,
  ajudaNIF, lerQR, telefoneInternacional, limparNIF, normalizarUtilizador, proximasObrigacoes, qrConsistente, REGRAS_BASE, taxasEm, utilizadorValido, validarNIF,
  type Anexo, type Atividade, type RegraFornecedor, type Colaborador, type Documento, type MovimentoBancario, type Empresa, type Ligacao, type Pedido, type Regras, type ResumoEmpresa, type Sessao, type VerificacaoFecho,
} from "@contabia/shared";
import type { Db } from "./db.ts";
import {
  agoraISO, ator, criarTokens, ErroApp, exigirAcesso, exigirGestor, exigirPapel, hashSenha, novoId, PERMISSOES_PADRAO, verificarSenha, type Ator,
} from "./comum.ts";
import { Hub, eventosDesde, publicar } from "./tempo-real.ts";
import {
  apurarIVA, aprender, classificar, diarioDe, equilibrado, gerarSAFT, lancamentoDeLinha, mesesDoPeriodo, periodoIVADoMes, PLANO_SNC, proporLinhas, xmlDP,
} from "./contabilidade.ts";
import { perguntar } from "./assistente.ts";
import { sugerir, type DocConc } from "./conciliacao.ts";
import { criarPush, enviarExpo, type EnviarPush } from "./push.ts";
import { criarAutomacoes, type EnviarWebhook } from "./automacoes.ts";
import { criarWhatsApp, type CfgWhatsApp } from "./whatsapp.ts";
import { criarRegisto, mascararEmail } from "./registo.ts";
import { ACOES_SERVICOS, rotasServicos } from "./servicos.ts";
import { criarEnvioEmail, emailPedidoEstudo, emailRecuperacao, type EnviarEmail } from "./email.ts";
import { randomBytes } from "node:crypto";

export interface Config {
  segredoJWT: string;
  tokenAdmin?: string;
  chaveIA?: string;
  agora?: () => Date;
  /** Pasta com as builds web das apps (web/empresa e web/contabilista). */
  pastaWeb?: string;
  /** Envio de avisos push (por omissão, o serviço da Expo; nos testes, um falso). */
  enviarPush?: EnviarPush;
  /** Envio de e-mails (por omissão, Brevo com BREVO_API_KEY; nos testes, um falso). */
  enviarEmail?: EnviarEmail;
  /** Endereço público do site, para as ligações nos e-mails. */
  urlPublico?: string;
  /** Catálogo de apoios de partida (por omissão, o do código; nos testes, uma cópia fixa). */
  catalogoBase?: Catalogo;
  /** Caixa da equipa que recebe os pedidos de estudo de viabilidade económica. */
  emailEstudos?: string;
  /** Automação externa (Activepieces): recebe eventos assinados com HMAC-SHA256. */
  automacaoUrl?: string;
  automacaoSegredo?: string;
  enviarWebhook?: EnviarWebhook;
  /** WhatsApp Business Platform (número oficial da Contabia). Por omissão, lê WHATSAPP_* do ambiente. */
  whatsapp?: CfgWhatsApp;
  /** Verificar os prazos e enviar avisos todos os dias às 9h de Lisboa. */
  agendarAvisosPrazos?: boolean;
}

const HORAS_PEDIDO = 72;
const MAX_PEDIDOS_HORA = 5;

export async function criarApp(db: Db, cfg: Config): Promise<{ app: FastifyInstance; hub: Hub }> {
  const app = Fastify({ logger: false, trustProxy: true });
  const hub = new Hub();
  const tokens = criarTokens(cfg.segredoJWT);
  const push = criarPush(db, cfg.enviarPush ?? enviarExpo);
  const agora = cfg.agora ?? (() => new Date());
  const hojeISO = () => agora().toISOString().slice(0, 10);
  const registo = criarRegisto(db, agora);
  const wa = criarWhatsApp(db, cfg.whatsapp ?? {
    token: process.env.WHATSAPP_TOKEN, numeroId: process.env.WHATSAPP_NUMERO_ID,
    segredoApp: process.env.WHATSAPP_APP_SEGREDO, tokenVerificar: process.env.WHATSAPP_VERIFICAR,
  }, agora, (empresaId, acao, detalhe) => registo.registar({ empresaId, quem: "Contabia (automático)", papel: "sistema", acao, rota: "whatsapp", detalhe }));
  // As automações precisam do catálogo de apoios e do envio de e-mail, definidos mais abaixo: ficam ligadas no fim.
  let auto: ReturnType<typeof criarAutomacoes> | null = null;
  hub.aoPublicar = (e, cc) => {
    void push.aoEvento(e, cc).catch(() => undefined);
    if (!auto) return;
    void auto.aoEvento(e).catch((x) => console.warn("[avisos]", x));
    if (e.tipo === "ligacao.pedida" && (e.dados as { iniciadaPor?: string }).iniciadaPor === "empresa" && cc) void auto.avisarConvite(cc, e.empresaId).catch(() => undefined);
    if (e.tipo === "pedido.criado") {
      const d = e.dados as { pedidoId?: string; tipo?: string; detalhe?: string };
      void (async () => {
        const [x] = await db.query<{ nome: string; contacto_nome: string | null }>(`SELECT nome, contacto_nome FROM empresas WHERE id = $1`, [e.empresaId]);
        if (x) await wa.lembrete(`pedido:${d.pedidoId}`, e.empresaId, "pedido_documento", [x.contacto_nome?.split(" ")[0] ?? x.nome, `${d.tipo ?? "um documento"}${d.detalhe ? ` (${d.detalhe})` : ""}`]);
      })().catch(() => undefined);
    }
  };
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
    const [existe] = await db.query<{ senha_mudada_em: string | null }>(a.papel === "empresa" ? `SELECT senha_mudada_em FROM empresas WHERE id = $1` : `SELECT senha_mudada_em FROM contabilistas WHERE id = $1`, [a.id]);
    if (!existe) throw new ErroApp("sessao_invalida", "A sua sessão terminou. Entre novamente.", 401);
    // um colaborador desativado pelo gestor sai logo, em todos os dispositivos
    const [colab] = a.colaboradorId ? await db.query<{ senha_mudada_em: string | null }>(`SELECT senha_mudada_em FROM colaboradores WHERE id = $1 AND empresa_id = $2 AND ativo`, [a.colaboradorId, a.id]) : [];
    if (a.colaboradorId && !colab) throw new ErroApp("sessao_invalida", "O seu acesso a esta empresa foi desativado pelo gestor.", 401);
    // senha mudada (ex.: recuperada por e-mail): as sessões antigas terminam em todos os aparelhos
    const mudada = a.colaboradorId ? colab?.senha_mudada_em : existe.senha_mudada_em;
    if (mudada && a.emitidoEm * 1000 < Date.parse(mudada) - 1000) throw new ErroApp("sessao_invalida", "A senha foi alterada. Entre novamente com a nova senha.", 401);
    const { emitidoEm, ...semData } = a;
    (req as FastifyRequest & { ator?: Ator }).ator = semData;
    // Sessão deslizante: quem usa a app pelo menos uma vez por mês nunca é posto fora.
    if (h && Date.now() / 1000 - emitidoEm > 24 * 3600) reply.header("x-contabia-token", await tokens.emitir(semData));
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
    const [e] = await db.query<{ id: string; utilizador: string; nif: string; nome: string; regiao: string; regime_iva: string; email: string | null; cae: string | null; caes_secundarios: string[] | null; dimensao: string | null; telefone: string | null; contacto_nome: string | null; emails_dicas: boolean; whatsapp_consentimento_em: string | null }>(
      `SELECT id, utilizador, nif, nome, regiao, regime_iva, email, cae, caes_secundarios, dimensao, telefone, contacto_nome, emails_dicas, whatsapp_consentimento_em FROM empresas WHERE id = $1`, [id]);
    if (!e) throw new ErroApp("nao_encontrada", "Empresa não encontrada.", 404);
    return { id: e.id, utilizador: e.utilizador, nif: e.nif, nome: e.nome, regiao: e.regiao as Empresa["regiao"], regimeIVA: e.regime_iva as Empresa["regimeIVA"], email: e.email,
      cae: e.cae, caesSecundarios: e.caes_secundarios ?? [], dimensao: (e.dimensao as Dimensao | null) ?? null,
      telefone: e.telefone, contactoNome: e.contacto_nome, emailsDicas: e.emails_dicas, whatsappLembretes: !!e.whatsapp_consentimento_em };
  };
  const regrasAtuais = async (): Promise<Regras> => {
    const [r] = await db.query<{ regras: Regras }>(`SELECT regras FROM regras_versoes ORDER BY publicada_em DESC LIMIT 1`);
    return r?.regras ?? REGRAS_BASE;
  };
  const sessao = async (a: Ator): Promise<Sessao> => ({
    token: await tokens.emitir(a), papel: a.papel, id: a.id, nome: a.nome,
    ...(a.papel === "empresa" ? { perfil: a.perfil ?? "gestor" } : {}), ...(a.quem ? { quem: a.quem } : {}),
  });
  const params = (req: FastifyRequest) => req.params as Record<string, string>;

  // ═════════════ Autenticação ═════════════
  app.post("/v1/auth/empresas", async (req, reply) => {
    const b = z.object({
      utilizador: z.string(), nif: z.string(), nome: z.string().min(2), senha: z.string().min(8),
      regiao: z.enum(["PT", "PT-MA", "PT-AC"]), regimeIVA: z.enum(["mensal", "trimestral"]),
      email: z.string().trim().toLowerCase().email("O e-mail não parece válido.").optional(),
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
    await db.query(`INSERT INTO empresas (id, utilizador, nif, nome, regiao, regime_iva, senha_hash, criada_em, email) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, utilizador, nif, b.nome, b.regiao, b.regimeIVA, await hashSenha(b.senha), agoraISO(), b.email ?? null]);
    void auto?.boasVindasEmpresa(id).catch(() => false);
    void auto?.emitir("empresa.registada", id, { regiao: b.regiao }).catch(() => false);
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
    void auto?.boasVindasContabilista(id).catch(() => false);
    void auto?.emitir("contabilista.registado", null, { contabilistaId: id, nome: b.nome }).catch(() => false);
    return reply.code(201).send(await sessao({ papel: "contabilista", id, nome: b.nome }));
  });

  // ── Proteção contra adivinhar senhas: 5 erros por conta em 15 min, 20 por endereço IP ──
  const falhas = new Map<string, number[]>();
  const JANELA = 15 * 60 * 1000;
  const recentes = (k: string) => (falhas.get(k) ?? []).filter((t) => Date.now() - t < JANELA);
  function verificarTentativas(chaves: [string, number][]) {
    for (const [k, max] of chaves) {
      const r = recentes(k);
      if (r.length >= max) {
        const min = Math.max(1, Math.ceil((JANELA - (Date.now() - r[0])) / 60000));
        throw new ErroApp("demasiadas_tentativas", `Demasiadas tentativas erradas. Por segurança, tente de novo dentro de ${min} ${min === 1 ? "minuto" : "minutos"} ou recupere a senha.`, 429);
      }
    }
  }
  const registarFalha = (...ks: string[]) => { for (const k of ks) falhas.set(k, [...recentes(k), Date.now()]); };

  app.post("/v1/auth/sessoes", async (req) => {
    const b = z.object({ papel: z.enum(["empresa", "contabilista"]), identificador: z.string(), senha: z.string() }).parse(req.body);
    const kConta = `conta:${b.papel}:${b.identificador.trim().toLowerCase()}`;
    const kIP = `ip:${req.ip}`;
    verificarTentativas([[kConta, 5], [kIP, 20]]);
    try {
      return await entrarCom(b);
    } catch (e) {
      if (e instanceof ErroApp && e.codigo === "credenciais") registarFalha(kConta, kIP);
      throw e;
    }
  });
  async function entrarCom(b: { papel: "empresa" | "contabilista"; identificador: string; senha: string }): Promise<Sessao> {
    if (b.papel === "empresa" && b.identificador.includes("@")) {
      // colaborador: entra com o próprio e-mail
      const [c] = await db.query<{ id: string; nome: string; senha_hash: string; ativo: boolean; empresa_id: string; e_nome: string }>(
        `SELECT c.id, c.nome, c.senha_hash, c.ativo, c.empresa_id, e.nome AS e_nome FROM colaboradores c JOIN empresas e ON e.id = c.empresa_id WHERE c.email = $1`, [b.identificador.trim().toLowerCase()]);
      if (!c || !(await verificarSenha(b.senha, c.senha_hash))) throw new ErroApp("credenciais", "E-mail ou senha incorretos.", 401);
      if (!c.ativo) throw new ErroApp("desativado", "O seu acesso foi desativado pelo gestor da empresa.", 403);
      return sessao({ papel: "empresa", id: c.empresa_id, nome: c.e_nome, colaboradorId: c.id, perfil: "colaborador", quem: c.nome });
    }
    const sql = b.papel === "empresa"
      ? `SELECT id, nome, senha_hash FROM empresas WHERE utilizador = $1`
      : `SELECT id, nome, senha_hash FROM contabilistas WHERE email = $1`;
    const ident = b.papel === "empresa" ? normalizarUtilizador(b.identificador) : b.identificador.trim().toLowerCase();
    const [u] = await db.query<{ id: string; nome: string; senha_hash: string }>(sql, [ident]);
    if (!u || !(await verificarSenha(b.senha, u.senha_hash))) throw new ErroApp("credenciais", "Utilizador ou senha incorretos.", 401);
    return sessao({ papel: b.papel, id: u.id, nome: u.nome });
  }


  // ── Recuperar a senha por e-mail ──
  const envioBase = cfg.enviarEmail ?? criarEnvioEmail();
  /** Cada e-mail que a Contabia envia fica no registo (endereço mascarado, só o assunto). */
  const enviarEmail: EnviarEmail = async (m) => {
    const ok = await envioBase(m);
    await registo.registar({ quem: "Contabia (automático)", papel: "sistema", acao: ok ? "enviou um e-mail" : "tentou enviar um e-mail sem sucesso",
      rota: "e-mail", detalhe: { para: mascararEmail(m.para), assunto: m.assunto } }).catch(() => undefined);
    return ok;
  };
  // endereço das ligações nos e-mails: o configurado, ou o próprio endereço por onde o pedido chegou
  const urlPublicoDe = (req: FastifyRequest) => (cfg.urlPublico ?? process.env.URL_PUBLICO ?? `${req.protocol}://${req.host}`).replace(/\/$/, "");
  const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
  const MENSAGEM_RECUPERAR = "Se existir uma conta com esses dados e um e-mail associado, enviámos uma ligação para criar uma nova senha. Veja também a pasta de spam.";

  app.post("/v1/auth/recuperar", async (req) => {
    const b = z.object({ papel: z.enum(["empresa", "contabilista"]), identificador: z.string().trim().min(1) }).parse(req.body);
    const ident = b.identificador.toLowerCase();
    verificarTentativas([[`recuperar:${ident}`, 3], [`ip:${req.ip}`, 20]]);
    registarFalha(`recuperar:${ident}`); // conta como tentativa para limitar abusos
    let alvo: { conta: string; colab: string | null; email: string; nome: string } | null = null;
    if (b.papel === "contabilista") {
      const [c] = await db.query<{ id: string; email: string; nome: string }>(`SELECT id, email, nome FROM contabilistas WHERE email = $1`, [ident]);
      if (c) alvo = { conta: c.id, colab: null, email: c.email, nome: c.nome };
    } else {
      const [c] = await db.query<{ id: string; empresa_id: string; email: string; nome: string }>(`SELECT id, empresa_id, email, nome FROM colaboradores WHERE email = $1 AND ativo`, [ident]);
      if (c) alvo = { conta: c.empresa_id, colab: c.id, email: c.email, nome: c.nome };
      else {
        const [e] = await db.query<{ id: string; email: string | null; nome: string }>(`SELECT id, email, nome FROM empresas WHERE utilizador = $1 OR email = $2`, [normalizarUtilizador(ident), ident]);
        if (e?.email) alvo = { conta: e.id, colab: null, email: e.email, nome: e.nome };
      }
    }
    if (alvo) {
      const token = randomBytes(32).toString("base64url");
      await db.query(`INSERT INTO recuperacoes (hash, papel, conta_id, colaborador_id, expira_em) VALUES ($1,$2,$3,$4,$5)`,
        [hashToken(token), b.papel, alvo.conta, alvo.colab, new Date(Date.now() + 60 * 60 * 1000).toISOString()]);
      const ligacao = `${urlPublicoDe(req)}/${b.papel === "empresa" ? "empresa" : "contabilista"}/redefinir?token=${token}`;
      await enviarEmail({ para: alvo.email, nome: alvo.nome, ...emailRecuperacao(alvo.nome, ligacao) });
    }
    // a mesma resposta exista ou não a conta: não se revela quem está registado
    return { ok: true, mensagem: MENSAGEM_RECUPERAR };
  });

  app.post("/v1/auth/redefinir", async (req) => {
    const b = z.object({ token: z.string().min(20), senha: z.string().min(8, "A senha deve ter pelo menos 8 caracteres.") }).parse(req.body);
    const [r] = await db.query<{ hash: string; papel: string; conta_id: string; colaborador_id: string | null; expira_em: string; usada: boolean }>(
      `SELECT * FROM recuperacoes WHERE hash = $1`, [hashToken(b.token)]);
    if (!r || r.usada || Date.parse(r.expira_em) < Date.now())
      throw new ErroApp("ligacao_invalida", "Esta ligação já foi usada ou expirou. Peça uma nova em «Esqueci-me da senha».", 400);
    const hash = await hashSenha(b.senha);
    const agoraTxt = new Date().toISOString();
    if (r.colaborador_id) await db.query(`UPDATE colaboradores SET senha_hash = $1, senha_mudada_em = $2 WHERE id = $3`, [hash, agoraTxt, r.colaborador_id]);
    else if (r.papel === "empresa") await db.query(`UPDATE empresas SET senha_hash = $1, senha_mudada_em = $2 WHERE id = $3`, [hash, agoraTxt, r.conta_id]);
    else await db.query(`UPDATE contabilistas SET senha_hash = $1, senha_mudada_em = $2 WHERE id = $3`, [hash, agoraTxt, r.conta_id]);
    await db.query(`UPDATE recuperacoes SET usada = true WHERE hash = $1`, [r.hash]);
    // quem acabou de provar que é dono do e-mail pode entrar já, sem esperar pelo desbloqueio
    const idents = r.colaborador_id
      ? await db.query<{ i: string }>(`SELECT email AS i FROM colaboradores WHERE id = $1`, [r.colaborador_id])
      : r.papel === "empresa"
        ? await db.query<{ i: string }>(`SELECT utilizador AS i FROM empresas WHERE id = $1 UNION SELECT email FROM empresas WHERE id = $1 AND email IS NOT NULL`, [r.conta_id])
        : await db.query<{ i: string }>(`SELECT email AS i FROM contabilistas WHERE id = $1`, [r.conta_id]);
    for (const { i } of idents) falhas.delete(`conta:${r.papel}:${i.toLowerCase()}`);
    return { ok: true, mensagem: "Nova senha guardada. Já pode entrar." };
  });

  /** O gestor da empresa define ou muda o e-mail de recuperação. */
  app.put("/v1/auth/email", async (req) => {
    const a = ator(req);
    if (a.papel !== "empresa") throw new ErroApp("sem_acesso", "Só para empresas.", 403);
    exigirGestor(a);
    const b = z.object({ email: z.string().trim().toLowerCase().email("O e-mail não parece válido.") }).parse(req.body);
    await db.query(`UPDATE empresas SET email = $1 WHERE id = $2`, [b.email, a.id]);
    void auto?.boasVindasEmpresa(a.id).catch(() => false); // só sai uma vez por empresa
    return empresaPorId(a.id);
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
    exigirGestor(a);
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
    exigirGestor(a);
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
    exigirGestor(a);
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
    // a regra do contabilista para este fornecedor manda sobre a escolha da empresa
    const [regra] = d0.tipo === "venda" ? [] : await db.query<{ conta: string; iva_dedutivel: boolean; auto_lancar: boolean }>(
      `SELECT conta, iva_dedutivel, auto_lancar FROM regras_fornecedor WHERE empresa_id = $1 AND nif = $2 AND removida_em IS NULL`, [id, d0.terceiro_nif]);
    const [d1] = await db.query<LinhaDoc>(
      `UPDATE documentos SET estado = 'validado', conta_sugerida = COALESCE($1, conta_sugerida), iva_dedutivel = COALESCE($2, iva_dedutivel), terceiro_nome = COALESCE($3, terceiro_nome) WHERE id = $4 RETURNING *`,
      [regra?.conta ?? b.contaSugerida ?? null, regra?.iva_dedutivel ?? b.ivaDedutivel ?? null, b.terceiroNome ?? null, doc]);
    const d = docDe(d1);
    if (d.tipo !== "venda" && !regra) await aprender(db, id, d.terceiroNif, d.contaSugerida);
    const [ja] = await db.query(`SELECT 1 FROM lancamentos WHERE documento_id = $1 AND estado IN ('proposto','lancado')`, [doc]);
    if (!ja) {
      const cl = regra || b.contaSugerida ? { confianca: "alta" as const } : await classificar(db, id, d.tipo, d.terceiroNif, d.terceiroNome);
      const linhas = proporLinhas(d);
      const lid = novoId();
      await db.query(
        `INSERT INTO lancamentos (id, empresa_id, documento_id, diario, data, periodo, descricao, linhas, estado, confianca, versao, criado_em) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'proposto',$9,1,$10)`,
        [lid, id, doc, diarioDe(d.tipo), d.data, d.data.slice(0, 7), `${d.numero} · ${d.terceiroNome}`, JSON.stringify(linhas), cl.confianca, agoraISO()]);
      await publicar(db, hub, id, "lancamento.proposto", "sistema", { documentoId: doc });
      if (regra?.auto_lancar) {
        // o contabilista disse que este fornecedor se lança sozinho; se o período estiver fechado, fica para revisão
        const [l] = await db.query<LinhaLanc>(`SELECT * FROM lancamentos WHERE id = $1`, [lid]);
        try {
          await aprovar(id, l, 1);
          await publicar(db, hub, id, "lancamento.lancado", "sistema", { lancamentoId: lid, regra: true });
        } catch { /* fica proposto */ }
      }
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
    exigirGestor(a);
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
    exigirGestor(a);
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
    exigirGestor(a);
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

  // ═════════════ Utilizadores da empresa e registo de atividade ═════════════
  const exigirMesmaEmpresa = (a: Ator, id: string) => {
    if (a.papel !== "empresa" || a.id !== id) throw new ErroApp("sem_acesso", "Sem acesso.", 403);
    exigirGestor(a);
  };
  type LinhaColab = { id: string; nome: string; email: string; ativo: boolean; criado_em: string };
  const colabDe = (c: LinhaColab): Colaborador => ({ id: c.id, nome: c.nome, email: c.email, ativo: c.ativo, criadoEm: c.criado_em });
  app.get("/v1/empresas/:id/colaboradores", async (req) => {
    const id = params(req).id;
    exigirMesmaEmpresa(ator(req), id);
    return (await db.query<LinhaColab>(`SELECT id, nome, email, ativo, criado_em FROM colaboradores WHERE empresa_id = $1 ORDER BY ativo DESC, nome`, [id])).map(colabDe);
  });
  app.post("/v1/empresas/:id/colaboradores", async (req, reply) => {
    const id = params(req).id;
    exigirMesmaEmpresa(ator(req), id);
    const b = z.object({ nome: z.string().trim().min(2), email: z.string().trim().toLowerCase().email(), senha: z.string().min(8) }).parse(req.body);
    const [ja] = await db.query(`SELECT 1 FROM colaboradores WHERE email = $1 UNION SELECT 1 FROM contabilistas WHERE email = $1`, [b.email]);
    if (ja) throw new ErroApp("email_existe", "Já existe uma conta com este e-mail.", 409);
    const c: LinhaColab = { id: novoId(), nome: b.nome, email: b.email, ativo: true, criado_em: agoraISO() };
    await db.query(`INSERT INTO colaboradores (id, empresa_id, nome, email, senha_hash, ativo, criado_em) VALUES ($1,$2,$3,$4,$5,true,$6)`,
      [c.id, id, c.nome, c.email, await hashSenha(b.senha), c.criado_em]);
    return reply.code(201).send(colabDe(c));
  });
  for (const [acao, ativo] of [["desativar", false], ["ativar", true]] as const) {
    app.post(`/v1/empresas/:id/colaboradores/:cid/${acao}`, async (req) => {
      const { id, cid } = params(req);
      exigirMesmaEmpresa(ator(req), id);
      const [c] = await db.query<LinhaColab>(`UPDATE colaboradores SET ativo = $1 WHERE id = $2 AND empresa_id = $3 RETURNING id, nome, email, ativo, criado_em`, [ativo, cid, id]);
      if (!c) throw new ErroApp("nao_encontrado", "Utilizador não encontrado.", 404);
      return colabDe(c);
    });
  }
  app.get("/v1/empresas/:id/atividade", async (req) => {
    const a = ator(req);
    const id = params(req).id;
    await exigirAcesso(db, a, id);
    exigirGestor(a);
    await registo.pronto();
    const r = await db.query<{ quem: string; papel: string; acao: string; em: string }>(`SELECT quem, papel, acao, em FROM atividade WHERE empresa_id = $1 ORDER BY seq DESC LIMIT 200`, [id]);
    return r.map((x): Atividade => ({ quem: x.quem, papel: x.papel as Atividade["papel"], acao: x.acao, em: x.em }));
  });
  /** Registo completo da empresa em CSV (Excel), com o detalhe e a impressão digital de cada entrada. */
  app.get("/v1/empresas/:id/atividade.csv", async (req, reply) => {
    const a = ator(req);
    const id = params(req).id;
    await exigirAcesso(db, a, id);
    exigirGestor(a);
    await registo.pronto();
    const rs = await db.query<{ seq: number; em: string; quem: string; papel: string; acao: string; detalhe: string | null; ip: string | null; hash: string | null }>(
      `SELECT seq, em, quem, papel, acao, detalhe, ip, hash FROM atividade WHERE empresa_id = $1 ORDER BY seq`, [id]);
    const c = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const linhas = ["N.º;Data e hora (UTC);Quem;Papel;Ação;Detalhe;Endereço;Impressão digital", ...rs.map((r) => [r.seq, r.em, r.quem, r.papel, r.acao, r.detalhe, r.ip, r.hash].map(c).join(";"))];
    return reply.type("text/csv; charset=utf-8").header("content-disposition", `attachment; filename="registo-atividade-${id}.csv"`).send("\uFEFF" + linhas.join("\r\n"));
  });

  /** O que cada pedido bem-sucedido significa, em português, para o registo de atividade. */
  const ACOES: Record<string, string | ((a: Ator) => string)> = {
    "POST /v1/empresas/:id/documentos": "registou um documento",
    "POST /v1/empresas/:id/documentos/importar": "importou faturas do e-Fatura",
    "POST /v1/empresas/:id/documentos/:doc/validar": "validou um documento",
    "POST /v1/empresas/:id/documentos/:doc/anexos": "guardou o original de uma fatura",
    "POST /v1/empresas/:id/documentos/:doc/anulacao": (a) => (a.papel === "contabilista" ? "anulou um documento" : "pediu a anulação de um documento"),
    "POST /v1/empresas/:id/documentos/:doc/anulacao/aprovar": "aprovou a anulação de um documento",
    "POST /v1/empresas/:id/documentos/:doc/anulacao/recusar": "manteve um documento (anulação recusada)",
    "POST /v1/empresas/:id/banco/importar": "importou o extrato do banco",
    "POST /v1/empresas/:id/banco/movimentos/:mid/conciliar": "conciliou um movimento do banco",
    "POST /v1/empresas/:id/banco/conciliar-automatico": "conciliou movimentos do banco",
    "POST /v1/empresas/:id/banco/movimentos/:mid/desfazer": "desfez uma conciliação",
    "POST /v1/empresas/:id/banco/movimentos/:mid/pedir-fatura": "pediu uma fatura em falta",
    "POST /v1/empresas/:id/banco/movimentos/:mid/ignorar": "ignorou um movimento do banco",
    "POST /v1/empresas/:id/pedidos": "pediu um documento à empresa",
    "POST /v1/empresas/:id/pedidos/:pid/recebido": "marcou um pedido como enviado",
    "POST /v1/empresas/:id/lancamentos/:lid/aprovar": "aprovou um lançamento",
    "POST /v1/empresas/:id/lancamentos/aprovar-confianca-alta": "aprovou lançamentos de confiança alta",
    "POST /v1/empresas/:id/lancamentos/:lid/estornar": "estornou um lançamento",
    "POST /v1/empresas/:id/iva/:periodo/submissao": "registou a submissão do IVA",
    "POST /v1/empresas/:id/periodos/:periodo/fechar": "fechou um período",
    "POST /v1/empresas/:id/saft/:ano": "gerou o ficheiro SAF-T",
    "POST /v1/empresas/:id/colaboradores": "adicionou um utilizador",
    "PUT /v1/empresas/:id/regras-fornecedor/:nif": "definiu uma regra para um fornecedor",
    "DELETE /v1/empresas/:id/regras-fornecedor/:nif": "removeu uma regra de fornecedor",
    "POST /v1/empresas/:id/colaboradores/:cid/desativar": "desativou um utilizador",
    "POST /v1/empresas/:id/colaboradores/:cid/ativar": "reativou um utilizador",
    "PUT /v1/empresas/:id/perfil-apoios": "atualizou o CAE e a dimensão da empresa",
    "POST /v1/empresas/:id/estudos": "pediu um estudo de viabilidade económica",
    "DELETE /v1/ligacoes/:id": "revogou a ligação entre empresa e contabilista",
    "POST /v1/ligacoes": "pediu uma ligação entre empresa e contabilista",
    "POST /v1/ligacoes/:id/aceitar": "aceitou a ligação entre empresa e contabilista",
    "POST /v1/ligacoes/:id/recusar": "recusou a ligação entre empresa e contabilista",
    "POST /v1/empresas/:id/assistente": "fez uma pergunta ao Luís",
    "POST /v1/empresas/:id/iva/:periodo/ficheiro": "gerou o ficheiro da declaração periódica de IVA",
    "PUT /v1/empresas/:id/contacto": "atualizou o contacto da empresa",
    "PUT /v1/empresas/:id/preferencias-email": "mudou as preferências de e-mail",
    "PUT /v1/empresas/:id/whatsapp": (a) => "mudou o consentimento para lembretes por WhatsApp",
    "PUT /v1/auth/email": "atualizou o e-mail da conta",
    "PUT /v1/contabilista/preferencias": "mudou as preferências do resumo diário",
    "POST /v1/contabilista/avisos/lidas": "marcou avisos como lidos",
    "POST /v1/dispositivos": "ativou as notificações num dispositivo",
    "POST /v1/dispositivos/remover": "desligou as notificações num dispositivo",
    "POST /v1/auth/empresas": "criou a conta da empresa",
    "POST /v1/auth/contabilistas": "criou a conta de contabilista",
    "POST /v1/auth/sessoes": "entrou na conta",
    "POST /v1/auth/recuperar": "pediu para recuperar a senha",
    "POST /v1/auth/redefinir": "definiu uma nova senha",
    "POST /v1/estudos/site": "pediu um estudo de viabilidade pelo site",
    "POST /v1/lista-espera": "inscreveu-se na lista de espera das apps",
    "POST /v1/admin/apoios": "publicou uma versão do catálogo de apoios",
    "POST /v1/admin/regras": "publicou uma versão das regras fiscais",
    "POST /v1/admin/avisos-prazos": "correu a rotina diária de avisos",
    "POST /v1/admin/estudos/:eid/estado": "mudou o estado de um pedido de estudo",
    // consultas que também ficam registadas: ver originais e exportar
    "GET /v1/empresas/:id/documentos/:doc/anexos/:aid": "abriu o original de um documento",
    "GET /v1/empresas/:id/atividade.csv": "exportou o registo de atividade",
    "GET /v1/contabilista/servicos/exportar": "exportou as horas da carteira",
    ...ACOES_SERVICOS,
  };
  /** Rotas GET que, por mexerem em originais ou exportações, ficam registadas. */
  const CONSULTAS_REGISTADAS = new Set(["GET /v1/empresas/:id/documentos/:doc/anexos/:aid", "GET /v1/empresas/:id/atividade.csv", "GET /v1/empresas/:id/servicos/exportar", "GET /v1/contabilista/servicos/exportar"]);

  // o id criado num registo de conta vem na resposta: guarda-se para o registo
  app.addHook("onSend", async (req, reply, payload) => {
    const r = req.routeOptions.url;
    if ((r === "/v1/auth/empresas" || r === "/v1/auth/contabilistas" || r === "/v1/auth/sessoes") && reply.statusCode < 300 && typeof payload === "string") {
      try { (req as FastifyRequest & { novaConta?: { id: string; papel: string; nome: string } }).novaConta = JSON.parse(payload); } catch { /* não é JSON */ }
    }
    return payload;
  });

  /**
   * Regista TUDO o que altera dados (e as consultas sensíveis acima), com detalhe sem segredos,
   * endereço e dispositivo. Também as tentativas de entrada falhadas.
   */
  app.addHook("onResponse", async (req, reply) => {
    if ((req as FastifyRequest & { repetido?: boolean }).repetido) return;
    const rota = req.routeOptions.url;
    if (!rota) return;
    const chave = `${req.method} ${rota}`;
    const consulta = req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS";
    if (consulta && !CONSULTAS_REGISTADAS.has(chave)) return;
    if (rota.startsWith("/v1/whatsapp/webhook")) return; // registado com mais contexto em aoWhatsApp
    if (chave === "POST /v1/empresas/:id/tempo" && reply.statusCode < 400) return; // medição de tempo: fica somada em tempo_trabalho, não é uma ação
    const corpo = req.body as Record<string, unknown> | undefined;
    const base = { rota: chave, ip: req.ip, agente: String(req.headers["user-agent"] ?? "") || null };
    const p = (req.params ?? {}) as Record<string, string>;
    const detalhe = (x: unknown) => {
      const { id: _id, ...outros } = p;
      const d: Record<string, unknown> = {};
      if (Object.keys(outros).length) d.ids = outros;
      if (x !== undefined && x !== null && !(typeof x === "object" && !Buffer.isBuffer(x) && !Object.keys(x as object).length)) d.dados = x;
      if (reply.statusCode >= 400) d.resultado = reply.statusCode;
      return Object.keys(d).length ? d : undefined;
    };

    // entradas falhadas e pedidos recusados por segurança
    if (reply.statusCode >= 400) {
      if (chave === "POST /v1/auth/sessoes" && (reply.statusCode === 401 || reply.statusCode === 429 || reply.statusCode === 403)) {
        await registo.registar({ ...base, quem: ((i) => (i.includes("@") ? mascararEmail(i)! : i))(String((corpo as { identificador?: string })?.identificador ?? "desconhecido")), papel: String((corpo as { papel?: string })?.papel ?? "visitante"),
          acao: reply.statusCode === 429 ? "foi bloqueado por excesso de tentativas de entrada" : "tentou entrar sem sucesso", detalhe: detalhe(undefined) });
      } else if (reply.statusCode === 403 && (req as FastifyRequest & { ator?: Ator }).ator) {
        const a = (req as FastifyRequest & { ator?: Ator }).ator!;
        await registo.registar({ ...base, empresaId: rota.startsWith("/v1/empresas/:id") ? p.id : null, contaId: a.colaboradorId ?? a.id, quem: a.quem ?? a.nome, papel: a.papel,
          acao: "tentou uma ação sem permissão", detalhe: detalhe(undefined) });
      }
      return;
    }

    const a = (req as FastifyRequest & { ator?: Ator }).ator;
    const nova = (req as FastifyRequest & { novaConta?: { id: string; papel: string; nome: string } }).novaConta;
    const texto = ACOES[chave];
    const acao = typeof texto === "function" ? (a ? texto(a) : "") : texto ?? `${req.method} ${rota}`;
    let empresaId: string | null = rota.startsWith("/v1/empresas/:id") ? p.id ?? null : a?.papel === "empresa" ? a.id : null;
    let contaId: string | null = a ? a.colaboradorId ?? a.id : null;
    let quem: string;
    let papel: string;
    if (a) {
      quem = a.papel === "contabilista" ? `${a.nome} (contabilista)` : a.quem ?? `${a.nome} (gestor)`;
      papel = a.papel;
    } else if (rota.startsWith("/v1/admin/")) {
      quem = "Administração Contabia"; papel = "admin";
    } else if (nova?.id) {
      quem = nova.nome ?? "nova conta"; papel = nova.papel ?? "visitante"; contaId = nova.id; if (nova.papel === "empresa") empresaId = nova.id;
    } else {
      quem = (corpo as { email?: string; identificador?: string })?.email ? String(mascararEmail(String((corpo as { email: string }).email))) : "visitante"; papel = "visitante";
    }
    await registo.registar({ ...base, empresaId, contaId, quem, papel, acao, detalhe: detalhe(Buffer.isBuffer(corpo) ? corpo : corpo) });
  });

  // ═════════════ Espaço de serviços e horas do contabilista ═════════════
  rotasServicos(app, db, agora, { aoPartilhar: async (empresaId, r) => { await auto?.relatorioTempo(empresaId, r); } });

  // ═════════════ Regras por fornecedor (do contabilista) ═════════════
  type LinhaRegra = { nif: string; nome: string; conta: string; iva_dedutivel: boolean; auto_lancar: boolean; criada_em: string };
  const regraDe = (r: LinhaRegra): RegraFornecedor => ({ nif: r.nif, nome: r.nome, conta: r.conta, categoria: PLANO_SNC[r.conta] ?? "Conta " + r.conta, ivaDedutivel: r.iva_dedutivel, autoLancar: r.auto_lancar, criadaEm: r.criada_em });
  app.get("/v1/empresas/:id/regras-fornecedor", async (req) => {
    const id = params(req).id;
    await exigirAcesso(db, ator(req), id);
    return (await db.query<LinhaRegra>(`SELECT * FROM regras_fornecedor WHERE empresa_id = $1 AND removida_em IS NULL ORDER BY nome`, [id])).map(regraDe);
  });
  app.put("/v1/empresas/:id/regras-fornecedor/:nif", async (req) => {
    const a = ator(req);
    const { id, nif } = params(req);
    exigirPapel(a, "contabilista");
    await exigirAcesso(db, a, id, "lancamentos.escrever");
    if (!validarNIF(nif)) throw new ErroApp("nif_invalido", "NIF do fornecedor inválido.");
    const b = z.object({ nome: z.string().trim().min(1), conta: z.string().regex(/^\d{2,8}$/), ivaDedutivel: z.boolean(), autoLancar: z.boolean().default(false) }).parse(req.body);
    if (!/^6|^2|^3|^4/.test(b.conta)) throw new ErroApp("conta_invalida", "Use uma conta de gastos (6x), de ativo (4x/3x) ou de terceiros (2x).");
    const [r] = await db.query<LinhaRegra>(
      `INSERT INTO regras_fornecedor (empresa_id, nif, nome, conta, iva_dedutivel, auto_lancar, criada_em) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (empresa_id, nif) DO UPDATE SET nome = $3, conta = $4, iva_dedutivel = $5, auto_lancar = $6, removida_em = NULL RETURNING *`,
      [id, nif, b.nome, b.conta, b.ivaDedutivel, b.autoLancar, agoraISO()]);
    // aplica já aos documentos deste fornecedor que ainda estão por validar
    await db.query(`UPDATE documentos SET conta_sugerida = $1, categoria = $2, iva_dedutivel = $3 WHERE empresa_id = $4 AND terceiro_nif = $5 AND estado IN ('validar','sem_anexo') AND tipo <> 'venda'`,
      [b.conta, PLANO_SNC[b.conta] ?? "Regra do contabilista", b.ivaDedutivel, id, nif]);
    await publicar(db, hub, id, "regra.atualizada", "contabilista", { nif });
    return regraDe(r);
  });
  app.delete("/v1/empresas/:id/regras-fornecedor/:nif", async (req) => {
    const a = ator(req);
    const { id, nif } = params(req);
    exigirPapel(a, "contabilista");
    await exigirAcesso(db, a, id, "lancamentos.escrever");
    // não se apaga: fica desativada, com data, e o registo guarda quem o fez
    await db.query(`UPDATE regras_fornecedor SET removida_em = $3 WHERE empresa_id = $1 AND nif = $2 AND removida_em IS NULL`, [id, nif, agoraISO()]);
    return { ok: true };
  });

  // ═════════════ Apoios europeus e estudos de viabilidade ═════════════
  const base = cfg.catalogoBase ?? CATALOGO_BASE;
  const catalogoAtual = async (): Promise<Catalogo> => {
    // Vale a versão mais recente: a publicada pelo administrador ou a que vem no código
    // (a revisão automática bissemanal atualiza o código e o Render publica sozinho).
    const [r] = await db.query<{ catalogo: Catalogo }>(`SELECT catalogo FROM apoios_versoes ORDER BY publicada_em DESC LIMIT 1`);
    return r && r.catalogo.versao > base.versao ? r.catalogo : base;
  };
  const perfilDe = (e: Empresa): PerfilApoios => ({ cae: e.cae ?? null, caesSecundarios: e.caesSecundarios ?? [], dimensao: e.dimensao ?? null, regiao: e.regiao });
  const zCAE = z.string().transform(normalizarCAE).superRefine((v, ctx) => {
    const erro = erroCAE(v);
    if (erro) ctx.addIssue({ code: "custom", message: erro });
  });
  app.get("/v1/empresas/:id/apoios", async (req) => {
    const id = params(req).id;
    await exigirAcesso(db, ator(req), id);
    const perfil = perfilDe(await empresaPorId(id));
    const cat = await catalogoAtual();
    return { perfil, apoios: apoiosCompativeis(perfil, cat, agora().toISOString()), verificadoEm: cat.verificadoEm };
  });
  app.put("/v1/empresas/:id/perfil-apoios", async (req) => {
    const a = ator(req);
    const id = params(req).id;
    await exigirAcesso(db, a, id);
    exigirGestor(a);
    const b = z.object({
      cae: zCAE,
      caesSecundarios: z.array(zCAE).max(20).default([]),
      dimensao: z.enum(["micro", "pequena", "media", "grande"]).nullable().default(null),
    }).parse(req.body);
    const sec = [...new Set(b.caesSecundarios.filter((c) => c !== b.cae))];
    await db.query(`UPDATE empresas SET cae = $1, caes_secundarios = $2::jsonb, dimensao = $3 WHERE id = $4`, [b.cae, JSON.stringify(sec), b.dimensao, id]);
    await publicar(db, hub, id, "empresa.atualizada", a.papel, { campo: "perfil-apoios" });
    return perfilDe(await empresaPorId(id));
  });

  type LinhaEstudo = { id: string; apoio_id: string | null; apoio_nome: string | null; nome: string; email: string; telefone: string | null; mensagem: string | null; estado: string; criado_em: string };
  const estudoDe = (r: LinhaEstudo): PedidoEstudo => ({ id: r.id, apoioId: r.apoio_id, apoioNome: r.apoio_nome, nome: r.nome, email: r.email, telefone: r.telefone, mensagem: r.mensagem, estado: r.estado as PedidoEstudo["estado"], criadoEm: r.criado_em });
  app.post("/v1/empresas/:id/estudos", async (req, reply) => {
    const a = ator(req);
    const id = params(req).id;
    exigirPapel(a, "empresa");
    await exigirAcesso(db, a, id);
    const b = z.object({
      apoioId: z.string().max(80).nullable().default(null),
      nome: z.string().trim().min(2, "Indique o nome de quem devemos contactar.").max(120),
      email: z.string().trim().toLowerCase().email("O e-mail não parece válido."),
      telefone: z.string().trim().max(30).regex(/^[+\d\s()-]*$/, "O telefone só pode ter algarismos, espaços e +.").optional(),
      mensagem: z.string().trim().max(1500).optional(),
      autorizoContacto: z.literal(true, { errorMap: () => ({ message: "Para lhe ligarmos, autorize o contacto." }) }),
    }).parse(req.body);
    const desde = new Date(agora().getTime() - 86_400_000).toISOString();
    const [{ n }] = await db.query<{ n: string }>(`SELECT count(*) AS n FROM pedidos_estudo WHERE empresa_id = $1 AND criado_em > $2`, [id, desde]);
    if (Number(n) >= 3) throw new ErroApp("demasiados_pedidos", "Já recebemos 3 pedidos hoje. Vamos contactá-lo em breve.", 429);
    const apoio = b.apoioId ? (await catalogoAtual()).linhas.find((l) => l.id === b.apoioId) : undefined;
    if (b.apoioId && !apoio) throw new ErroApp("apoio_desconhecido", "Este aviso já não está no catálogo. Atualize a lista.", 404);
    const [r] = await db.query<LinhaEstudo>(
      `INSERT INTO pedidos_estudo (id, empresa_id, apoio_id, apoio_nome, nome, email, telefone, mensagem, criado_em) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [novoId(), id, apoio?.id ?? null, apoio ? `${apoio.codigo} · ${apoio.nome}` : null, b.nome, b.email, b.telefone || null, b.mensagem || null, agoraISO()]);
    const empresa = await empresaPorId(id);
    const destino = cfg.emailEstudos ?? process.env.EMAIL_ESTUDOS;
    if (destino) void enviarEmail({ para: destino, ...emailPedidoEstudo(empresa, estudoDe(r)) }).catch(() => false);
    else console.warn(`[estudos] EMAIL_ESTUDOS em falta — pedido ${r.id} guardado, sem e-mail para a equipa.`);
    await publicar(db, hub, id, "estudo.pedido", "empresa", { estudoId: r.id });
    return reply.code(201).send(estudoDe(r));
  });
  app.get("/v1/empresas/:id/estudos", async (req) => {
    const id = params(req).id;
    await exigirAcesso(db, ator(req), id);
    return (await db.query<LinhaEstudo>(`SELECT * FROM pedidos_estudo WHERE empresa_id = $1 ORDER BY criado_em DESC`, [id])).map(estudoDe);
  });
  const exigirAdmin = (req: FastifyRequest) => {
    if (!cfg.tokenAdmin || req.headers["x-admin-token"] !== cfg.tokenAdmin) throw new ErroApp("sem_permissao", "Acesso reservado.", 403);
  };
  /** Registo completo (todas as empresas e contas), mais recente primeiro. Filtros: empresa, conta, antes (seq). */
  app.get("/v1/admin/registo", async (req) => {
    exigirAdmin(req);
    await registo.pronto();
    const q = z.object({ empresa: z.string().optional(), conta: z.string().optional(), antes: z.coerce.number().int().optional(), limite: z.coerce.number().int().min(1).max(1000).default(200) }).parse(req.query);
    const cond: string[] = []; const v: unknown[] = [];
    if (q.empresa) { v.push(q.empresa); cond.push(`empresa_id = $${v.length}`); }
    if (q.conta) { v.push(q.conta); cond.push(`conta_id = $${v.length}`); }
    if (q.antes) { v.push(q.antes); cond.push(`seq < $${v.length}`); }
    v.push(q.limite);
    const rs = await db.query<Record<string, unknown>>(`SELECT seq, em, empresa_id, conta_id, quem, papel, acao, rota, detalhe, ip, agente, hash FROM atividade ${cond.length ? "WHERE " + cond.join(" AND ") : ""} ORDER BY seq DESC LIMIT $${v.length}`, v);
    return rs.map((r) => ({ ...r, detalhe: typeof r.detalhe === "string" ? (() => { try { return JSON.parse(r.detalhe as string); } catch { return r.detalhe; } })() : r.detalhe }));
  });
  /** Confirma que ninguém alterou nem apagou entradas (cadeia de impressões digitais). */
  app.get("/v1/admin/registo/verificar", async (req) => {
    exigirAdmin(req);
    return registo.verificar();
  });
  /** Lista de pedidos para a equipa que faz os estudos. */
  app.get("/v1/admin/estudos", async (req) => {
    exigirAdmin(req);
    const rs = await db.query<LinhaEstudo & { empresa_id: string | null; origem: string; e_nome: string | null; e_nif: string | null; empresa_nome: string | null; empresa_nif: string | null; cae: string | null; regiao: string | null }>(
      `SELECT p.*, e.nome AS e_nome, e.nif AS e_nif FROM pedidos_estudo p LEFT JOIN empresas e ON e.id = p.empresa_id ORDER BY p.criado_em DESC LIMIT 500`);
    return rs.map((r) => ({ ...estudoDe(r), origem: r.origem, cae: r.cae, regiao: r.regiao,
      empresa: { id: r.empresa_id, nome: r.e_nome ?? r.empresa_nome, nif: r.e_nif ?? r.empresa_nif } }));
  });
  app.post("/v1/admin/estudos/:eid/estado", async (req) => {
    exigirAdmin(req);
    const b = z.object({ estado: z.enum(["recebido", "em_contacto", "concluido"]) }).parse(req.body);
    const [r] = await db.query<LinhaEstudo>(`UPDATE pedidos_estudo SET estado = $1 WHERE id = $2 RETURNING *`, [b.estado, params(req).eid]);
    if (!r) throw new ErroApp("nao_encontrado", "Pedido não encontrado.", 404);
    return estudoDe(r);
  });
  /** Publica uma versão nova do catálogo de avisos (atualizar prazos, abrir/fechar avisos). */
  app.post("/v1/admin/apoios", async (req, reply) => {
    exigirAdmin(req);
    if (!validarCatalogo(req.body)) throw new ErroApp("dados_invalidos", "Catálogo incompleto: precisa de versao, verificadoEm e linhas válidas (ligações https).");
    await db.query(`INSERT INTO apoios_versoes (versao, catalogo, publicada_em) VALUES ($1, $2::jsonb, $3) ON CONFLICT (versao) DO UPDATE SET catalogo = $2::jsonb, publicada_em = $3`,
      [req.body.versao, JSON.stringify(req.body), agoraISO()]);
    return reply.code(201).send({ versao: req.body.versao, linhas: req.body.linhas.length });
  });

  // ═════════════ Site público: verificador de apoios e pedido de estudo sem conta ═════════════
  const resumoPublico = (a: ApoioCompativel) => ({
    id: a.apoio.id, codigo: a.apoio.codigo, nome: a.apoio.nome, programa: a.apoio.programa, resumo: a.apoio.resumo, apoio: a.apoio.apoio ?? null,
    estado: a.apoio.estado, fim: a.apoio.fim ?? null, diasParaFim: a.diasParaFim, territorio: a.apoio.territorio ?? null,
    ligacao: a.apoio.ligacao, compatibilidade: a.compatibilidade, motivos: a.motivos,
  });
  app.get("/v1/apoios/publico", async (req, reply) => {
    const q = z.object({
      cae: z.string().trim().transform((v) => v.replace(/[\s.\-]/g, "")).refine((v) => /^\d{2,5}$/.test(v), "Indique o CAE (5 algarismos) ou só os 2 primeiros.").optional(),
      regiao: z.enum(["PT", "PT-MA", "PT-AC"]).default("PT"),
      dimensao: z.enum(["micro", "pequena", "media", "grande"]).optional(),
    }).parse(req.query);
    const cat = await catalogoAtual();
    const agoraIso = agora().toISOString();
    reply.header("cache-control", "public, max-age=300");
    if (!q.cae) {
      // resumo para o site: quantos avisos abertos e o próximo a fechar (qualquer região)
      const todos = (["PT", "PT-MA", "PT-AC"] as const).flatMap((regiao) => apoiosCompativeis({ cae: null, caesSecundarios: [], dimensao: null, regiao }, cat, agoraIso));
      const unicos = [...new Map(todos.map((a) => [a.apoio.id, a])).values()];
      const abertos = unicos.filter((a) => a.apoio.estado === "aberto");
      const prox = abertos.filter((a) => a.diasParaFim !== null).sort((x, y) => x.diasParaFim! - y.diasParaFim!)[0];
      return { verificadoEm: cat.verificadoEm, abertos: abertos.length, previstos: unicos.length - abertos.length, proximo: prox ? resumoPublico(prox) : null };
    }
    const cae5 = q.cae.padEnd(5, "0");
    const erro = erroCAE(cae5);
    if (erro && !q.cae.startsWith("45")) throw new ErroApp("cae_invalido", q.cae.length < 5 ? "Esta divisão não existe na CAE Rev. 4. Confirme o CAE no SICAE." : erro);
    if (erro) throw new ErroApp("cae_invalido", erroCAE("45000")!);
    const apoios = apoiosCompativeis({ cae: cae5, caesSecundarios: [], dimensao: q.dimensao ?? null, regiao: q.regiao }, cat, agoraIso);
    return { verificadoEm: cat.verificadoEm, seccao: seccaoDoCAE(cae5)?.nome ?? null, apoios: apoios.map(resumoPublico) };
  });

  const pedidosSite = new Map<string, number[]>();
  app.post("/v1/estudos/site", async (req, reply) => {
    const b = z.object({
      nome: z.string().trim().min(2, "Indique o seu nome.").max(120),
      email: z.string().trim().toLowerCase().email("O e-mail não parece válido."),
      telefone: z.string().trim().max(30).regex(/^[+\d\s()-]*$/, "O telefone só pode ter algarismos, espaços e +.").optional(),
      empresa: z.string().trim().min(2, "Indique o nome da empresa (ou do projeto).").max(160),
      nif: z.string().trim().max(15).optional(),
      cae: z.string().trim().max(7).optional(),
      regiao: z.enum(["PT", "PT-MA", "PT-AC"]),
      apoioId: z.string().max(80).nullable().optional(),
      mensagem: z.string().trim().max(1500).optional(),
      autorizoContacto: z.literal(true, { errorMap: () => ({ message: "Para o contactarmos, autorize o contacto." }) }),
      website: z.string().max(0).optional(), // armadilha para robôs: fica sempre vazio
    }).parse(req.body);
    const nif = b.nif ? limparNIF(b.nif) : "";
    if (nif && !validarNIF(nif)) throw new ErroApp("nif_invalido", "O NIF não é válido (pode deixá-lo em branco).");
    const cae = b.cae ? normalizarCAE(b.cae) : "";
    if (cae && (!/^\d{2,5}$/.test(cae) || erroCAE(cae.padEnd(5, "0")))) throw new ErroApp("cae_invalido", "O CAE não parece válido (pode deixá-lo em branco).");
    const t = agora().getTime();
    const recentes = (pedidosSite.get(req.ip) ?? []).filter((x) => t - x < 3600_000);
    if (recentes.length >= 5) throw new ErroApp("demasiados_pedidos", "Recebemos vários pedidos seguidos deste endereço. Tente de novo dentro de uma hora.", 429);
    pedidosSite.set(req.ip, [...recentes, t]);
    const apoio = b.apoioId ? (await catalogoAtual()).linhas.find((l) => l.id === b.apoioId) : undefined;
    const [r] = await db.query<LinhaEstudo>(
      `INSERT INTO pedidos_estudo (id, empresa_id, apoio_id, apoio_nome, nome, email, telefone, mensagem, criado_em, origem, empresa_nome, empresa_nif, cae, regiao)
       VALUES ($1,NULL,$2,$3,$4,$5,$6,$7,$8,'site',$9,$10,$11,$12) RETURNING *`,
      [novoId(), apoio?.id ?? null, apoio ? `${apoio.codigo} · ${apoio.nome}` : null, b.nome, b.email, b.telefone || null, b.mensagem || null, agoraISO(),
        b.empresa, nif || null, cae || null, b.regiao]);
    const destino = cfg.emailEstudos ?? process.env.EMAIL_ESTUDOS;
    if (destino) void enviarEmail({ para: destino, ...emailPedidoEstudo({ nome: `${b.empresa} (pedido pelo site, sem conta)`, nif: nif || "não indicado", regiao: b.regiao, cae: cae || null, dimensao: null }, estudoDe(r)) }).catch(() => false);
    else console.warn(`[estudos] EMAIL_ESTUDOS em falta — pedido do site ${r.id} guardado, sem e-mail para a equipa.`);
    void auto?.emitir("estudo.pedido_site", null, { estudoId: r.id, empresa: b.empresa, nome: b.nome, email: b.email, telefone: b.telefone ?? null, cae: cae || null, regiao: b.regiao, aviso: apoio ? `${apoio.codigo} · ${apoio.nome}` : null }).catch(() => false);
    return reply.code(201).send({ ok: true, id: r.id });
  });

  // ═════════════ Centro de avisos, contacto do cliente e e-mails automáticos ═════════════
  auto = criarAutomacoes({
    db, avisar: push.avisar, enviarEmail, urlPublico: cfg.urlPublico, segredo: cfg.segredoJWT,
    automacaoUrl: cfg.automacaoUrl ?? process.env.AUTOMACAO_URL, automacaoSegredo: cfg.automacaoSegredo ?? process.env.AUTOMACAO_SEGREDO,
    enviarWebhook: cfg.enviarWebhook, catalogo: catalogoAtual, agora, lembreteWhatsApp: wa.lembrete,
  });
  const A = auto;
  wa.rotas(app, async (empresaId, texto) => {
    await registo.registar({ empresaId, quem: "Cliente (WhatsApp)", papel: "empresa", acao: "enviou uma mensagem por WhatsApp", rota: "whatsapp", detalhe: { texto } });
    await A.aoWhatsApp(empresaId, texto);
  });
  /** Consentimento expresso da empresa para lembretes por WhatsApp (só o gestor; exige telemóvel). */
  app.put("/v1/empresas/:id/whatsapp", async (req) => {
    const a = ator(req);
    exigirPapel(a, "empresa");
    await exigirAcesso(db, a, params(req).id);
    exigirGestor(a);
    const b = z.object({ ativo: z.boolean() }).parse(req.body);
    const [e] = await db.query<{ telefone: string | null }>(`SELECT telefone FROM empresas WHERE id = $1`, [a.id]);
    if (b.ativo && !telefoneInternacional(e?.telefone)) throw new ErroApp("sem_telefone", "Guarde primeiro o telemóvel em Contacto para o seu contabilista.");
    await db.query(`UPDATE empresas SET whatsapp_consentimento_em = $1 WHERE id = $2`, [b.ativo ? agoraISO() : null, a.id]);
    return empresaPorId(a.id);
  });
  app.get("/v1/contabilista/avisos", async (req) => {
    const a = ator(req);
    exigirPapel(a, "contabilista");
    const q = req.query as { todas?: string };
    return { avisos: await A.lista(a.id, q.todas !== "1"), contagem: await A.contagem(a.id) };
  });
  app.get("/v1/contabilista/avisos/contagem", async (req) => {
    const a = ator(req);
    exigirPapel(a, "contabilista");
    return A.contagem(a.id);
  });
  app.post("/v1/contabilista/avisos/lidas", async (req) => {
    const a = ator(req);
    exigirPapel(a, "contabilista");
    const b = z.object({ ids: z.array(z.string()).max(500).optional(), todas: z.boolean().optional() }).parse(req.body);
    await A.marcarLidas(a.id, b.todas ? "todas" : b.ids ?? []);
    return A.contagem(a.id);
  });
  app.put("/v1/contabilista/preferencias", async (req) => {
    const a = ator(req);
    exigirPapel(a, "contabilista");
    const b = z.object({ resumoDiario: z.boolean() }).parse(req.body);
    await db.query(`UPDATE contabilistas SET resumo_diario = $1 WHERE id = $2`, [b.resumoDiario, a.id]);
    return { resumoDiario: b.resumoDiario };
  });
  /** Contacto da empresa para respostas rápidas: o gestor ou o contabilista ligado podem atualizar. */
  app.put("/v1/empresas/:id/contacto", async (req) => {
    const a = ator(req);
    const id = params(req).id;
    await exigirAcesso(db, a, id);
    exigirGestor(a);
    const b = z.object({
      telefone: z.string().trim().max(30).nullable().optional(),
      contactoNome: z.string().trim().max(80).nullable().optional(),
    }).parse(req.body);
    if (b.telefone && !telefoneInternacional(b.telefone)) throw new ErroApp("telefone_invalido", "O telefone não parece válido. Use, por exemplo, 912 345 678 ou +351 912 345 678.");
    if (b.telefone !== undefined) {
      // o consentimento para WhatsApp foi dado para um número: se o número muda, tem de ser dado de novo
      const [antes] = await db.query<{ telefone: string | null }>(`SELECT telefone FROM empresas WHERE id = $1`, [id]);
      if (telefoneInternacional(antes?.telefone) !== telefoneInternacional(b.telefone)) await db.query(`UPDATE empresas SET whatsapp_consentimento_em = NULL WHERE id = $1`, [id]);
    }
    await db.query(`UPDATE empresas SET telefone = COALESCE($1, telefone), contacto_nome = COALESCE($2, contacto_nome) WHERE id = $3`,
      [b.telefone === undefined ? null : b.telefone || "", b.contactoNome === undefined ? null : b.contactoNome || "", id]);
    await db.query(`UPDATE empresas SET telefone = NULLIF(telefone, ''), contacto_nome = NULLIF(contacto_nome, '') WHERE id = $1`, [id]);
    await publicar(db, hub, id, "empresa.atualizada", a.papel, { campo: "contacto" });
    return empresaPorId(id);
  });
  app.put("/v1/empresas/:id/preferencias-email", async (req) => {
    const a = ator(req);
    exigirPapel(a, "empresa");
    await exigirAcesso(db, a, params(req).id);
    exigirGestor(a);
    const b = z.object({ dicas: z.boolean() }).parse(req.body);
    await db.query(`UPDATE empresas SET emails_dicas = $1 WHERE id = $2`, [b.dicas, a.id]);
    return { dicas: b.dicas };
  });
  /** Ligação «Deixar de receber» dos e-mails (sem sessão, assinada). */
  app.get("/v1/email/sair", async (req, reply) => {
    const q = req.query as { t?: string; i?: string; k?: string };
    const ok = !!q.t && !!q.i && !!q.k && (q.t === "empresa" || q.t === "contabilista") && A.validarSair(q.t, q.i, q.k);
    if (ok && q.t === "empresa") await db.query(`UPDATE empresas SET emails_dicas = false WHERE id = $1`, [q.i]);
    if (ok && q.t === "contabilista") await db.query(`UPDATE contabilistas SET resumo_diario = false WHERE id = $1`, [q.i]);
    const msg = ok ? (q.t === "empresa" ? "Não voltará a receber dicas por e-mail. Os avisos de prazos continuam, porque são parte do serviço." : "Não voltará a receber o resumo diário. Os avisos continuam na app.") : "Esta ligação não é válida.";
    return reply.code(ok ? 200 : 400).type("text/html; charset=utf-8").send(`<!doctype html><html lang="pt-PT"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Contabia</title><body style="font-family:system-ui,sans-serif;background:#F6F7F5;color:#12232E;display:grid;place-items:center;min-height:90vh;margin:0"><div style="max-width:420px;padding:28px;background:#fff;border:1px solid #E3E8E5;border-radius:16px"><h1 style="font-size:22px;margin:0 0 10px">${ok ? "Feito." : "Ups."}</h1><p style="line-height:1.5">${msg}</p><p style="line-height:1.5;color:#5B6B73;font-size:14px">Pode voltar a ativar na app, em Conta.</p></div></body></html>`);
  });

  // ═════════════ Avisos push ═════════════
  app.post("/v1/dispositivos", async (req) => {
    const a = ator(req);
    const b = z.object({ token: z.string().regex(/^Expo(nent)?PushToken\[.+\]$/), plataforma: z.enum(["ios", "android", "web"]) }).parse(req.body);
    await db.query(
      `INSERT INTO dispositivos (token, papel, conta_id, colaborador_id, plataforma, atualizado_em) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (token) DO UPDATE SET papel = $2, conta_id = $3, colaborador_id = $4, plataforma = $5, atualizado_em = $6`,
      [b.token, a.papel, a.id, a.colaboradorId ?? null, b.plataforma, agoraISO()]);
    return { ok: true };
  });
  app.post("/v1/dispositivos/remover", async (req) => {
    const a = ator(req);
    const b = z.object({ token: z.string() }).parse(req.body);
    await db.query(`DELETE FROM dispositivos WHERE token = $1 AND conta_id = $2`, [b.token, a.id]);
    return { ok: true };
  });
  /** Para um serviço externo (ex.: cron-job.org) acordar o servidor às 9h e enviar os avisos de prazos. */
  app.post("/v1/admin/avisos-prazos", async (req) => {
    if (!cfg.tokenAdmin || req.headers["x-admin-token"] !== cfg.tokenAdmin) throw new ErroApp("sem_permissao", "Acesso reservado.", 403);
    const regras = await regrasAtuais();
    return { enviados: await push.avisarPrazos(hojeISO(), regras), rotina: await A.rotinaDiaria(hojeISO(), regras) };
  });
  if (cfg.agendarAvisosPrazos) {
    const verificar = async () => {
      const hora = Number(new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", hour: "numeric", hourCycle: "h23" }).format(agora()));
      if (hora < 9) return;
      const regras = await regrasAtuais();
      await push.avisarPrazos(hojeISO(), regras).catch(() => 0);
      await A.rotinaDiaria(hojeISO(), regras).catch((x) => console.warn("[rotina diária]", x));
    };
    const t = setInterval(() => void verificar(), 30 * 60 * 1000);
    app.addHook("onClose", async () => clearInterval(t));
    void verificar();
  }

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
  // Site público (página inicial de marketing) em /, com os seus ficheiros em /site/
  const temSite = !!cfg.pastaWeb && existsSync(join(cfg.pastaWeb, "site", "index.html"));
  if (temSite) app.register(estatico, { root: join(cfg.pastaWeb!, "site"), prefix: "/site/", decorateReply: apps.length === 0, wildcard: false, maxAge: "1d" });
  app.setNotFoundHandler((req, reply) => {
    const nome = apps.find((n) => req.url === `/${n}` || req.url.startsWith(`/${n}/`));
    if (nome && req.method === "GET") return reply.type("text/html").sendFile("index.html", join(cfg.pastaWeb!, nome));
    return reply.code(404).send({ codigo: "nao_encontrado", mensagem: "Endereço não encontrado." });
  });
  // ═════════════ Descarregar a app: lojas e lista de espera ═════════════
  /** Ligações das lojas (vazias até a app ser publicada): o site ativa os botões sozinho. */
  app.get("/v1/site/lojas", async (_req, reply) => {
    reply.header("cache-control", "public, max-age=300");
    return { ios: process.env.URL_APP_STORE || null, android: process.env.URL_GOOGLE_PLAY || null, web: "/empresa/" };
  });
  const esperaPorIp = new Map<string, number[]>();
  app.post("/v1/lista-espera", async (req, reply) => {
    const b = z.object({
      email: z.string().trim().toLowerCase().email("O e-mail não parece válido."),
      plataforma: z.enum(["ios", "android", "ambos"]),
      perfil: z.enum(["empresa", "contabilista"]).default("empresa"),
      autorizoContacto: z.literal(true, { errorMap: () => ({ message: "Para o avisarmos, autorize o contacto." }) }),
      website: z.string().max(0).optional(),
    }).parse(req.body);
    const t = agora().getTime();
    const rec = (esperaPorIp.get(req.ip) ?? []).filter((x) => t - x < 3600_000);
    if (rec.length >= 10) throw new ErroApp("demasiados_pedidos", "Recebemos vários pedidos seguidos. Tente de novo dentro de uma hora.", 429);
    esperaPorIp.set(req.ip, [...rec, t]);
    await db.query(`INSERT INTO lista_espera (email, plataforma, perfil, criado_em) VALUES ($1,$2,$3,$4)
      ON CONFLICT (email) DO UPDATE SET plataforma = EXCLUDED.plataforma, perfil = EXCLUDED.perfil`, [b.email, b.plataforma, b.perfil, agoraISO()]);
    void auto?.emitir("lista_espera.inscricao", null, { email: b.email, plataforma: b.plataforma, perfil: b.perfil }).catch(() => false);
    return reply.code(201).send({ ok: true });
  });
  app.get("/v1/admin/lista-espera", async (req) => {
    if (!cfg.tokenAdmin || req.headers["x-admin-token"] !== cfg.tokenAdmin) throw new ErroApp("sem_permissao", "Acesso reservado.", 403);
    return db.query(`SELECT email, plataforma, perfil, criado_em, avisado_em FROM lista_espera ORDER BY criado_em DESC`);
  });

  // Termos e Condições: página própria, também pedida pelas apps
  const temTermos = !!cfg.pastaWeb && existsSync(join(cfg.pastaWeb, "site", "termos.html"));
  app.get("/termos", async (_req, reply) =>
    temTermos ? reply.type("text/html; charset=utf-8").header("cache-control", "no-cache").sendFile("termos.html", join(cfg.pastaWeb!, "site"))
      : reply.code(404).send({ codigo: "nao_encontrado", mensagem: "Termos indisponíveis." }));

  app.get("/", async (_req, reply) =>
    temSite ? reply.type("text/html; charset=utf-8").header("cache-control", "no-cache").sendFile("index.html", join(cfg.pastaWeb!, "site"))
      : reply.type("text/html; charset=utf-8").send(PAGINA_INICIAL));


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
<a class="a" href="/empresa/">App da empresa</a><a class="b" href="/contabilista/">App do Contabilista Certificado</a>
<p style="margin-top:22px;padding:10px 14px;border-radius:10px;background:#FBEEDC;color:#7A3B05;font-size:13px">Versão de testes: use apenas dados fictícios. Não introduza dados reais de empresas.</p></main></body></html>`;
