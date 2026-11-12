/**
 * Leitura do extrato bancário em CSV (exportado do homebanking: CGD, Millennium,
 * Santander, Novo Banco, BPI, Montepio, Banif/Santander Madeira…). Os bancos mudam
 * o formato, por isso o leitor procura a linha de cabeçalho e reconhece as colunas
 * pelo nome: data, descrição e montante — ou débito e crédito em colunas separadas.
 */
import { coluna, dataISO, norm, numero, separarLinha } from "./csv.ts";

export interface LinhaExtrato { data: string; descricao: string; valor: number }
export interface LeituraExtrato { movimentos: LinhaExtrato[]; ignoradas: { linha: number; motivo: string }[] }

export function lerCSVExtrato(texto: string): LeituraExtrato {
  const linhas = texto.replace(/^﻿/, "").split(/\r?\n/);
  // o cabeçalho pode vir depois de linhas com o n.º da conta, titular, etc.
  const iCab = linhas.slice(0, 30).findIndex((l) => { const n = norm(l); return n.includes("data") && /descri|movimento|historico|operac/.test(n); });
  if (iCab < 0) return { movimentos: [], ignoradas: [{ linha: 1, motivo: "Não encontrei o cabeçalho (Data, Descrição, Montante). Exporte o extrato em CSV no homebanking." }] };
  const l0 = linhas[iCab];
  const sep = [";", "\t", ","].map((s) => [s, l0.split(s).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const cab = separarLinha(l0, sep).map(norm);
  const c = {
    data: coluna(cab, ["data", "mov"], ["data", "lanc"], ["data", "oper"], ["data"]),
    desc: coluna(cab, ["descri"], ["movimento"], ["historico"], ["operac"]),
    valor: coluna(cab, ["montante"], ["valor"], ["importancia"]),
    debito: coluna(cab, ["debito"]),
    credito: coluna(cab, ["credito"]),
  };
  if (c.data < 0 || c.desc < 0 || (c.valor < 0 && c.debito < 0 && c.credito < 0)) {
    return { movimentos: [], ignoradas: [{ linha: iCab + 1, motivo: "Faltam colunas: preciso de Data, Descrição e Montante (ou Débito/Crédito)." }] };
  }
  const movimentos: LinhaExtrato[] = [];
  const ignoradas: LeituraExtrato["ignoradas"] = [];
  linhas.slice(iCab + 1).forEach((l, i) => {
    if (!l.trim()) return;
    const n = iCab + i + 2;
    const v = separarLinha(l, sep);
    const data = dataISO(v[c.data] ?? "");
    if (!data) return void ignoradas.push({ linha: n, motivo: "sem data (linha de saldo ou rodapé)" });
    let valor: number;
    if (c.valor >= 0 && (v[c.valor] ?? "").trim()) valor = numero(v[c.valor]);
    else {
      const d = c.debito >= 0 ? Math.abs(numero(v[c.debito] ?? "")) : 0;
      const cr = c.credito >= 0 ? Math.abs(numero(v[c.credito] ?? "")) : 0;
      valor = (Number.isNaN(cr) ? 0 : cr) - (Number.isNaN(d) ? 0 : d);
    }
    if (!Number.isFinite(valor) || valor === 0) return void ignoradas.push({ linha: n, motivo: "sem montante" });
    movimentos.push({ data, descricao: (v[c.desc] ?? "").replace(/\s+/g, " ").trim(), valor: Math.round(valor * 100) / 100 });
  });
  return { movimentos, ignoradas };
}
