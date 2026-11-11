/**
 * Regras fiscais versionadas. Este ficheiro é a versão incluída na app;
 * o servidor publica versões novas em /v1/regras e as apps aplicam-nas
 * automaticamente na data de entrada em vigor.
 */
export type Regiao = "PT" | "PT-MA" | "PT-AC";
export type TipoTaxa = "reduzida" | "intermedia" | "normal";
export type RegimeIVA = "mensal" | "trimestral";

export interface TaxasIVA {
  desde: string; // ISO
  regiao: Regiao;
  reduzida: number;
  intermedia: number;
  normal: number;
}

export interface Regras {
  versao: string;
  publicadaEm: string;
  taxasIVA: TaxasIVA[];
  prorrogacoes: { obrigacao: string; periodo: string; novoPrazo: string; fonte: string }[];
  saftContabilidadeObrigatorioDesde: string; // exercício
  pdfSemAssinaturaAceiteAte: string;
  fontes: Record<string, string>;
}

export const REGRAS_BASE: Regras = {
  versao: "2026.11",
  publicadaEm: "2026-11-11",
  taxasIVA: [
    { desde: "2012-04-01", regiao: "PT", reduzida: 6, intermedia: 13, normal: 23 },
    { desde: "2012-04-01", regiao: "PT-MA", reduzida: 5, intermedia: 12, normal: 22 },
    { desde: "2024-10-01", regiao: "PT-MA", reduzida: 4, intermedia: 12, normal: 22 },
    { desde: "2012-04-01", regiao: "PT-AC", reduzida: 4, intermedia: 9, normal: 16 },
  ],
  prorrogacoes: [],
  saftContabilidadeObrigatorioDesde: "2027",
  pdfSemAssinaturaAceiteAte: "2026-12-31",
  fontes: {
    taxasIVA: "https://www.pwc.pt/pt/pwcinforfisco/guia-fiscal/2026/iva.html",
    saft: "https://info.portaldasfinancas.gov.pt/pt/apoio_contribuinte/questoes_frequentes/pages/faqs-00276.aspx",
  },
};

/** Taxas em vigor numa data e região (aplica sempre a versão mais recente com início ≤ data). */
export function taxasEm(regras: Regras, regiao: Regiao, dataISO: string): TaxasIVA {
  const candidatas = regras.taxasIVA
    .filter((t) => t.regiao === regiao && t.desde <= dataISO)
    .sort((a, b) => (a.desde < b.desde ? 1 : -1));
  const t = candidatas.at(0);
  if (!t) throw new Error(`Sem taxas de IVA para ${regiao} em ${dataISO}`);
  return t;
}

export function taxa(regras: Regras, regiao: Regiao, tipo: TipoTaxa, dataISO: string): number {
  return taxasEm(regras, regiao, dataISO)[tipo];
}

// ───────────── Calendário fiscal ─────────────

export interface Obrigacao {
  codigo: "efatura" | "dmr" | "dp_iva" | "pag_iva" | "retencoes" | "ppc_irc";
  descricao: string;
  periodo: string; // ex. 2026-10 ou 2026T3
  prazo: string; // ISO
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Se o prazo cair ao fim de semana, passa para o dia útil seguinte. */
export function diaUtil(ano: number, mes: number, dia: number): string {
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return iso(d);
}

function somarMeses(ano: number, mes: number, n: number): [number, number] {
  const t = ano * 12 + (mes - 1) + n;
  return [Math.floor(t / 12), (t % 12) + 1];
}

/** Obrigações geradas pela atividade de um mês (ano, mes 1-12). */
export function obrigacoesDoMes(ano: number, mes: number, regime: RegimeIVA, regras: Regras = REGRAS_BASE): Obrigacao[] {
  const per = `${ano}-${String(mes).padStart(2, "0")}`;
  const [a1, m1] = somarMeses(ano, mes, 1);
  const [a2, m2] = somarMeses(ano, mes, 2);
  const out: Obrigacao[] = [
    { codigo: "efatura", descricao: "Comunicação de faturas (SAF-T de faturação)", periodo: per, prazo: diaUtil(a1, m1, 5) },
    { codigo: "dmr", descricao: "Declaração mensal de remunerações (AT e SS)", periodo: per, prazo: diaUtil(a1, m1, 10) },
    { codigo: "retencoes", descricao: "Pagamento de retenções na fonte", periodo: per, prazo: diaUtil(a1, m1, 20) },
  ];
  const fimTrimestre = mes % 3 === 0;
  if (regime === "mensal" || fimTrimestre) {
    const periodoIVA = regime === "mensal" ? per : `${ano}T${mes / 3}`;
    out.push(
      { codigo: "dp_iva", descricao: "Declaração periódica de IVA", periodo: periodoIVA, prazo: diaUtil(a2, m2, 20) },
      { codigo: "pag_iva", descricao: "Pagamento do IVA", periodo: periodoIVA, prazo: diaUtil(a2, m2, 25) },
    );
  }
  // Prorrogações publicadas (despachos) substituem o prazo legal.
  return out.map((o) => {
    const p = regras.prorrogacoes.find((x) => x.obrigacao === o.codigo && x.periodo === o.periodo);
    return p ? { ...o, prazo: p.novoPrazo } : o;
  });
}

/** Pagamentos por conta de IRC (julho, setembro, dezembro). */
export function pagamentosPorConta(ano: number): Obrigacao[] {
  return [
    { codigo: "ppc_irc", descricao: "1.º pagamento por conta de IRC", periodo: `${ano}`, prazo: diaUtil(ano, 7, 31) },
    { codigo: "ppc_irc", descricao: "2.º pagamento por conta de IRC", periodo: `${ano}`, prazo: diaUtil(ano, 9, 30) },
    { codigo: "ppc_irc", descricao: "3.º pagamento por conta de IRC", periodo: `${ano}`, prazo: diaUtil(ano, 12, 15) },
  ];
}

/** Próximas obrigações a partir de uma data, ordenadas. */
export function proximasObrigacoes(hojeISO: string, regime: RegimeIVA, regras: Regras = REGRAS_BASE, quantas = 8): Obrigacao[] {
  const [a, m] = hojeISO.split("-").map(Number);
  const todas: Obrigacao[] = [];
  for (let k = -3; k <= 1; k++) {
    const [aa, mm] = somarMeses(a, m, k);
    todas.push(...obrigacoesDoMes(aa, mm, regime, regras));
  }
  todas.push(...pagamentosPorConta(a));
  return todas.filter((o) => o.prazo >= hojeISO).sort((x, y) => (x.prazo < y.prazo ? -1 : 1)).slice(0, quantas);
}

export function diasAte(hojeISO: string, prazoISO: string): number {
  return Math.round((Date.parse(prazoISO) - Date.parse(hojeISO)) / 86_400_000);
}
