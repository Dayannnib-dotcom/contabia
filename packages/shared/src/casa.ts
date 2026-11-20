/**
 * Plano Família (Guia 1, v1.1): contabilidade da casa para famílias sem empresa.
 * Classifica faturas pelas categorias de dedução do IRS e estima o valor deduzido.
 * As percentagens e limites são os das despesas de 2026 (declaradas em 2027).
 * O valor final é sempre calculado pela AT: na app falamos de «estimativa».
 */
import { arred } from "./formato.ts";

export type CategoriaCasa = "gerais" | "saude" | "educacao" | "rendas" | "exigencia" | "sem_deducao";

export interface RegraCategoria {
  nome: string;
  /** Percentagem da despesa (ou do IVA, na exigência de fatura) que se deduz. */
  taxa: number;
  /** Limite da dedução em euros; «porTitular» multiplica pelo n.º de titulares. */
  limite: number;
  porTitular?: boolean;
  /** A taxa aplica-se ao IVA da fatura e não ao total. */
  sobreIVA?: boolean;
  ajuda: string;
}

export const REGRAS_CASA: Record<Exclude<CategoriaCasa, "sem_deducao">, RegraCategoria> = {
  gerais: { nome: "Despesas gerais familiares", taxa: 0.35, limite: 250, porTitular: true, ajuda: "Supermercado, água, luz, gás, comunicações, combustível, vestuário; desde 2026 também livros, museus e espetáculos." },
  saude: { nome: "Saúde", taxa: 0.15, limite: 1000, ajuda: "Farmácia com receita, consultas, exames, hospitais e seguros de saúde." },
  educacao: { nome: "Educação e formação", taxa: 0.3, limite: 800, ajuda: "Propinas, creches, escolas, explicações e manuais escolares." },
  rendas: { nome: "Rendas da casa", taxa: 0.15, limite: 900, ajuda: "Renda da habitação permanente, com recibo eletrónico." },
  exigencia: { nome: "Exigência de fatura", taxa: 0.15, limite: 250, sobreIVA: true, ajuda: "Restaurantes, alojamento, oficinas, cabeleireiros, veterinários e ginásios: conta o IVA pago." },
};

export const ANO_FISCAL_CASA = 2026;

export const NOME_CATEGORIA_CASA: Record<CategoriaCasa, string> = {
  ...Object.fromEntries(Object.entries(REGRAS_CASA).map(([k, v]) => [k, v.nome])) as Record<Exclude<CategoriaCasa, "sem_deducao">, string>,
  sem_deducao: "Sem dedução",
};

const PALAVRAS: [CategoriaCasa, RegExp][] = [
  ["saude", /farm[aá]cia|cl[ií]nica|hospital|m[eé]dic|sa[uú]de|dent|laborat[oó]rio|[oó]tica|fisioterap|psic[oó]log/i],
  ["educacao", /escola|col[eé]gio|universidade|creche|infant[aá]rio|explica[cç]|ensino|instituto superior|academia de/i],
  ["rendas", /renda|senhorio|arrendamento/i],
  ["exigencia", /restaurante|caf[eé]|snack|pastelaria|hotel|alojamento|hostel|oficina|auto|cabeleireir|barbear|est[eé]tica|veterin[aá]ri|gin[aá]sio|fitness/i],
];

/** Sugere a categoria pelo nome do emitente; o utilizador confirma sempre. */
export function categoriaCasaSugerida(nomeEmitente: string | null | undefined): CategoriaCasa {
  const n = nomeEmitente ?? "";
  for (const [cat, re] of PALAVRAS) if (re.test(n)) return cat;
  return "gerais";
}

export interface DespesaParaDeducao { categoria: CategoriaCasa; total: number; iva: number; data: string; anulada?: boolean }

export interface LinhaDeducao {
  categoria: Exclude<CategoriaCasa, "sem_deducao">;
  nome: string;
  despesas: number;
  base: number;
  deducao: number;
  limite: number;
  /** 0 a 1: quanto do limite já foi usado. */
  usado: number;
  faltaParaLimite: number;
}

/** Estimativa das deduções do ano, por categoria, com os limites aplicados. */
export function estimarDeducoes(despesas: DespesaParaDeducao[], titulares: number, ano = ANO_FISCAL_CASA): { linhas: LinhaDeducao[]; total: number } {
  const t = Math.max(1, titulares);
  const doAno = despesas.filter((d) => !d.anulada && d.data.startsWith(`${ano}-`));
  const linhas = (Object.keys(REGRAS_CASA) as (keyof typeof REGRAS_CASA)[]).map((cat) => {
    const r = REGRAS_CASA[cat];
    const dela = doAno.filter((d) => d.categoria === cat);
    const despesasTotal = arred(dela.reduce((s, d) => s + d.total, 0));
    const base = arred(dela.reduce((s, d) => s + (r.sobreIVA ? d.iva : d.total), 0));
    const limite = r.porTitular ? r.limite * t : r.limite;
    const bruto = arred(base * r.taxa);
    const deducao = Math.min(bruto, limite);
    return { categoria: cat, nome: r.nome, despesas: despesasTotal, base, deducao, limite, usado: limite ? Math.min(1, deducao / limite) : 0, faltaParaLimite: arred(Math.max(0, limite - deducao)) };
  });
  return { linhas, total: arred(linhas.reduce((s, l) => s + l.deducao, 0)) };
}

export interface PrazoCasa { codigo: string; titulo: string; data: string; detalhe: string }

/**
 * Prazos do IRS das despesas de um ano: validar faturas no e-Fatura (fim de fevereiro do ano seguinte;
 * em 2026 foi a 2 de março — confirmar sempre no Portal das Finanças) e entregar a declaração (1 de abril a 30 de junho).
 */
export function prazosCasa(ano = ANO_FISCAL_CASA): PrazoCasa[] {
  const s = ano + 1;
  return [
    { codigo: "efatura", titulo: "Confirmar o agregado e validar as faturas no e-Fatura", data: `${s}-02-28`, detalhe: "Até ao fim de fevereiro; confirme a data exata no Portal das Finanças." },
    { codigo: "irs_inicio", titulo: "Começa a entrega do IRS", data: `${s}-04-01`, detalhe: "A declaração entrega-se até 30 de junho." },
    { codigo: "irs_fim", titulo: "Último dia para entregar o IRS", data: `${s}-06-30`, detalhe: "Depois desta data há coima." },
  ];
}

/** Preços do serviço de IRS com Contabilista Certificado (aprovados a 20/11/2026). */
export const PRECO_IRS_CASA = { individual: 45, familia: 69 } as const;

export interface MembroCasa { id: string; nome: string; nif: string; tipo: "titular" | "dependente"; ativo: boolean }
export interface DespesaCasa {
  id: string; membroId: string | null; nifEmitente: string; emitente: string | null; data: string; total: number; iva: number;
  categoria: CategoriaCasa; origem: "qr" | "manual"; numero: string | null; anulada: boolean; criadaEm: string;
}
export interface ResumoCasa {
  agregado: { id: string; nome: string; email: string; consentimentoSaudeEm: string | null; servicoIRS: { tipo: "individual" | "familia"; pedidoEm: string } | null };
  membros: MembroCasa[];
  ano: number;
  deducoes: { linhas: LinhaDeducao[]; total: number };
  prazos: PrazoCasa[];
  despesasDoAno: number;
}
