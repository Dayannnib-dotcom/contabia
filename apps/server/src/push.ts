/**
 * Avisos push enviados pelo servidor (serviço de push da Expo), mesmo com a app fechada.
 * - Eventos: pedido do contabilista, convites de ligação, anulações…
 * - Prazos: todos os dias às 9h (Lisboa), a 7 dias, 2 dias e no próprio dia, para a
 *   empresa e para o contabilista ligado, sem repetir o mesmo aviso.
 * Nunca bloqueia nem faz falhar o pedido que o originou.
 */
import type { Db } from "./db.ts";
import type { Evento } from "@contabia/shared";
import { proximasObrigacoes, type Regras } from "@contabia/shared";

export interface MensagemPush { to: string; title: string; body: string; data?: Record<string, unknown>; sound?: "default"; channelId?: string }
export type EnviarPush = (msgs: MensagemPush[]) => Promise<{ status: "ok" | "error"; details?: { error?: string } }[]>;

/** Envio real para o serviço da Expo (lotes de 100). */
export const enviarExpo: EnviarPush = async (msgs) => {
  const res: { status: "ok" | "error"; details?: { error?: string } }[] = [];
  for (let i = 0; i < msgs.length; i += 100) {
    const r = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(msgs.slice(i, i + 100)),
    });
    const j = (await r.json().catch(() => ({ data: [] }))) as { data?: typeof res };
    res.push(...(j.data ?? msgs.slice(i, i + 100).map(() => ({ status: "error" as const }))));
  }
  return res;
};

export function criarPush(db: Db, enviar: EnviarPush) {
  async function tokensDe(destinos: { empresaId?: string; contabilistaId?: string; excetoColaborador?: string }) {
    const out: string[] = [];
    if (destinos.empresaId) out.push(...(await db.query<{ token: string }>(`SELECT token FROM dispositivos WHERE papel = 'empresa' AND conta_id = $1`, [destinos.empresaId])).map((x) => x.token));
    if (destinos.contabilistaId) out.push(...(await db.query<{ token: string }>(`SELECT token FROM dispositivos WHERE papel = 'contabilista' AND conta_id = $1`, [destinos.contabilistaId])).map((x) => x.token));
    return [...new Set(out)];
  }

  async function avisar(destinos: { empresaId?: string; contabilistaId?: string }, titulo: string, corpo: string, dados: Record<string, unknown> = {}) {
    const tokens = await tokensDe(destinos);
    if (!tokens.length) return 0;
    const msgs = tokens.map((to) => ({ to, title: titulo, body: corpo, data: dados, sound: "default" as const, channelId: "prazos" }));
    const r = await enviar(msgs);
    // aparelhos que já não existem (app apagada): deixar de enviar
    const mortos = tokens.filter((_, i) => r[i]?.details?.error === "DeviceNotRegistered");
    if (mortos.length) await db.query(`DELETE FROM dispositivos WHERE token = ANY($1)`, [mortos]);
    return tokens.length - mortos.length;
  }

  /** Traduz eventos em avisos para o outro lado. */
  async function aoEvento(e: Evento, contabilistaId?: string) {
    const d = e.dados as Record<string, string>;
    const cc = async () => (await db.query<{ contabilista_id: string }>(`SELECT contabilista_id FROM ligacoes WHERE empresa_id = $1 AND estado = 'ativa'`, [e.empresaId])).map((x) => x.contabilista_id);
    switch (e.tipo) {
      case "pedido.criado":
        return avisar({ empresaId: e.empresaId }, "O seu contabilista pede um documento", `${d.tipo}${d.detalhe ? `: ${d.detalhe}` : ""}`, { ecra: "painel" });
      case "ligacao.pedida":
        return d.iniciadaPor === "contabilista"
          ? avisar({ empresaId: e.empresaId }, "Pedido de ligação", "Um contabilista quer ligar-se à sua empresa. Abra a app para aceitar ou recusar.", { ecra: "ligacao" })
          : avisar({ contabilistaId }, "Convite de empresa", "Uma empresa convidou-o para ser o contabilista dela.", { ecra: "ligar" });
      case "ligacao.aceite":
        await avisar({ empresaId: e.empresaId }, "Ligação ativa", "A ligação ao contabilista está ativa.");
        return contabilistaId ? avisar({ contabilistaId }, "Ligação ativa", "A empresa está agora na sua carteira.") : 0;
      case "documento.anulacao_pedida":
        for (const c of await cc()) await avisar({ contabilistaId: c }, "Pedido de anulação", `A empresa pede para anular ${d.numero}.`, { empresaId: e.empresaId });
        return;
      case "documento.anulado":
        return avisar({ empresaId: e.empresaId }, "Documento anulado", `O contabilista confirmou a anulação de ${d.numero}.`);
      case "documento.anulacao_recusada":
        return avisar({ empresaId: e.empresaId }, "Documento mantido", `O contabilista manteve ${d.numero}. Veja a explicação na app ou fale com ele.`);
    }
  }

  /** Avisos de prazos (uma vez por obrigação e antecedência). */
  async function avisarPrazos(hoje: string, regras: Regras) {
    const empresas = await db.query<{ id: string; nome: string; regime_iva: string }>(`SELECT id, nome, regime_iva FROM empresas`);
    let n = 0;
    for (const e of empresas) {
      const submetidas = new Set((await db.query<{ obrigacao: string; periodo: string }>(`SELECT obrigacao, periodo FROM submissoes WHERE empresa_id = $1`, [e.id])).map((s) => `${s.obrigacao}:${s.periodo}`));
      for (const o of proximasObrigacoes(hoje, e.regime_iva as "mensal" | "trimestral", regras, 10)) {
        if (submetidas.has(`${o.codigo}:${o.periodo}`)) continue;
        const dias = Math.round((Date.parse(o.prazo) - Date.parse(hoje)) / 86400000);
        if (![7, 2, 0].includes(dias)) continue;
        const chave = `${e.id}:${o.codigo}:${o.periodo}:${dias}`;
        const [ja] = await db.query(`INSERT INTO avisos_enviados (chave, em) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING chave`, [chave, new Date().toISOString()]);
        if (!ja) continue;
        const quando = dias === 0 ? "Termina hoje" : `Faltam ${dias} dias`;
        const data = o.prazo.split("-").reverse().join("/");
        n += await avisar({ empresaId: e.id }, `${quando} · ${o.descricao}`, `Luís: termina a ${data}. Envie já os documentos que faltam ao seu contabilista.`, { ecra: "prazos" });
        for (const c of (await db.query<{ contabilista_id: string }>(`SELECT contabilista_id FROM ligacoes WHERE empresa_id = $1 AND estado = 'ativa'`, [e.id])).map((x) => x.contabilista_id))
          n += await avisar({ contabilistaId: c }, `${quando} · ${o.descricao}`, `${e.nome}: termina a ${data} e ainda não está submetido.`, { empresaId: e.id });
      }
    }
    return n;
  }

  return { avisar, aoEvento, avisarPrazos };
}
