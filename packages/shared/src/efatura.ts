/**
 * Leitura do ficheiro CSV exportado do e-Fatura (Portal das Finanças → e-Fatura →
 * Consultar faturas → Exportar). O leitor é tolerante: reconhece as colunas pelo
 * nome (com ou sem acentos), aceita «;» ou «,» e números com vírgula decimal.
 */
import { limparNIF, validarNIF } from "./nif.ts";
import { coluna, dataISO, norm, numero, separarLinha } from "./csv.ts";

export interface LinhaEfatura {
  nif: string;
  nome: string;
  numero: string;
  atcud: string;
  data: string; // AAAA-MM-DD
  base: number;
  iva: number;
  total: number;
  tipoDoc: string;
  situacao: string;
}

export interface LeituraEfatura {
  linhas: LinhaEfatura[];
  ignoradas: { linha: number; motivo: string }[];
  colunas: string[];
}

export function lerCSVEfatura(texto: string): LeituraEfatura {
  const linhasTexto = texto.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!linhasTexto.length) return { linhas: [], ignoradas: [], colunas: [] };
  const sep = (linhasTexto[0].match(/;/g)?.length ?? 0) >= (linhasTexto[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const cabOriginal = separarLinha(linhasTexto[0], sep);
  const cab = cabOriginal.map(norm);
  const c = {
    emitente: coluna(cab, ["nif", "emitente"], ["emitente"], ["nif"]),
    nome: coluna(cab, ["nome", "emitente"], ["nome"]),
    numero: coluna(cab, ["fatura", "atcud"], ["n", "fatura"], ["numero"], ["documento"]),
    atcud: coluna(cab, ["atcud"]),
    tipo: coluna(cab, ["tipo"]),
    data: coluna(cab, ["data", "emiss"], ["data"]),
    base: coluna(cab, ["base", "tribut"], ["base"]),
    iva: coluna(cab, ["iva"]),
    total: coluna(cab, ["total"]),
    situacao: coluna(cab, ["situa"], ["estado"]),
  };
  const faltam = (["emitente", "numero", "data", "total"] as const).filter((k) => c[k] < 0);
  if (faltam.length) {
    return { linhas: [], ignoradas: [{ linha: 1, motivo: `Não reconheço este ficheiro: faltam as colunas ${faltam.join(", ")}. Use «Exportar» na consulta de faturas do e-Fatura.` }], colunas: cabOriginal };
  }

  const linhas: LinhaEfatura[] = [];
  const ignoradas: LeituraEfatura["ignoradas"] = [];
  linhasTexto.slice(1).forEach((l, i) => {
    const n = i + 2;
    const v = separarLinha(l, sep);
    const get = (k: keyof typeof c) => (c[k] >= 0 ? v[c[k]] ?? "" : "");
    // «509999999 - Papelaria, Lda.» → NIF + nome
    const emit = get("emitente");
    const nifTxt = emit.match(/\d[\d\s]{8,}/)?.[0] ?? emit;
    const nif = limparNIF(nifTxt).slice(0, 9);
    const nome = (c.nome >= 0 && c.nome !== c.emitente ? get("nome") : emit.replace(/^[\d\s]+-?\s*/, "")).trim() || `NIF ${nif}`;
    // «FT 2026/123 / JFG3-123» → número + ATCUD
    const numAtcud = get("numero");
    const [num, atcudDoNumero = ""] = numAtcud.split(/\s+\/\s+/);
    const data = dataISO(get("data"));
    const total = numero(get("total"));
    const iva = c.iva >= 0 ? numero(get("iva")) : 0;
    const base = c.base >= 0 ? numero(get("base")) : Math.round((total - iva) * 100) / 100;
    const situacao = get("situacao");
    if (!validarNIF(nif)) return void ignoradas.push({ linha: n, motivo: `NIF do emitente inválido (${emit})` });
    if (!num.trim()) return void ignoradas.push({ linha: n, motivo: "sem número de fatura" });
    if (!data) return void ignoradas.push({ linha: n, motivo: `data ilegível (${get("data")})` });
    if ([total, iva, base].some((x) => Number.isNaN(x))) return void ignoradas.push({ linha: n, motivo: "valores ilegíveis" });
    if (/cr[eé]dito/i.test(get("tipo"))) return void ignoradas.push({ linha: n, motivo: "nota de crédito (registe-a manualmente)" });
    if (/anulad/i.test(situacao)) return void ignoradas.push({ linha: n, motivo: "fatura anulada no e-Fatura" });
    linhas.push({ nif, nome, numero: num.trim(), atcud: (c.atcud >= 0 && c.atcud !== c.numero ? get("atcud") : atcudDoNumero).trim(), data, base, iva, total, tipoDoc: get("tipo"), situacao });
  });
  return { linhas, ignoradas, colunas: cabOriginal };
}
