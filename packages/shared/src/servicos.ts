/**
 * Espaço de serviços de cada empresa: o que o contabilista presta (reuniões, contabilidade,
 * declarações, estudos…), com o tempo gasto. Nada se apaga: anula-se com motivo.
 */

export type TipoServico = "reuniao" | "contabilidade" | "declaracao" | "estudo" | "consultoria" | "outro";
export type Modalidade = "presencial" | "videochamada" | "telefone";
export type EstadoServico = "a_decorrer" | "registado" | "anulado";

export const NOME_SERVICO: Record<TipoServico, string> = {
  reuniao: "Reunião",
  contabilidade: "Contabilidade mensal",
  declaracao: "Declaração fiscal",
  estudo: "Estudo de viabilidade",
  consultoria: "Consultoria",
  outro: "Outro serviço",
};
export const NOME_MODALIDADE: Record<Modalidade, string> = { presencial: "Presencial", videochamada: "Videochamada", telefone: "Telefone" };
/** 1 = segunda … 7 = domingo (ISO). */
export const DIAS_SEMANA: [number, string][] = [[1, "Seg"], [2, "Ter"], [3, "Qua"], [4, "Qui"], [5, "Sex"], [6, "Sáb"], [7, "Dom"]];

export interface Servico {
  id: string;
  empresaId: string;
  tipo: TipoServico;
  titulo: string;
  data: string; // AAAA-MM-DD (hora de Lisboa)
  inicio: string | null; // ISO, quando cronometrado
  fim: string | null;
  minutos: number | null; // null enquanto decorre
  modalidade: Modalidade | null;
  notas: string | null;
  faturavel: boolean;
  estado: EstadoServico;
  motivoAnulacao: string | null;
  doPlano: boolean;
  registadoPor: string;
  criadoEm: string;
  versao: number;
}

/** Reuniões fixas acordadas com a empresa (ex.: 2 por semana, terça e quinta, 60 min). */
export interface PlanoServicos {
  diasSemana: number[];
  hora: string | null; // HH:MM
  minutos: number;
  modalidade: Modalidade;
  desde: string; // AAAA-MM-DD
  ativo: boolean;
}

export interface ResumoServicos {
  mes: string;
  reunioes: { feitas: number; previstas: number; previstasAteHoje: number; minutos: number };
  porTipo: { tipo: TipoServico; quantidade: number; minutos: number }[];
  minutosTotal: number;
  minutosFaturaveis: number;
}

export interface EspacoServicos {
  mes: string;
  hoje: string;
  plano: PlanoServicos | null;
  servicos: Servico[];
  resumo: ResumoServicos;
  /** Há hoje uma reunião do plano ainda por registar? */
  reuniaoDeHojePorRegistar: boolean;
}

export interface LinhaHorasCarteira {
  empresa: { id: string; nome: string };
  resumo: ResumoServicos;
  plano: PlanoServicos | null;
  reuniaoDeHojePorRegistar: boolean;
  aDecorrer: Servico | null;
}

/** Dia da semana ISO (1–7) de uma data AAAA-MM-DD. */
export function diaSemanaISO(data: string): number {
  const d = new Date(data + "T12:00:00Z").getUTCDay();
  return d === 0 ? 7 : d;
}

/** Todas as datas do mês (AAAA-MM) em que o plano prevê reunião, a partir de `desde`. */
export function datasPrevistas(plano: PlanoServicos | null, mes: string): string[] {
  if (!plano || !plano.ativo || !plano.diasSemana.length) return [];
  const [a, m] = mes.split("-").map(Number);
  const dias = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const r: string[] = [];
  for (let d = 1; d <= dias; d++) {
    const data = `${mes}-${String(d).padStart(2, "0")}`;
    if (data >= plano.desde && plano.diasSemana.includes(diaSemanaISO(data))) r.push(data);
  }
  return r;
}

/** Resumo do mês: reuniões feitas vs. previstas e horas por tipo (os anulados não contam). */
export function resumirServicos(servicos: Servico[], plano: PlanoServicos | null, mes: string, hoje: string): ResumoServicos {
  const validos = servicos.filter((s) => s.estado === "registado" && s.data.startsWith(mes));
  const reun = validos.filter((s) => s.tipo === "reuniao");
  const previstas = datasPrevistas(plano, mes);
  const tipos = new Map<TipoServico, { quantidade: number; minutos: number }>();
  for (const s of validos) {
    const t = tipos.get(s.tipo) ?? { quantidade: 0, minutos: 0 };
    t.quantidade++;
    t.minutos += s.minutos ?? 0;
    tipos.set(s.tipo, t);
  }
  return {
    mes,
    reunioes: { feitas: reun.length, previstas: previstas.length, previstasAteHoje: previstas.filter((d) => d <= hoje).length, minutos: reun.reduce((n, s) => n + (s.minutos ?? 0), 0) },
    porTipo: (Object.keys(NOME_SERVICO) as TipoServico[]).filter((t) => tipos.has(t)).map((t) => ({ tipo: t, ...tipos.get(t)! })),
    minutosTotal: validos.reduce((n, s) => n + (s.minutos ?? 0), 0),
    minutosFaturaveis: validos.filter((s) => s.faturavel).reduce((n, s) => n + (s.minutos ?? 0), 0),
  };
}

/** «1 h 30 min», «45 min», «0 min». */
export function horasLegiveis(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = Math.round(minutos % 60);
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}

/** Horas decimais com vírgula (para faturação): 90 → «1,50». */
export const horasDecimais = (minutos: number) => (minutos / 60).toFixed(2).replace(".", ",");

/** Mês seguinte/anterior (AAAA-MM). */
export function mudarMes(mes: string, delta: number): string {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const nomeMes = (mes: string) => `${MESES[Number(mes.slice(5, 7)) - 1]} de ${mes.slice(0, 4)}`;

/** Data de hoje (AAAA-MM-DD) na hora de Lisboa. */
export const hojeLisboa = (agora = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
