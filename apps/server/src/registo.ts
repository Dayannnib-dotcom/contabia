/**
 * Registo de atividade completo, só de acrescentar e verificável.
 *  - Tudo o que altera dados fica registado: quem, papel, o quê, onde (rota), o detalhe (sem senhas
 *    nem tokens), de que endereço e com que dispositivo — também entradas e tentativas falhadas,
 *    consultas de originais e exportações, e o que a Contabia envia sozinha (e-mails, WhatsApp).
 *  - Cada entrada leva a impressão digital (SHA-256) da anterior: alterar ou apagar uma entrada
 *    parte a cadeia, e /v1/admin/registo/verificar mostra onde.
 *  - A base de dados recusa UPDATE e DELETE na tabela (gatilho), mesmo a quem tenha acesso direto.
 */
import { createHash } from "node:crypto";
import type { Db } from "./db.ts";

export interface EntradaRegisto {
  empresaId?: string | null;
  contaId?: string | null;
  quem: string;
  papel: string; // empresa | colaborador | contabilista | visitante | admin | sistema
  acao: string;
  rota?: string | null;
  detalhe?: unknown;
  ip?: string | null;
  agente?: string | null;
}

const SENSIVEL = /senha|password|token|segredo|secret|chave|codigo|assinatura|^k$|^website$/i;

/** Tira segredos e encurta o que é grande, para o registo guardar o necessário e nada de perigoso. */
export function limparDetalhe(v: unknown, prof = 0): unknown {
  if (v == null) return v;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(v)) return `[ficheiro de ${v.length} bytes]`;
  if (typeof v === "string") return v.length > 300 ? v.slice(0, 300) + "…" : v;
  if (typeof v !== "object") return v;
  if (prof > 3) return "[…]";
  if (Array.isArray(v)) return v.length > 20 ? [...v.slice(0, 20).map((x) => limparDetalhe(x, prof + 1)), `… mais ${v.length - 20}`] : v.map((x) => limparDetalhe(x, prof + 1));
  const o: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    // minimização (RGPD): o e-mail fica reconhecível mas mascarado; a conta identifica-se pelo id
    o[k] = SENSIVEL.test(k) ? "[oculto]" : /^e-?mail$|^para$|^identificador$/i.test(k) && typeof x === "string" && x.includes("@") ? mascararEmail(x) : limparDetalhe(x, prof + 1);
  }
  return o;
}

export const mascararEmail = (e?: string | null) => (e ? e.replace(/^(.).*?(@.*)$/, "$1•••$2") : null);

function impressao(anterior: string, r: { empresa_id: string | null; conta_id: string | null; quem: string; papel: string; acao: string; rota: string | null; detalhe: string | null; ip: string | null; agente: string | null; em: string }) {
  return createHash("sha256").update([anterior, r.empresa_id ?? "", r.conta_id ?? "", r.quem, r.papel, r.acao, r.rota ?? "", r.detalhe ?? "", r.ip ?? "", r.agente ?? "", r.em].join("\u001f")).digest("hex");
}

export function criarRegisto(db: Db, agora: () => Date) {
  // uma fila: as entradas entram uma a uma, pela ordem em que acontecem, para a cadeia não se bifurcar
  let fila: Promise<unknown> = Promise.resolve();

  function registar(e: EntradaRegisto): Promise<void> {
    const p = fila.then(async () => {
      const [ult] = await db.query<{ hash: string | null }>(`SELECT hash FROM atividade ORDER BY seq DESC LIMIT 1`);
      const linha = {
        empresa_id: e.empresaId ?? null, conta_id: e.contaId ?? null, quem: e.quem.slice(0, 200), papel: e.papel, acao: e.acao.slice(0, 300),
        rota: e.rota ?? null, detalhe: e.detalhe === undefined ? null : JSON.stringify(limparDetalhe(e.detalhe)).slice(0, 4000),
        ip: e.ip ?? null, agente: e.agente ? e.agente.slice(0, 200) : null, em: agora().toISOString(),
      };
      const anterior = ult?.hash ?? "";
      const hash = impressao(anterior, linha);
      await db.query(
        `INSERT INTO atividade (empresa_id, conta_id, quem, papel, acao, rota, detalhe, ip, agente, em, hash_anterior, hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [linha.empresa_id, linha.conta_id, linha.quem, linha.papel, linha.acao, linha.rota, linha.detalhe, linha.ip, linha.agente, linha.em, anterior || null, hash]);
    });
    fila = p.catch((x) => console.warn("[registo] falhou:", x));
    return p.then(() => undefined, () => undefined);
  }

  /** Recalcula a cadeia inteira. Entradas antigas sem impressão (antes desta versão) contam como início. */
  async function verificar() {
    const rs = await db.query<{ seq: number; empresa_id: string | null; conta_id: string | null; quem: string; papel: string; acao: string; rota: string | null; detalhe: string | null; ip: string | null; agente: string | null; em: string; hash_anterior: string | null; hash: string | null }>(
      `SELECT seq, empresa_id, conta_id, quem, papel, acao, rota, detalhe, ip, agente, em, hash_anterior, hash FROM atividade ORDER BY seq`);
    let anterior = "";
    let verificadas = 0;
    for (const r of rs) {
      if (!r.hash) { anterior = ""; continue; } // anterior a esta versão
      if ((r.hash_anterior ?? "") !== anterior) return { integro: false, total: rs.length, verificadas, problema: { seq: r.seq, motivo: "falta uma entrada antes desta ou foi alterada" } };
      const esperado = impressao(anterior, r);
      if (esperado !== r.hash) return { integro: false, total: rs.length, verificadas, problema: { seq: r.seq, motivo: "o conteúdo desta entrada foi alterado" } };
      anterior = r.hash;
      verificadas++;
    }
    return { integro: true, total: rs.length, verificadas, problema: null };
  }

  const pronto = () => fila.then(() => undefined, () => undefined);
  return { registar, verificar, pronto };
}
