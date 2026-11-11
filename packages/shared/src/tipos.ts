import type { Regiao, RegimeIVA } from "./regras.ts";

export type Papel = "empresa" | "contabilista";

export interface Empresa {
  id: string;
  utilizador: string;
  nif: string;
  nome: string;
  regiao: Regiao;
  regimeIVA: RegimeIVA;
}

export interface Contabilista {
  id: string;
  email: string;
  nome: string;
  numeroOCC: string;
}

export interface Sessao {
  token: string;
  papel: Papel;
  id: string;
  nome: string;
}

export type TipoDocumento = "compra" | "venda" | "banco" | "pessoal";
export type EstadoDocumento = "validar" | "validado" | "sem_anexo";

export interface Documento {
  id: string;
  empresaId: string;
  tipo: TipoDocumento;
  terceiroNif: string;
  terceiroNome: string;
  numero: string;
  atcud: string;
  data: string;
  base: number;
  iva: number;
  total: number;
  taxa: number;
  espacoFiscal: string;
  estado: EstadoDocumento;
  contaSugerida: string;
  categoria: string;
  ivaDedutivel: boolean;
  origem: "qr" | "manual" | "efatura";
  criadoEm: string;
}

export interface LinhaLancamento {
  conta: string;
  descricao: string;
  debito: number;
  credito: number;
}

export type EstadoLancamento = "proposto" | "lancado" | "estornado";

export interface Lancamento {
  id: string;
  empresaId: string;
  documentoId: string | null;
  diario: string;
  data: string;
  periodo: string; // YYYY-MM
  descricao: string;
  linhas: LinhaLancamento[];
  estado: EstadoLancamento;
  confianca: "alta" | "media";
  versao: number;
}

export interface Pedido {
  id: string;
  empresaId: string;
  contabilistaId: string;
  tipo: string;
  detalhe: string;
  estado: "pendente" | "recebido";
  criadoEm: string;
  recebidoEm: string | null;
}

export type EstadoLigacao = "pendente" | "ativa" | "recusada" | "revogada" | "expirada";

export interface Ligacao {
  id: string;
  empresaId: string;
  contabilistaId: string;
  estado: EstadoLigacao;
  permissoes: string[];
  criadaEm: string;
  expiraEm: string;
  versao: number;
  contabilista?: { nome: string; numeroOCC: string };
  empresa?: { nome: string; nif: string; utilizador: string };
}

export interface CampoDP {
  campo: string;
  descricao: string;
  valor: number;
}

export interface ApuramentoIVA {
  periodo: string;
  campos: CampoDP[];
  resultado: CampoDP;
  lancamentosPendentes: number;
}

export interface Submissao {
  id: string;
  empresaId: string;
  obrigacao: string;
  periodo: string;
  comprovativo: string;
  submetidaEm: string;
}

export interface Evento {
  seq: number;
  empresaId: string;
  tipo: string;
  origem: Papel | "sistema";
  dados: Record<string, unknown>;
  em: string;
}

export interface ResumoEmpresa {
  empresa: Empresa;
  documentosPorValidar: number;
  lancamentosPorRever: number;
  pedidosPendentes: number;
  ivaSubmetido: boolean;
}

export interface VerificacaoFecho {
  periodo: string;
  passos: { codigo: string; descricao: string; ok: boolean }[];
  podeFechar: boolean;
  fechado: boolean;
}

export interface RespostaAssistente {
  resposta: string;
  fontes: string[];
  encaminharParaContabilista: boolean;
}
