/**
 * Espaço de serviços por empresa e contador de horas do contabilista.
 *  - O contabilista regista serviços (reuniões, contabilidade, declarações…) à mão ou com cronómetro.
 *  - Plano fixo por empresa (ex.: 2 reuniões por semana) → previstas vs. feitas em cada mês.
 *  - A empresa vê o seu espaço (só leitura). Nada se apaga: anula-se com motivo.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  NOME_MODALIDADE, NOME_SERVICO, datasPrevistas, hojeLisboa, horasDecimais, resumirServicos,
  type EspacoServicos, type LinhaHorasCarteira, type PlanoServicos, type Servico,
} from "@contabia/shared";
import type { Db } from "./db.ts";
import { ErroApp, ator, exigirAcesso, exigirPapel, novoId, type Ator } from "./comum.ts";

type LinhaServico = {
  id: string; empresa_id: string; contabilista_id: string; tipo: string; titulo: string; data: string; inicio: string | null; fim: string | null;
  minutos: number | null; modalidade: string | null; notas: string | null; faturavel: boolean; estado: string; motivo_anulacao: string | null;
  do_plano: boolean; registado_por: string; criado_em: string; versao: number;
};
type LinhaPlano = { dias_semana: string | number[]; hora: string | null; minutos: number; modalidade: string; desde: string; ativo: boolean };

const servicoDe = (r: LinhaServico): Servico => ({
  id: r.id, empresaId: r.empresa_id, tipo: r.tipo as Servico["tipo"], titulo: r.titulo, data: r.data, inicio: r.inicio, fim: r.fim,
  minutos: r.minutos === null ? null : Number(r.minutos), modalidade: r.modalidade as Servico["modalidade"], notas: r.notas, faturavel: r.faturavel,
  estado: r.estado as Servico["estado"], motivoAnulacao: r.motivo_anulacao, doPlano: r.do_plano, registadoPor: r.registado_por, criadoEm: r.criado_em, versao: Number(r.versao),
});
const planoDe = (r?: LinhaPlano): PlanoServicos | null => r ? ({
  diasSemana: (typeof r.dias_semana === "string" ? JSON.parse(r.dias_semana) : r.dias_semana) as number[], hora: r.hora, minutos: Number(r.minutos),
  modalidade: r.modalidade as PlanoServicos["modalidade"], desde: r.desde, ativo: r.ativo,
}) : null;

const TIPOS = ["reuniao", "contabilidade", "declaracao", "estudo", "consultoria", "outro"] as const;
const MODALIDADES = ["presencial", "videochamada", "telefone"] as const;
const zMes = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mês inválido (AAAA-MM).");
const zData = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.");

export function rotasServicos(app: FastifyInstance, db: Db, agora: () => Date) {
  const agoraISO = () => agora().toISOString();
  const hoje = () => hojeLisboa(agora());
  const p = (req: FastifyRequest) => req.params as Record<string, string>;
  const nomeCC = (a: Ator) => `${a.nome} (contabilista)`;

  async function plano(empresaId: string) {
    const [r] = await db.query<LinhaPlano>(`SELECT dias_semana, hora, minutos, modalidade, desde, ativo FROM planos_servicos WHERE empresa_id = $1`, [empresaId]);
    return planoDe(r);
  }
  async function doMes(empresaId: string, mes: string) {
    return (await db.query<LinhaServico>(
      `SELECT * FROM servicos WHERE empresa_id = $1 AND (data LIKE $2 OR estado = 'a_decorrer') ORDER BY data DESC, criado_em DESC`, [empresaId, `${mes}-%`])).map(servicoDe);
  }
  function porRegistarHoje(pl: PlanoServicos | null, servicos: Servico[]) {
    const h = hoje();
    if (!datasPrevistas(pl, h.slice(0, 7)).includes(h)) return false;
    return !servicos.some((s) => s.tipo === "reuniao" && s.data === h && s.estado !== "anulado");
  }
  async function espaco(empresaId: string, mes: string): Promise<EspacoServicos> {
    const [pl, servicos] = await Promise.all([plano(empresaId), doMes(empresaId, mes)]);
    const h = hoje();
    const deHoje = mes === h.slice(0, 7) ? servicos : await doMes(empresaId, h.slice(0, 7));
    return { mes, hoje: h, plano: pl, servicos, resumo: resumirServicos(servicos, pl, mes, h), reuniaoDeHojePorRegistar: porRegistarHoje(pl, deHoje) };
  }
  async function umServico(empresaId: string, sid: string) {
    const [r] = await db.query<LinhaServico>(`SELECT * FROM servicos WHERE id = $1 AND empresa_id = $2`, [sid, empresaId]);
    if (!r) throw new ErroApp("nao_encontrado", "Serviço não encontrado.", 404);
    return r;
  }
  /** Só o contabilista ligado regista; a empresa e os colaboradores só consultam. */
  async function exigirCC(req: FastifyRequest) {
    const a = ator(req);
    exigirPapel(a, "contabilista");
    await exigirAcesso(db, a, p(req).id);
    return a;
  }

  app.get("/v1/empresas/:id/servicos", async (req) => {
    await exigirAcesso(db, ator(req), p(req).id);
    const q = z.object({ mes: zMes.optional() }).parse(req.query);
    return espaco(p(req).id, q.mes ?? hoje().slice(0, 7));
  });

  /** Registo à mão (depois da reunião ou de outro serviço). */
  app.post("/v1/empresas/:id/servicos", async (req, reply) => {
    const a = await exigirCC(req);
    const b = z.object({
      tipo: z.enum(TIPOS), titulo: z.string().trim().max(120).optional(), data: zData.optional(), minutos: z.number().int().min(1, "Indique os minutos.").max(1440),
      modalidade: z.enum(MODALIDADES).nullable().optional(), notas: z.string().trim().max(2000).optional(), faturavel: z.boolean().default(true), doPlano: z.boolean().default(false),
    }).parse(req.body);
    const data = b.data ?? hoje();
    if (data > hoje()) throw new ErroApp("data_futura", "Só se registam serviços já prestados (a data não pode ser futura).");
    const [r] = await db.query<LinhaServico>(
      `INSERT INTO servicos (id, empresa_id, contabilista_id, tipo, titulo, data, minutos, modalidade, notas, faturavel, estado, do_plano, registado_por, criado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'registado',$11,$12,$13) RETURNING *`,
      [novoId(), p(req).id, a.id, b.tipo, b.titulo || NOME_SERVICO[b.tipo], data, b.minutos, b.modalidade ?? null, b.notas || null, b.faturavel, b.doPlano, nomeCC(a), agoraISO()]);
    return reply.code(201).send(servicoDe(r));
  });

  /** Cronómetro: começa agora (um de cada vez por contabilista). */
  app.post("/v1/empresas/:id/servicos/iniciar", async (req, reply) => {
    const a = await exigirCC(req);
    const b = z.object({ tipo: z.enum(TIPOS).default("reuniao"), titulo: z.string().trim().max(120).optional(), modalidade: z.enum(MODALIDADES).nullable().optional(), doPlano: z.boolean().default(false) }).parse(req.body ?? {});
    const [aberto] = await db.query<{ id: string; empresa_id: string }>(`SELECT id, empresa_id FROM servicos WHERE contabilista_id = $1 AND estado = 'a_decorrer'`, [a.id]);
    if (aberto) throw new ErroApp("cronometro_ativo", "Já tem um cronómetro a contar. Termine-o antes de começar outro.", 409);
    const [r] = await db.query<LinhaServico>(
      `INSERT INTO servicos (id, empresa_id, contabilista_id, tipo, titulo, data, inicio, modalidade, faturavel, estado, do_plano, registado_por, criado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,'a_decorrer',$9,$10,$7) RETURNING *`,
      [novoId(), p(req).id, a.id, b.tipo, b.titulo || NOME_SERVICO[b.tipo], hoje(), agoraISO(), b.modalidade ?? null, b.doPlano, nomeCC(a)]);
    return reply.code(201).send(servicoDe(r));
  });

  app.post("/v1/empresas/:id/servicos/:sid/terminar", async (req) => {
    await exigirCC(req);
    const b = z.object({ notas: z.string().trim().max(2000).optional() }).parse(req.body ?? {});
    const s = await umServico(p(req).id, p(req).sid);
    if (s.estado !== "a_decorrer") throw new ErroApp("ja_terminado", "Este serviço já não está a contar.", 409);
    const fim = agoraISO();
    const minutos = Math.min(1440, Math.max(1, Math.round((Date.parse(fim) - Date.parse(s.inicio!)) / 60000)));
    const [r] = await db.query<LinhaServico>(
      `UPDATE servicos SET estado = 'registado', fim = $3, minutos = $4, notas = COALESCE($5, notas), versao = versao + 1 WHERE id = $1 AND empresa_id = $2 RETURNING *`,
      [s.id, s.empresa_id, fim, minutos, b.notas || null]);
    return servicoDe(r);
  });

  /** Corrigir (minutos, notas, faturável…). Fica no registo de atividade com o detalhe. */
  app.put("/v1/empresas/:id/servicos/:sid", async (req) => {
    await exigirCC(req);
    const b = z.object({
      versao: z.number().int(), titulo: z.string().trim().max(120).optional(), data: zData.optional(), minutos: z.number().int().min(1).max(1440).optional(),
      modalidade: z.enum(MODALIDADES).nullable().optional(), notas: z.string().trim().max(2000).nullable().optional(), faturavel: z.boolean().optional(),
    }).parse(req.body);
    const s = await umServico(p(req).id, p(req).sid);
    if (s.estado !== "registado") throw new ErroApp("nao_editavel", s.estado === "anulado" ? "Um serviço anulado não se altera." : "Termine o cronómetro primeiro.", 409);
    if (b.data && b.data > hoje()) throw new ErroApp("data_futura", "A data não pode ser futura.");
    const [r] = await db.query<LinhaServico>(
      `UPDATE servicos SET titulo = COALESCE($4, titulo), data = COALESCE($5, data), minutos = COALESCE($6, minutos),
         modalidade = CASE WHEN $7::boolean THEN $8 ELSE modalidade END, notas = CASE WHEN $9::boolean THEN $10 ELSE notas END,
         faturavel = COALESCE($11, faturavel), versao = versao + 1
       WHERE id = $1 AND empresa_id = $2 AND versao = $3 RETURNING *`,
      [s.id, s.empresa_id, b.versao, b.titulo ?? null, b.data ?? null, b.minutos ?? null, b.modalidade !== undefined, b.modalidade ?? null, b.notas !== undefined, b.notas ?? null, b.faturavel ?? null]);
    if (!r) throw new ErroApp("conflito_versao", "Este serviço foi alterado entretanto. Atualize e tente de novo.", 409);
    return servicoDe(r);
  });

  /** Anular (nunca apagar): deixa de contar nas horas, fica visível com o motivo. */
  app.post("/v1/empresas/:id/servicos/:sid/anular", async (req) => {
    await exigirCC(req);
    const b = z.object({ motivo: z.string().trim().min(3, "Indique o motivo da anulação.").max(300) }).parse(req.body);
    const s = await umServico(p(req).id, p(req).sid);
    if (s.estado === "anulado") throw new ErroApp("ja_anulado", "Este serviço já está anulado.", 409);
    const [r] = await db.query<LinhaServico>(
      `UPDATE servicos SET estado = 'anulado', motivo_anulacao = $3, fim = COALESCE(fim, $4), versao = versao + 1 WHERE id = $1 AND empresa_id = $2 RETURNING *`,
      [s.id, s.empresa_id, b.motivo, agoraISO()]);
    return servicoDe(r);
  });

  /** Plano fixo de reuniões da empresa. */
  app.put("/v1/empresas/:id/plano-servicos", async (req) => {
    const a = await exigirCC(req);
    const b = z.object({
      diasSemana: z.array(z.number().int().min(1).max(7)).max(7), hora: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
      minutos: z.number().int().min(5).max(600), modalidade: z.enum(MODALIDADES), ativo: z.boolean().default(true), desde: zData.optional(),
    }).parse(req.body);
    const dias = [...new Set(b.diasSemana)].sort();
    if (b.ativo && !dias.length) throw new ErroApp("sem_dias", "Escolha pelo menos um dia da semana.");
    const [antes] = await db.query<{ desde: string }>(`SELECT desde FROM planos_servicos WHERE empresa_id = $1`, [p(req).id]);
    await db.query(
      `INSERT INTO planos_servicos (empresa_id, contabilista_id, dias_semana, hora, minutos, modalidade, desde, ativo, atualizado_em)
       VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (empresa_id) DO UPDATE SET contabilista_id = $2, dias_semana = $3::jsonb, hora = $4, minutos = $5, modalidade = $6, desde = $7, ativo = $8, atualizado_em = $9`,
      [p(req).id, a.id, JSON.stringify(dias), b.hora ?? null, b.minutos, b.modalidade, b.desde ?? antes?.desde ?? hoje().slice(0, 7) + "-01", b.ativo, agoraISO()]);
    return plano(p(req).id);
  });

  /** Horas de toda a carteira num mês (o contador do contabilista). */
  app.get("/v1/contabilista/servicos", async (req) => {
    const a = ator(req);
    exigirPapel(a, "contabilista");
    const q = z.object({ mes: zMes.optional() }).parse(req.query);
    const mes = q.mes ?? hoje().slice(0, 7);
    const emps = await db.query<{ id: string; nome: string }>(
      `SELECT e.id, e.nome FROM ligacoes l JOIN empresas e ON e.id = l.empresa_id WHERE l.contabilista_id = $1 AND l.estado = 'ativa' ORDER BY e.nome`, [a.id]);
    const linhas: LinhaHorasCarteira[] = await Promise.all(emps.map(async (e) => {
      const esp = await espaco(e.id, mes);
      const aDecorrer = esp.servicos.find((s) => s.estado === "a_decorrer") ?? null;
      return { empresa: e, resumo: esp.resumo, plano: esp.plano, reuniaoDeHojePorRegistar: esp.reuniaoDeHojePorRegistar, aDecorrer };
    }));
    const total = linhas.reduce((t, l) => ({
      minutos: t.minutos + l.resumo.minutosTotal, faturaveis: t.faturaveis + l.resumo.minutosFaturaveis,
      reunioes: t.reunioes + l.resumo.reunioes.feitas, previstas: t.previstas + l.resumo.reunioes.previstas, minutosReunioes: t.minutosReunioes + l.resumo.reunioes.minutos,
    }), { minutos: 0, faturaveis: 0, reunioes: 0, previstas: 0, minutosReunioes: 0 });
    return { mes, hoje: hoje(), empresas: linhas, total };
  });

  /** Exportação para Excel (ponto e vírgula, UTF-8 com BOM): uma empresa, ou toda a carteira. */
  const csv = (rs: (LinhaServico & { empresa_nome: string })[]) => {
    const c = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const cab = ["Empresa", "Data", "Serviço", "Descrição", "Modalidade", "Minutos", "Horas", "Faturável", "Estado", "Notas", "Registado por"];
    const est = { registado: "Registado", anulado: "Anulado", a_decorrer: "A decorrer" } as Record<string, string>;
    return "﻿" + [cab.join(";"), ...rs.map((r) => [r.empresa_nome, r.data.split("-").reverse().join("/"), NOME_SERVICO[r.tipo as Servico["tipo"]], r.titulo,
      r.modalidade ? NOME_MODALIDADE[r.modalidade as keyof typeof NOME_MODALIDADE] : "", r.minutos ?? "", r.minutos ? horasDecimais(Number(r.minutos)) : "",
      r.faturavel ? "Sim" : "Não", est[r.estado] + (r.motivo_anulacao ? ` (${r.motivo_anulacao})` : ""), r.notas, r.registado_por].map(c).join(";"))].join("\r\n");
  };
  app.get("/v1/empresas/:id/servicos/exportar", async (req) => {
    await exigirAcesso(db, ator(req), p(req).id);
    const mes = zMes.parse((req.query as { mes?: string }).mes ?? hoje().slice(0, 7));
    const rs = await db.query<LinhaServico & { empresa_nome: string }>(
      `SELECT s.*, e.nome AS empresa_nome FROM servicos s JOIN empresas e ON e.id = s.empresa_id WHERE s.empresa_id = $1 AND s.data LIKE $2 ORDER BY s.data, s.criado_em`, [p(req).id, `${mes}-%`]);
    return { nome: `servicos-${mes}.csv`, csv: csv(rs) };
  });
  app.get("/v1/contabilista/servicos/exportar", async (req) => {
    const a = ator(req);
    exigirPapel(a, "contabilista");
    const mes = zMes.parse((req.query as { mes?: string }).mes ?? hoje().slice(0, 7));
    const rs = await db.query<LinhaServico & { empresa_nome: string }>(
      `SELECT s.*, e.nome AS empresa_nome FROM servicos s JOIN empresas e ON e.id = s.empresa_id
       WHERE s.contabilista_id = $1 AND s.data LIKE $2 ORDER BY e.nome, s.data, s.criado_em`, [a.id, `${mes}-%`]);
    return { nome: `horas-carteira-${mes}.csv`, csv: csv(rs) };
  });
}

export const ACOES_SERVICOS: Record<string, string> = {
  "POST /v1/empresas/:id/servicos": "registou um serviço prestado",
  "POST /v1/empresas/:id/servicos/iniciar": "iniciou o cronómetro de uma reunião/serviço",
  "POST /v1/empresas/:id/servicos/:sid/terminar": "terminou o cronómetro e registou o tempo",
  "PUT /v1/empresas/:id/servicos/:sid": "corrigiu um serviço registado",
  "POST /v1/empresas/:id/servicos/:sid/anular": "anulou um serviço registado",
  "PUT /v1/empresas/:id/plano-servicos": "definiu o plano de reuniões",
  "GET /v1/empresas/:id/servicos/exportar": "exportou os serviços do mês",
};
