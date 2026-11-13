/**
 * Automações da Contabia, pensadas como o contabilista as quer:
 *  - Centro de avisos: tudo o que exige atenção vira um aviso com urgência e uma resposta sugerida.
 *    Urgente e Para tratar também chegam por push; Para saber fica só na lista.
 *  - Rotina diária (9h Lisboa): documentos parados, pedidos sem resposta, prazos, fundos a fechar,
 *    resumo do dia por e-mail ao contabilista e e-mails às empresas (boas-vindas, dicas, prazos).
 *  - Eventos assinados (HMAC-SHA256) para o Activepieces ou outra automação externa.
 * Nada aqui faz falhar o pedido que o originou.
 */
import { createHmac, randomUUID } from "node:crypto";
import type { Db } from "./db.ts";
import type { Evento } from "@contabia/shared";
import {
  apoiosCompativeis, proximasObrigacoes,
  type Catalogo, type ContextoResposta, type IdResposta, type Notificacao, type Regras, type Urgencia,
} from "@contabia/shared";
import type { EnviarEmail } from "./email.ts";

type Avisar = (destinos: { empresaId?: string; contabilistaId?: string }, titulo: string, corpo: string, dados?: Record<string, unknown>) => Promise<number>;
export type EnviarWebhook = (url: string, corpo: string, cabecalhos: Record<string, string>) => Promise<boolean>;

export const enviarWebhookHttp: EnviarWebhook = async (url, corpo, cabecalhos) => {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...cabecalhos }, body: corpo, signal: AbortSignal.timeout(10_000) });
  return r.ok;
};

export interface CfgAutomacoes {
  db: Db;
  avisar: Avisar;
  enviarEmail?: EnviarEmail;
  urlPublico?: string;
  segredo: string; // para assinar ligações de cancelar e-mails
  automacaoUrl?: string;
  automacaoSegredo?: string;
  enviarWebhook?: EnviarWebhook;
  catalogo: () => Promise<Catalogo>;
  /** Lembrete por WhatsApp (número oficial), se configurado e com consentimento. */
  lembreteWhatsApp?: (chave: string, empresaId: string, modelo: "lembrete_prazo" | "pedido_documento", parametros: string[]) => Promise<boolean>;
  agora: () => Date;
}

const dataPT = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function criarAutomacoes(c: CfgAutomacoes) {
  const { db } = c;
  const agoraISO = () => c.agora().toISOString();
  const url = (c.urlPublico ?? "https://contabia-eu.onrender.com").replace(/\/$/, "");

  // ───────────── eventos assinados ─────────────
  async function emitir(tipo: string, empresaId: string | null, dados: Record<string, unknown>) {
    if (!c.automacaoUrl || !c.automacaoSegredo) return false;
    const empresa = empresaId ? (await db.query<{ id: string; nome: string; nif: string; email: string | null; telefone: string | null }>(
      `SELECT id, nome, nif, email, telefone FROM empresas WHERE id = $1`, [empresaId]))[0] ?? null : null;
    const corpo = JSON.stringify({ id: randomUUID(), tipo, em: agoraISO(), empresa, dados });
    const ts = Math.floor(c.agora().getTime() / 1000).toString();
    const assinatura = createHmac("sha256", c.automacaoSegredo).update(`${ts}.${corpo}`).digest("hex");
    const enviar = c.enviarWebhook ?? enviarWebhookHttp;
    for (const espera of [0, 2000, 10_000]) {
      if (espera) await new Promise((r) => setTimeout(r, espera));
      try { if (await enviar(c.automacaoUrl, corpo, { "x-contabia-evento": tipo, "x-contabia-tempo": ts, "x-contabia-assinatura": `sha256=${assinatura}` })) return true; } catch { /* tenta de novo */ }
    }
    console.warn(`[automacao] falhou o envio do evento ${tipo}`);
    return false;
  }

  // ───────────── centro de avisos ─────────────
  async function ccsDe(empresaId: string) {
    return (await db.query<{ contabilista_id: string }>(`SELECT contabilista_id FROM ligacoes WHERE empresa_id = $1 AND estado = 'ativa'`, [empresaId])).map((x) => x.contabilista_id);
  }
  async function empresaDe(id: string) {
    return (await db.query<{ id: string; nome: string; email: string | null; telefone: string | null }>(`SELECT id, nome, email, telefone FROM empresas WHERE id = $1`, [id]))[0];
  }

  /**
   * Cria (ou atualiza, se a chave já existir) um aviso. Com `contar`, o aviso agrupa: «3 documentos novos hoje».
   * Devolve true se for novo ou se voltou a ficar por ler.
   */
  async function notificar(n: {
    contabilistaId: string; empresaId: string | null; tipo: string; chave: string; urgencia: Urgencia;
    titulo: string; corpo: string; resposta?: { id: IdResposta; contexto: ContextoResposta } | null; separador?: string; contar?: boolean; push?: boolean;
  }) {
    const ag = agoraISO();
    const [ja] = await db.query<{ id: string; contagem: number; lida_em: string | null }>(`SELECT id, contagem, lida_em FROM notificacoes WHERE contabilista_id = $1 AND chave = $2`, [n.contabilistaId, n.chave]);
    if (ja && !n.contar) return false;
    const contagem = ja ? Number(ja.contagem) + 1 : 1;
    const titulo = n.contar && contagem > 1 ? n.titulo.replace("{n}", String(contagem)) : n.titulo.replace("{n}", "1");
    if (ja) {
      await db.query(`UPDATE notificacoes SET contagem = $1, titulo = $2, corpo = $3, lida_em = NULL, atualizada_em = $4 WHERE id = $5`, [contagem, titulo, n.corpo, ag, ja.id]);
    } else {
      await db.query(
        `INSERT INTO notificacoes (id, contabilista_id, empresa_id, tipo, chave, urgencia, titulo, corpo, resposta, separador, contagem, criada_em, atualizada_em)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,1,$11,$11)`,
        [randomUUID(), n.contabilistaId, n.empresaId, n.tipo, n.chave, n.urgencia, titulo, n.corpo, JSON.stringify(n.resposta ?? null), n.separador ?? null, ag]);
    }
    // push: só no primeiro do dia, para não acordar o contabilista a cada fatura
    if (n.push !== false && n.urgencia !== "info" && (!ja || ja.lida_em)) await c.avisar({ contabilistaId: n.contabilistaId }, titulo, n.corpo, { empresaId: n.empresaId, ecra: "avisos" }).catch(() => 0);
    return true;
  }

  /** Traduz eventos de uma empresa em avisos para os contabilistas dela (e em eventos externos). */
  async function aoEvento(e: Evento) {
    void emitir(e.tipo, e.empresaId, e.dados).catch(() => false);
    if (e.origem === "contabilista") return; // o contabilista não precisa de ser avisado do que ele próprio fez
    const d = e.dados as Record<string, unknown>;
    const emp = await empresaDe(e.empresaId);
    if (!emp) return;
    const hoje = agoraISO().slice(0, 10);
    const base = { empresa: emp.nome, contacto: null } as ContextoResposta;
    for (const cc of await ccsDe(e.empresaId)) {
      const N = (x: Omit<Parameters<typeof notificar>[0], "contabilistaId" | "empresaId" | "tipo">) => notificar({ contabilistaId: cc, empresaId: e.empresaId, tipo: e.tipo, ...x });
      switch (e.tipo) {
        case "documento.criado":
          await N({ chave: `docs:${e.empresaId}:${hoje}`, contar: true, urgencia: "normal", titulo: `${emp.nome}: {n} documento(s) novo(s) hoje`,
            corpo: `Último: ${String(d.numero ?? "")}${d.total != null ? ` · ${Number(d.total).toFixed(2).replace(".", ",")} €` : ""}. Reveja e valide.`,
            separador: "revisao", resposta: { id: "documentos_recebidos", contexto: base } });
          break;
        case "documento.anulacao_pedida":
          await N({ chave: `anul:${String(d.documentoId ?? d.numero)}`, urgencia: "alta", titulo: `${emp.nome} pede para anular ${String(d.numero ?? "um documento")}`,
            corpo: "Confirme ou recuse: o documento só sai da contabilidade com a sua aprovação.", separador: "revisao", push: false /* push.ts já avisa */,
            resposta: { id: "anulacao_aprovada", contexto: { ...base, documento: String(d.numero ?? "") } } });
          break;
        case "assistente.encaminhado":
          await N({ chave: `perg:${e.seq}`, urgencia: "alta", titulo: `Pergunta de ${emp.nome}`,
            corpo: `O Luís passou-lhe esta pergunta: «${String(d.pergunta ?? "").slice(0, 140)}»`,
            resposta: { id: "resposta_pergunta", contexto: { ...base, pergunta: String(d.pergunta ?? "") } } });
          break;
        case "pedido.recebido":
          await N({ chave: `pedrec:${String(d.pedidoId)}`, urgencia: "normal", titulo: `${emp.nome} respondeu ao seu pedido`,
            corpo: "O documento que pediu já chegou.", separador: "pedidos", resposta: { id: "documentos_recebidos", contexto: base } });
          break;
        case "estudo.pedido":
          await N({ chave: `estudo:${String(d.estudoId)}`, urgencia: "normal", titulo: `${emp.nome} pediu um estudo de viabilidade`,
            corpo: "A equipa de estudos já foi avisada. Pode acompanhar no separador Apoios UE.", separador: "apoios",
            resposta: { id: "estudo_recebido", contexto: base } });
          break;
        case "banco.importado":
          await N({ chave: `banco:${e.empresaId}:${hoje}`, urgencia: "info", titulo: `${emp.nome} importou o extrato bancário`,
            corpo: "Há movimentos para conciliar.", separador: "banco" });
          break;
        case "empresa.atualizada":
          if (d.campo === "perfil-apoios") await N({ chave: `cae:${e.empresaId}:${hoje}`, urgencia: "info", titulo: `${emp.nome} atualizou o CAE`, corpo: "Os apoios europeus compatíveis foram recalculados.", separador: "apoios" });
          break;
      }
    }
  }

  /** Mensagem do cliente recebida no número de WhatsApp da Contabia → aviso urgente para o contabilista. */
  async function aoWhatsApp(empresaId: string, texto: string) {
    const emp = await empresaDe(empresaId);
    if (!emp) return;
    void emitir("whatsapp.recebido", empresaId, { texto }).catch(() => false);
    for (const cc of await ccsDe(empresaId))
      await notificar({ contabilistaId: cc, empresaId, tipo: "whatsapp.recebido", chave: `wa:${empresaId}:${agoraISO()}`, urgencia: "alta",
        titulo: `${emp.nome} respondeu no WhatsApp`, corpo: `«${texto.slice(0, 200)}»`, resposta: { id: "resposta_pergunta", contexto: { empresa: emp.nome, pergunta: texto } } });
  }

  /** Convite de uma empresa a um contabilista (ainda sem ligação ativa). */
  async function avisarConvite(contabilistaId: string, empresaId: string) {
    const emp = await empresaDe(empresaId);
    if (!emp) return;
    await notificar({ contabilistaId, empresaId, tipo: "ligacao.pedida", chave: `conv:${empresaId}`, urgencia: "normal", titulo: `${emp.nome} convidou-o para contabilista`,
      corpo: "Aceite o convite no separador Ligar empresa.", push: false });
  }

  async function lista(contabilistaId: string, soNaoLidas: boolean): Promise<Notificacao[]> {
    const rs = await db.query<{ id: string; empresa_id: string | null; nome: string | null; telefone: string | null; contacto_nome: string | null; email: string | null; ligada: boolean; tipo: string; urgencia: Urgencia; titulo: string; corpo: string; resposta: Notificacao["resposta"]; separador: string | null; lida_em: string | null; criada_em: string; atualizada_em: string }>(
      `SELECT n.*, e.nome, e.telefone, e.contacto_nome, e.email,
         EXISTS (SELECT 1 FROM ligacoes l WHERE l.empresa_id = n.empresa_id AND l.contabilista_id = n.contabilista_id AND l.estado = 'ativa') AS ligada
       FROM notificacoes n LEFT JOIN empresas e ON e.id = n.empresa_id
       WHERE n.contabilista_id = $1 ${soNaoLidas ? "AND n.lida_em IS NULL" : ""}
       ORDER BY (n.lida_em IS NULL) DESC, CASE n.urgencia WHEN 'alta' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, n.atualizada_em DESC LIMIT 200`, [contabilistaId]);
    return rs.map((r) => ({
      id: r.id, empresaId: r.empresa_id, empresaNome: r.nome, tipo: r.tipo, titulo: r.titulo, corpo: r.corpo, urgencia: r.urgencia,
      // sem ligação ativa (ex.: convite ainda por aceitar, ou ligação revogada) não há contacto nem acesso
      resposta: r.ligada && r.resposta ? { id: r.resposta.id, contexto: { ...r.resposta.contexto, contacto: r.contacto_nome } } : null,
      abrir: r.ligada && r.empresa_id ? { empresaId: r.empresa_id, separador: r.separador ?? undefined } : null,
      contacto: r.ligada && r.empresa_id ? { nome: r.contacto_nome, telefone: r.telefone, email: r.email } : null,
      lida: !!r.lida_em, criadaEm: r.criada_em, atualizadaEm: r.atualizada_em,
    }));
  }
  async function marcarLidas(contabilistaId: string, ids: string[] | "todas") {
    if (ids === "todas") await db.query(`UPDATE notificacoes SET lida_em = $1 WHERE contabilista_id = $2 AND lida_em IS NULL`, [agoraISO(), contabilistaId]);
    else if (ids.length) await db.query(`UPDATE notificacoes SET lida_em = $1 WHERE contabilista_id = $2 AND id = ANY($3) AND lida_em IS NULL`, [agoraISO(), contabilistaId, ids]);
  }
  async function contagem(contabilistaId: string) {
    const rs = await db.query<{ urgencia: Urgencia; n: number }>(`SELECT urgencia, count(*)::int AS n FROM notificacoes WHERE contabilista_id = $1 AND lida_em IS NULL GROUP BY urgencia`, [contabilistaId]);
    const o = { alta: 0, normal: 0, info: 0, total: 0 };
    for (const r of rs) { o[r.urgencia] = Number(r.n); o.total += Number(r.n); }
    return o;
  }

  // ───────────── e-mails ─────────────
  const tokenSair = (tipo: string, id: string) => createHmac("sha256", c.segredo).update(`sair:${tipo}:${id}`).digest("hex").slice(0, 32);
  const ligacaoSair = (tipo: "empresa" | "contabilista", id: string) => `${url}/v1/email/sair?t=${tipo}&i=${encodeURIComponent(id)}&k=${tokenSair(tipo, id)}`;
  const validarSair = (tipo: string, id: string, k: string) => k.length === 32 && tokenSair(tipo, id) === k;

  function moldura(titulo: string, paragrafos: string[], botao?: { texto: string; url: string }, rodape?: string) {
    const html = `<div style="background:#F6F7F5;padding:24px 12px;font-family:'IBM Plex Sans',system-ui,Segoe UI,Roboto,sans-serif;color:#12232E">
<div style="max-width:560px;margin:auto;background:#fff;border:1px solid #E3E8E5;border-radius:16px;overflow:hidden">
<div style="background:#12232E;padding:20px 24px;color:#fff;font:700 20px 'Space Grotesk',system-ui,sans-serif">contabia <span style="color:#3CC6A0;font-size:13px;font-weight:600;margin-left:8px">A maré certa.</span></div>
<div style="padding:24px"><h1 style="font:700 22px/28px 'Space Grotesk',system-ui,sans-serif;margin:0 0 14px">${esc(titulo)}</h1>
${paragrafos.map((p) => `<p style="font-size:15px;line-height:23px;margin:0 0 12px">${p}</p>`).join("")}
${botao ? `<p style="margin:20px 0 6px"><a href="${esc(botao.url)}" style="background:#0B6E5B;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px;display:inline-block">${esc(botao.texto)}</a></p>` : ""}
</div></div>
<p style="max-width:560px;margin:14px auto 0;font-size:12px;line-height:18px;color:#5B6B73;text-align:center">Contabia · O seu contabilista, à mão.${rodape ? `<br>${rodape}` : ""}</p></div>`;
    const texto = `${titulo}\n\n${paragrafos.map((p) => p.replace(/<[^>]+>/g, "")).join("\n\n")}${botao ? `\n\n${botao.texto}: ${botao.url}` : ""}`;
    return { html, texto };
  }

  async function enviarUmaVez(chave: string, para: string | null | undefined, assunto: string, corpo: { html: string; texto: string }) {
    if (!para || !c.enviarEmail) return false;
    const [novo] = await db.query(`INSERT INTO emails_enviados (chave, em) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING chave`, [chave, agoraISO()]);
    if (!novo) return false;
    return c.enviarEmail({ para, assunto, ...corpo }).catch(() => false);
  }

  async function boasVindasEmpresa(empresaId: string) {
    const [e] = await db.query<{ nome: string; email: string | null; utilizador: string }>(`SELECT nome, email, utilizador FROM empresas WHERE id = $1`, [empresaId]);
    if (!e?.email) return false;
    const m = moldura(`Bem-vinda à Contabia, ${e.nome}`, [
      "A partir de hoje, a contabilidade da sua empresa cabe no bolso. Três passos para começar:",
      "<b>1. Fotografe uma fatura</b> — o código QR é lido e o Luís arquiva-a por si.",
      "<b>2. Ligue o seu contabilista</b> — em Ligação, convide-o pelo e-mail ou n.º OCC. Ele passa a ver tudo em tempo real.",
      "<b>3. Ative os avisos</b> — a app lembra-o dos prazos do IVA, da Segurança Social e do IRC.",
      `O seu utilizador é <b>${esc(e.utilizador)}</b>. Guarde este e-mail.`,
    ], { texto: "Abrir a Contabia", url: `${url}/empresa/` });
    return enviarUmaVez(`boasvindas:empresa:${empresaId}`, e.email, "Bem-vinda à Contabia — 3 passos para começar", m);
  }
  /** O contabilista partilhou o relatório de tempo do mês: aviso na app e e-mail ao gestor. */
  async function relatorioTempo(empresaId: string, r: { id: string; mes: string; partilhadoPor: string; minutosInvestidos: number; reunioes: { feitas: number; minutos: number }; nota: string | null }) {
    const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
    const nomeMes = `${MESES[Number(r.mes.slice(5, 7)) - 1]} de ${r.mes.slice(0, 4)}`;
    const h = (m: number) => (Math.floor(m / 60) ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ""}`.trim() : `${m} min`);
    await c.avisar({ empresaId }, "Relatório de tempo do seu contabilista", `${nomeMes}: ${h(r.minutosInvestidos)} dedicados à sua empresa.`, { ecra: "servicos" }).catch(() => undefined);
    const [e] = await db.query<{ nome: string; email: string | null }>(`SELECT nome, email FROM empresas WHERE id = $1`, [empresaId]);
    if (!e?.email) return false;
    const m = moldura(`O tempo dedicado à ${e.nome.replace(/\.$/, "")} em ${nomeMes}`, [
      `${esc(r.partilhadoPor.replace(/ \(contabilista\)$/, ""))} partilhou consigo o relatório do mês: <b>${h(r.minutosInvestidos)}</b> de trabalho na sua contabilidade, incluindo ${r.reunioes.feitas === 1 ? "1 reunião" : `${r.reunioes.feitas} reuniões`} (${h(r.reunioes.minutos)}).`,
      ...(r.nota ? [`Nota do seu contabilista: «${esc(r.nota)}»`] : []),
      "O detalhe por tarefa está na app, em Serviços e reuniões.",
    ], { texto: "Ver o relatório", url: `${url}/empresa/servicos` });
    return enviarUmaVez(`relatorio-tempo:${r.id}`, e.email, `Relatório de tempo de ${nomeMes}`, m);
  }
  async function boasVindasContabilista(id: string) {
    const [cc] = await db.query<{ nome: string; email: string }>(`SELECT nome, email FROM contabilistas WHERE id = $1`, [id]);
    if (!cc) return false;
    const m = moldura(`Bem-vindo à Contabia, ${cc.nome.split(" ")[0]}`, [
      "A sua carteira passa a trabalhar por si: os clientes fotografam as faturas e o senhor recebe-as classificadas, com o ficheiro original.",
      "<b>Avisos de tudo o que importa</b> — documentos novos, pedidos de anulação, perguntas dos clientes, prazos a 7 e a 2 dias, pedidos sem resposta.",
      "<b>Respostas num toque</b> — cada aviso traz a mensagem pronta para enviar por WhatsApp ou e-mail.",
      "<b>Resumo diário às 9h</b> — um e-mail com o que tem para tratar hoje.",
      "Para começar, ligue a primeira empresa no separador Ligar empresa.",
    ], { texto: "Abrir a minha carteira", url: `${url}/contabilista/` });
    return enviarUmaVez(`boasvindas:cc:${id}`, cc.email, "Bem-vindo à Contabia — a sua carteira, em tempo real", m);
  }

  // ───────────── rotina diária ─────────────
  async function rotinaDiaria(hoje: string, regras: Regras) {
    const r = { avisos: 0, emails: 0 };
    const ontem3 = new Date(Date.parse(hoje) - 3 * 86400000).toISOString();
    const cat = await c.catalogo();
    const empresas = await db.query<{ id: string; nome: string; email: string | null; regime_iva: string; regiao: string; cae: string | null; caes_secundarios: string[] | null; dimensao: string | null; criada_em: string; emails_dicas: boolean }>(
      `SELECT id, nome, email, regime_iva, regiao, cae, caes_secundarios, dimensao, criada_em, emails_dicas FROM empresas`);
    for (const e of empresas) {
      const ccs = await ccsDe(e.id);
      const base: ContextoResposta = { empresa: e.nome };
      // documentos à espera de validação há mais de 3 dias
      const [{ n: parados }] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM documentos WHERE empresa_id = $1 AND estado = 'validar' AND criado_em < $2`, [e.id, ontem3]);
      // pedidos ao cliente sem resposta há mais de 3 dias
      const pendentes = await db.query<{ id: string; tipo: string; detalhe: string; criado_em: string }>(`SELECT id, tipo, detalhe, criado_em FROM pedidos WHERE empresa_id = $1 AND estado = 'pendente' AND criado_em < $2`, [e.id, ontem3]);
      // prazos
      const submetidas = new Set((await db.query<{ obrigacao: string; periodo: string }>(`SELECT obrigacao, periodo FROM submissoes WHERE empresa_id = $1`, [e.id])).map((s) => `${s.obrigacao}:${s.periodo}`));
      const prazos = proximasObrigacoes(hoje, e.regime_iva as "mensal" | "trimestral", regras, 10)
        .filter((o) => !submetidas.has(`${o.codigo}:${o.periodo}`))
        .map((o) => ({ ...o, dias: Math.round((Date.parse(o.prazo) - Date.parse(hoje)) / 86400000) }))
        .filter((o) => o.dias >= 0 && o.dias <= 7);
      // fundos europeus compatíveis a fechar em 10 dias
      const fundos = e.cae ? apoiosCompativeis({ cae: e.cae, caesSecundarios: e.caes_secundarios ?? [], dimensao: (e.dimensao as never) ?? null, regiao: e.regiao as never }, cat, `${hoje}T09:00:00Z`)
        .filter((a) => a.apoio.estado === "aberto" && a.diasParaFim !== null && a.diasParaFim <= 10 && a.diasParaFim >= 0) : [];

      for (const cc of ccs) {
        const N = (x: Omit<Parameters<typeof notificar>[0], "contabilistaId" | "empresaId">) => notificar({ contabilistaId: cc, empresaId: e.id, ...x }).then((v) => { if (v) r.avisos++; });
        if (parados > 0) await N({ tipo: "documentos.parados", chave: `parados:${e.id}:${hoje}`, urgencia: "normal", titulo: `${e.nome}: ${parados} documento(s) por validar há mais de 3 dias`, corpo: "Valide-os para os prazos não apertarem.", separador: "revisao" });
        for (const p of pendentes) {
          const dias = Math.floor((Date.parse(hoje) - Date.parse(p.criado_em.slice(0, 10))) / 86400000);
          await N({ tipo: "pedido.sem_resposta", chave: `semresp:${p.id}:${hoje.slice(0, 7)}-${Math.floor(dias / 3)}`, urgencia: "normal", titulo: `${e.nome} ainda não enviou: ${p.tipo}`,
            corpo: `Pedido há ${dias} dias. Envie um lembrete com um toque.`, separador: "pedidos", resposta: { id: "lembrete_pedido", contexto: { ...base, documento: `${p.tipo}${p.detalhe ? ` (${p.detalhe})` : ""}` } } });
        }
        for (const o of prazos.filter((x) => [7, 2, 0].includes(x.dias))) {
          await N({ tipo: "prazo", chave: `prazo:${e.id}:${o.codigo}:${o.periodo}:${o.dias}`, urgencia: o.dias <= 2 ? "alta" : "normal",
            titulo: `${o.dias === 0 ? "Termina hoje" : `Faltam ${o.dias} dias`} · ${o.descricao} · ${e.nome}`, corpo: `Prazo a ${dataPT(o.prazo)}; ainda não está submetido.`, separador: "iva",
            resposta: { id: "lembrete_prazo", contexto: { ...base, obrigacao: o.descricao, prazo: o.prazo } }, push: false /* o push de prazos já sai em push.ts */ });
        }
        for (const a of fundos) {
          await N({ tipo: "fundos.a_fechar", chave: `fundo:${e.id}:${a.apoio.id}`, urgencia: "info", titulo: `Oportunidade para ${e.nome}: ${a.apoio.nome}`,
            corpo: `Aviso ${a.apoio.codigo} compatível, fecha a ${dataPT(a.apoio.fim!)}. Proponha o estudo de viabilidade.`, separador: "apoios",
            resposta: { id: "livre", contexto: base } });
        }
      }

      // e-mails à empresa
      const idade = Math.floor((Date.parse(hoje) - Date.parse(e.criada_em.slice(0, 10))) / 86400000);
      if (e.email) {
        const sair = `Não quer receber dicas? <a href="${ligacaoSair("empresa", e.id)}" style="color:#5B6B73">Deixar de receber</a>.`;
        if (e.emails_dicas && idade >= 2) {
          const [{ n: docs }] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM documentos WHERE empresa_id = $1`, [e.id]);
          if (!docs && await enviarUmaVez(`dica:primeira-fatura:${e.id}`, e.email, "Luís: fotografe a sua primeira fatura (30 segundos)", moldura("A primeira fatura demora 30 segundos", [
            "Abra a Contabia, toque em <b>Digitalizar</b> e aponte a câmara para o código QR da fatura.",
            "O Luís lê o NIF, o valor e o IVA, verifica se não está repetida e guarda o original na nuvem.",
          ], { texto: "Fotografar agora", url: `${url}/empresa/` }, sair))) r.emails++;
        }
        if (e.emails_dicas && idade >= 5 && !ccs.length) {
          if (await enviarUmaVez(`dica:ligar-cc:${e.id}`, e.email, "Ligue o seu contabilista à Contabia", moldura("O seu contabilista, a ver tudo em tempo real", [
            "Com a ligação ativa, o seu contabilista recebe as faturas no mesmo instante, pede o que falta pela app e submete o IVA a tempo.",
            "Em <b>Ligação</b>, escreva o e-mail ou o n.º OCC dele. Ele recebe o convite e aceita num toque.",
          ], { texto: "Ligar o contabilista", url: `${url}/empresa/ligacao` }, sair))) r.emails++;
        }
        // lembretes de prazos por WhatsApp (só com consentimento; o envio verifica-o)
        if (c.lembreteWhatsApp) for (const o of prazos.filter((x) => x.dias === 7 || x.dias === 2))
          await c.lembreteWhatsApp(`prazo:${e.id}:${o.codigo}:${o.periodo}:${o.dias}`, e.id, "lembrete_prazo", [e.nome, o.descricao, dataPT(o.prazo)]).catch(() => false);
        // avisos de prazos por e-mail (serviço: sem opção de cancelar, como os do banco)
        for (const o of prazos.filter((x) => x.dias === 7 || x.dias === 2)) {
          if (await enviarUmaVez(`prazo:${e.id}:${o.codigo}:${o.periodo}:${o.dias}`, e.email, `Faltam ${o.dias} dias · ${o.descricao}`, moldura(`${o.descricao}: faltam ${o.dias} dias`, [
            `O prazo termina a <b>${dataPT(o.prazo)}</b>.`,
            "Para o seu contabilista submeter a tempo, carregue já as faturas de compras e vendas que ainda não estão na Contabia.",
          ], { texto: "Abrir a Contabia", url: `${url}/empresa/` }))) r.emails++;
        }
      }
    }

    // resumo do dia para cada contabilista (só se houver algo por tratar)
    const ccs = await db.query<{ id: string; nome: string; email: string; resumo_diario: boolean }>(`SELECT id, nome, email, resumo_diario FROM contabilistas`);
    for (const cc of ccs) {
      if (!cc.resumo_diario) continue;
      const nl = (await lista(cc.id, true)).filter((n) => n.urgencia !== "info");
      if (!nl.length) continue;
      const linhas = nl.slice(0, 15).map((n) => `<span style="display:inline-block;font:600 11px monospace;letter-spacing:.06em;padding:2px 8px;border-radius:99px;background:${n.urgencia === "alta" ? "#FBE4E1;color:#9B2C1F" : "#E3F5EE;color:#0B5446"}">${n.urgencia === "alta" ? "URGENTE" : "PARA TRATAR"}</span> <b>${esc(n.titulo)}</b><br><span style="color:#5B6B73">${esc(n.corpo)}</span>`);
      const altas = nl.filter((n) => n.urgencia === "alta").length;
      if (await enviarUmaVez(`resumo:${cc.id}:${hoje}`, cc.email, `Contabia · ${altas ? `${altas} urgente(s) e ` : ""}${nl.length} aviso(s) para hoje`, moldura(`Bom dia, ${cc.nome.split(" ")[0]}. Hoje tem ${nl.length} aviso(s) para tratar.`,
        [...linhas, nl.length > 15 ? `… e mais ${nl.length - 15} na app.` : ""].filter(Boolean),
        { texto: "Abrir os avisos", url: `${url}/contabilista/avisos` },
        `Não quer o resumo diário? <a href="${ligacaoSair("contabilista", cc.id)}" style="color:#5B6B73">Deixar de receber</a>.`))) r.emails++;
    }
    return r;
  }

  return { relatorioTempo, aoWhatsApp, emitir, aoEvento, avisarConvite, lista, marcarLidas, contagem, boasVindasEmpresa, boasVindasContabilista, rotinaDiaria, validarSair };
}
