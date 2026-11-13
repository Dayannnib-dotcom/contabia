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
  tempo: TempoEmpresaMes;
}

export interface LinhaHorasCarteira {
  empresa: { id: string; nome: string };
  resumo: ResumoServicos;
  tempoApp: TempoApp;
  honorarios: Honorarios | null;
  minutosInvestidos: number;
  valor: number | null;
  valorHoraReal: number | null;
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

// ───────────── Tempo investido em cada empresa (automático + registado), valor e relatórios ─────────────

/** Tarefas em que o tempo de trabalho na app é medido (secções da empresa na app do contabilista). */
export type CategoriaTempo = "revisao" | "servicos" | "banco" | "regras" | "iva" | "pedidos" | "saft" | "fecho" | "apoios" | "atividade";
export const NOME_TAREFA: Record<CategoriaTempo, string> = {
  revisao: "Revisão de lançamentos", servicos: "Serviços e horas", banco: "Banco e conciliação", regras: "Regras de fornecedores",
  iva: "IVA e declarações", pedidos: "Pedidos de documentos", saft: "SAF-T", fecho: "Fecho do mês", apoios: "Apoios europeus", atividade: "Consulta do registo",
};
export const CATEGORIAS_TEMPO = Object.keys(NOME_TAREFA) as CategoriaTempo[];

export interface TempoApp { segundos: number; porCategoria: { categoria: CategoriaTempo; segundos: number }[] }
/** Valores opcionais, definidos quando o contabilista quiser. Nunca são mostrados à empresa. */
export interface Honorarios { avencaMensal: number | null; tarifaHora: number | null }

/** Minutos totais investidos: serviços registados + trabalho medido na app. */
export const minutosInvestidos = (r: ResumoServicos, t: TempoApp | null) => r.minutosTotal + Math.round((t?.segundos ?? 0) / 60);

/**
 * Valor do mês (se houver honorários): avença + horas faturáveis × tarifa; e o valor real por hora
 * = valor ÷ todo o tempo investido (registado + app). É o número que mostra que clientes compensam.
 */
export function valorDoMes(h: Honorarios | null, r: ResumoServicos, t: TempoApp | null): { valor: number | null; valorHoraReal: number | null } {
  if (!h || (h.avencaMensal == null && h.tarifaHora == null)) return { valor: null, valorHoraReal: null };
  const valor = Math.round(((h.avencaMensal ?? 0) + (h.tarifaHora ?? 0) * (r.minutosFaturaveis / 60)) * 100) / 100;
  const min = minutosInvestidos(r, t);
  // com menos de 1 hora no mês o número engana (ex.: 150 € ÷ 1 min); só a partir de 1 h
  return { valor, valorHoraReal: min >= 60 ? Math.round((valor / (min / 60)) * 100) / 100 : null };
}

/** Relatório de tempo de um mês, partilhado pelo contabilista com a empresa (fotografia do momento). */
export interface RelatorioTempo {
  id: string;
  mes: string;
  partilhadoEm: string;
  partilhadoPor: string;
  nota: string | null;
  reunioes: { feitas: number; previstas: number; minutos: number };
  servicos: { tipo: TipoServico; quantidade: number; minutos: number }[];
  tempoApp: { categoria: CategoriaTempo; segundos: number }[];
  minutosInvestidos: number;
}

export interface TempoEmpresaMes {
  tempoApp: TempoApp | null; // só para o contabilista
  honorarios: Honorarios | null; // só para o contabilista
  minutosInvestidos: number | null; // só para o contabilista
  relatorios: RelatorioTempo[]; // os partilhados (ambos)
}

/** Sugestões do Luís para reduzir o tempo gasto (regras simples e explicáveis). */
export function sugestoesTempo(linhas: { nome: string; minutosInvestidos: number; tempoApp: TempoApp | null; valorHoraReal: number | null; honorarios: Honorarios | null; reunioesEmFalta: number }[]): string[] {
  const s: string[] = [];
  const nome = (n: string) => n.replace(/\.$/, "");
  const total = linhas.reduce((n, l) => n + l.minutosInvestidos, 0);
  const ord = [...linhas].sort((a, b) => b.minutosInvestidos - a.minutosInvestidos);
  if (total >= 60 && ord.length > 1 && ord[0].minutosInvestidos / total >= 0.3)
    s.push(`A ${nome(ord[0].nome)} ocupou ${Math.round((ord[0].minutosInvestidos / total) * 100)}% do seu tempo este mês (${horasLegiveis(ord[0].minutosInvestidos)}).`);
  const comValor = linhas.filter((l) => l.valorHoraReal != null).sort((a, b) => a.valorHoraReal! - b.valorHoraReal!);
  if (comValor.length) {
    const b = comValor[0];
    const media = comValor.reduce((n, l) => n + l.valorHoraReal!, 0) / comValor.length;
    s.push(comValor.length > 1 && b.valorHoraReal! < media * 0.6
      ? `A ${nome(b.nome)} rende ${b.valorHoraReal!.toFixed(0)} €/h, bem abaixo da média da carteira (${media.toFixed(0)} €/h). Vale a pena rever a avença ou reduzir o tempo gasto.`
      : `Valor real por hora mais baixo: ${nome(b.nome)}, ${b.valorHoraReal!.toFixed(0)} €/h.`);
  }
  const DICAS: Partial<Record<CategoriaTempo, string>> = {
    revisao: "regras por fornecedor com lançamento automático reduzem este tempo",
    banco: "importar o extrato todas as semanas evita conciliações longas no fim do mês",
    pedidos: "os lembretes automáticos por WhatsApp ou e-mail ajudam a empresa a enviar tudo a tempo",
    fecho: "resolver os pendentes ao longo do mês torna o fecho mais rápido",
  };
  for (const l of ord) {
    const t = l.tempoApp;
    if (!t || t.segundos < 30 * 60) continue;
    const top = [...t.porCategoria].sort((a, b) => b.segundos - a.segundos)[0];
    if (top && DICAS[top.categoria] && top.segundos / t.segundos >= 0.4 && top.segundos >= 30 * 60) {
      s.push(`Na ${nome(l.nome)}, ${NOME_TAREFA[top.categoria].toLowerCase()} levou ${horasLegiveis(Math.round(top.segundos / 60))}: ${DICAS[top.categoria]}.`);
      break;
    }
  }
  const falta = linhas.reduce((n, l) => n + Math.max(0, l.reunioesEmFalta), 0);
  if (falta) s.push(`${falta === 1 ? "Falta registar 1 reunião" : `Faltam registar ${falta} reuniões`} do plano até hoje.`);
  if (linhas.length && !linhas.some((l) => l.honorarios && (l.honorarios.avencaMensal != null || l.honorarios.tarifaHora != null)) && total > 0)
    s.push("Quando quiser, indique a avença ou o valor por hora de cada empresa e eu mostro o valor real de cada hora de trabalho.");
  return s.slice(0, 4);
}
