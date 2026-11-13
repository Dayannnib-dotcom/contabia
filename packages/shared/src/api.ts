/**
 * Cliente da API Contabia, partilhado pelas duas apps.
 * - Reenvio automático com espera exponencial em falhas de rede/5xx.
 * - Chave de idempotência em todas as escritas (um reenvio nunca duplica).
 * - Tempo real por WebSocket com recuperação por cursor ao reconectar.
 */
import type {
  MotivoAnulacao, Anexo, MovimentoBancario, Colaborador, Atividade, RegraFornecedor,
  ApuramentoIVA, Documento, Empresa, Evento, Lancamento, Ligacao, Pedido, RespostaAssistente,
  ResumoEmpresa, Sessao, Submissao, VerificacaoFecho, Contabilista,
} from "./tipos.ts";
import type { Regras, Regiao, RegimeIVA } from "./regras.ts";
import type { LinhaEfatura } from "./efatura.ts";
import type { LinhaExtrato } from "./extrato.ts";
import type { Notificacao } from "./respostas.ts";
import type { ApoioCompativel, Dimensao, PedidoEstudo, PerfilApoios } from "./apoios.ts";
import type { CategoriaTempo, EspacoServicos, Honorarios, LinhaHorasCarteira, Modalidade, PlanoServicos, RelatorioTempo, Servico, TipoServico } from "./servicos.ts";

export class ErroApi extends Error {
  constructor(public codigo: string, mensagem: string, public status: number) {
    super(mensagem);
  }
}

type Metodo = "GET" | "POST" | "PUT" | "DELETE";

const novaChave = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export class ApiContabia {
  token: string | null = null;
  /** Chamado quando o servidor diz que a sessão já não é válida (ex.: conta apagada). */
  aoSessaoInvalida: (() => void) | null = null;
  /** O servidor renovou a sessão: a app guarda o novo token. */
  aoTokenNovo: ((token: string) => void) | null = null;

  constructor(public base: string, private esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))) {}

  /** `chaveFixa`: a fila sem internet reenvia sempre com a mesma chave, por isso nunca duplica. */
  async pedido<T>(metodo: Metodo, caminho: string, corpo?: unknown, tentativas = 4, chaveFixa?: string): Promise<T> {
    const chave = chaveFixa ?? novaChave();
    for (let i = 0; ; i++) {
      try {
        const r = await fetch(this.base + caminho, {
          method: metodo,
          headers: {
            "content-type": "application/json",
            ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
            ...(metodo !== "GET" ? { "idempotency-key": chave } : {}),
          },
          body: corpo === undefined ? undefined : JSON.stringify(corpo),
        });
        const novo = r.headers.get("x-contabia-token");
        if (novo && this.token) { this.token = novo; this.aoTokenNovo?.(novo); }
        const texto = await r.text();
        let json: { codigo?: string; mensagem?: string } | null = null;
        try {
          json = texto ? JSON.parse(texto) : null;
        } catch {
          // resposta não-JSON (ex.: página de erro do alojamento enquanto o servidor arranca)
          if (!r.ok && i + 1 < tentativas) throw new ErroApi("indisponivel", "O servidor está a arrancar. Tente de novo dentro de um minuto.", r.status);
        }
        if (!r.ok) {
          const erro = new ErroApi(json?.codigo ?? "erro", json?.mensagem ?? `Erro ${r.status}`, r.status);
          if (r.status === 401 && json?.codigo === "sessao_invalida" && this.token) this.aoSessaoInvalida?.();
          if (r.status >= 500 && i + 1 < tentativas) throw erro;
          throw Object.assign(erro, { final: true });
        }
        return json as T;
      } catch (e) {
        if ((e as { final?: boolean }).final) throw e;
        if (i + 1 >= tentativas) {
          if (e instanceof ErroApi) throw e;
          throw new ErroApi("sem_ligacao", "Sem ligação ao servidor. Verifique a internet e tente de novo.", 0);
        }
        await this.esperar(Math.min(8000, 500 * 2 ** i));
      }
    }
  }

  // ── Autenticação ──
  registarEmpresa(d: { utilizador: string; nif: string; nome: string; senha: string; regiao: Regiao; regimeIVA: RegimeIVA; email?: string }) {
    return this.pedido<Sessao>("POST", "/v1/auth/empresas", d);
  }
  registarContabilista(d: { email: string; nome: string; numeroOCC: string; senha: string }) {
    return this.pedido<Sessao>("POST", "/v1/auth/contabilistas", d);
  }
  entrar(d: { papel: "empresa" | "contabilista"; identificador: string; senha: string }) {
    return this.pedido<Sessao>("POST", "/v1/auth/sessoes", d);
  }
  recuperarSenha(papel: "empresa" | "contabilista", identificador: string) {
    return this.pedido<{ ok: true; mensagem: string }>("POST", "/v1/auth/recuperar", { papel, identificador }, 2);
  }
  redefinirSenha(token: string, senha: string) {
    return this.pedido<{ ok: true; mensagem: string }>("POST", "/v1/auth/redefinir", { token, senha }, 2);
  }
  definirEmail(email: string) {
    return this.pedido<Empresa>("PUT", "/v1/auth/email", { email });
  }
  eu() {
    return this.pedido<{ sessao: Sessao; empresa?: Empresa; contabilista?: Contabilista }>("GET", "/v1/auth/eu");
  }

  // ── Ligação ──
  /** Contabilista → empresa: com o utilizador e o NIF da empresa. */
  pedirLigacao(utilizador: string, nif: string) {
    return this.pedido<Ligacao>("POST", "/v1/ligacoes", { utilizador, nif });
  }
  /** Empresa → contabilista: com o e-mail ou o n.º OCC do contabilista. */
  convidarContabilista(contabilista: string) {
    return this.pedido<Ligacao>("POST", "/v1/ligacoes", { contabilista });
  }
  ligacoes() {
    return this.pedido<Ligacao[]>("GET", "/v1/ligacoes");
  }
  aceitarLigacao(id: string, versao: number) {
    return this.pedido<Ligacao>("POST", `/v1/ligacoes/${id}/aceitar`, { versao });
  }
  recusarLigacao(id: string, versao: number) {
    return this.pedido<Ligacao>("POST", `/v1/ligacoes/${id}/recusar`, { versao });
  }
  revogarLigacao(id: string, versao: number) {
    return this.pedido<Ligacao>("DELETE", `/v1/ligacoes/${id}`, { versao });
  }

  // ── Carteira (contabilista) ──
  carteira() {
    return this.pedido<ResumoEmpresa[]>("GET", "/v1/carteira");
  }
  resumo(empresaId: string) {
    return this.pedido<ResumoEmpresa>("GET", `/v1/empresas/${empresaId}/resumo`);
  }

  // ── Documentos ──
  documentos(empresaId: string, periodo?: string) {
    return this.pedido<Documento[]>("GET", `/v1/empresas/${empresaId}/documentos${periodo ? `?periodo=${periodo}` : ""}`);
  }
  criarDocumentoQR(empresaId: string, qr: string, tipo: Documento["tipo"] = "compra") {
    return this.pedido<Documento>("POST", `/v1/empresas/${empresaId}/documentos`, { qr, tipo });
  }
  criarDocumento(empresaId: string, d: Partial<Documento>) {
    return this.pedido<Documento>("POST", `/v1/empresas/${empresaId}/documentos`, d);
  }
  importarEfatura(empresaId: string, linhas: Omit<LinhaEfatura, "tipoDoc" | "situacao">[], tipo: "compra" | "venda" = "compra") {
    return this.pedido<{ importados: number; repetidos: number; erros: number; resultados: { numero: string; estado: "importado" | "repetido" | "erro"; mensagem?: string }[] }>(
      "POST", `/v1/empresas/${empresaId}/documentos/importar`, { tipo, linhas: linhas.map(({ nif, nome, numero, atcud, data, base, iva, total }) => ({ nif, nome, numero, atcud, data, base, iva, total })) });
  }
  // ── Utilizadores da empresa ──
  colaboradores(empresaId: string) {
    return this.pedido<Colaborador[]>("GET", `/v1/empresas/${empresaId}/colaboradores`);
  }
  adicionarColaborador(empresaId: string, d: { nome: string; email: string; senha: string }) {
    return this.pedido<Colaborador>("POST", `/v1/empresas/${empresaId}/colaboradores`, d);
  }
  ativarColaborador(empresaId: string, colaboradorId: string, ativo: boolean) {
    return this.pedido<Colaborador>("POST", `/v1/empresas/${empresaId}/colaboradores/${colaboradorId}/${ativo ? "ativar" : "desativar"}`, {});
  }
  atividade(empresaId: string) {
    return this.pedido<Atividade[]>("GET", `/v1/empresas/${empresaId}/atividade`);
  }

  // ── Avisos push ──
  registarDispositivo(token: string, plataforma: "ios" | "android" | "web") {
    return this.pedido<{ ok: true }>("POST", "/v1/dispositivos", { token, plataforma }, 2);
  }
  removerDispositivo(token: string) {
    return this.pedido<{ ok: true }>("POST", "/v1/dispositivos/remover", { token }, 1);
  }

  // ── Centro de avisos do contabilista e contacto do cliente ──
  avisos(todas = false) {
    return this.pedido<{ avisos: Notificacao[]; contagem: ContagemAvisos }>("GET", `/v1/contabilista/avisos${todas ? "?todas=1" : ""}`);
  }
  contagemAvisos() {
    return this.pedido<ContagemAvisos>("GET", "/v1/contabilista/avisos/contagem");
  }
  marcarAvisosLidos(ids: string[] | "todas") {
    return this.pedido<ContagemAvisos>("POST", "/v1/contabilista/avisos/lidas", ids === "todas" ? { todas: true } : { ids });
  }
  preferenciasContabilista(p: { resumoDiario: boolean }) {
    return this.pedido<{ resumoDiario: boolean }>("PUT", "/v1/contabilista/preferencias", p);
  }
  definirContacto(empresaId: string, p: { telefone?: string | null; contactoNome?: string | null }) {
    return this.pedido<Empresa>("PUT", `/v1/empresas/${empresaId}/contacto`, p);
  }
  lembretesWhatsApp(empresaId: string, ativo: boolean) {
    return this.pedido<Empresa>("PUT", `/v1/empresas/${empresaId}/whatsapp`, { ativo });
  }
  preferenciasEmail(empresaId: string, dicas: boolean) {
    return this.pedido<{ dicas: boolean }>("PUT", `/v1/empresas/${empresaId}/preferencias-email`, { dicas });
  }

  // ── Apoios europeus e estudos de viabilidade ──
  apoios(empresaId: string) {
    return this.pedido<{ perfil: PerfilApoios; apoios: ApoioCompativel[]; verificadoEm: string }>("GET", `/v1/empresas/${empresaId}/apoios`);
  }
  definirPerfilApoios(empresaId: string, p: { cae: string; caesSecundarios?: string[]; dimensao: Dimensao | null }) {
    return this.pedido<PerfilApoios>("PUT", `/v1/empresas/${empresaId}/perfil-apoios`, p);
  }
  pedirEstudo(empresaId: string, p: { apoioId: string | null; nome: string; email: string; telefone?: string; mensagem?: string; autorizoContacto: true }) {
    return this.pedido<PedidoEstudo>("POST", `/v1/empresas/${empresaId}/estudos`, p);
  }
  estudos(empresaId: string) {
    return this.pedido<PedidoEstudo[]>("GET", `/v1/empresas/${empresaId}/estudos`);
  }

  // ── Espaço de serviços e horas ──
  servicos(empresaId: string, mes?: string) {
    return this.pedido<EspacoServicos>("GET", `/v1/empresas/${empresaId}/servicos${mes ? `?mes=${mes}` : ""}`);
  }
  registarServico(empresaId: string, s: { tipo: TipoServico; titulo?: string; data?: string; minutos: number; modalidade?: Modalidade | null; notas?: string; faturavel?: boolean; doPlano?: boolean }) {
    return this.pedido<Servico>("POST", `/v1/empresas/${empresaId}/servicos`, s);
  }
  iniciarServico(empresaId: string, s: { tipo?: TipoServico; titulo?: string; modalidade?: Modalidade | null; doPlano?: boolean } = {}) {
    return this.pedido<Servico>("POST", `/v1/empresas/${empresaId}/servicos/iniciar`, s);
  }
  terminarServico(empresaId: string, servicoId: string, notas?: string) {
    return this.pedido<Servico>("POST", `/v1/empresas/${empresaId}/servicos/${servicoId}/terminar`, notas ? { notas } : {});
  }
  corrigirServico(empresaId: string, servicoId: string, c: { versao: number; titulo?: string; data?: string; minutos?: number; modalidade?: Modalidade | null; notas?: string | null; faturavel?: boolean }) {
    return this.pedido<Servico>("PUT", `/v1/empresas/${empresaId}/servicos/${servicoId}`, c);
  }
  anularServico(empresaId: string, servicoId: string, motivo: string) {
    return this.pedido<Servico>("POST", `/v1/empresas/${empresaId}/servicos/${servicoId}/anular`, { motivo });
  }
  definirPlanoServicos(empresaId: string, p: { diasSemana: number[]; hora?: string | null; minutos: number; modalidade: Modalidade; ativo?: boolean }) {
    return this.pedido<PlanoServicos>("PUT", `/v1/empresas/${empresaId}/plano-servicos`, p);
  }
  exportarServicos(empresaId: string, mes: string) {
    return this.pedido<{ nome: string; csv: string }>("GET", `/v1/empresas/${empresaId}/servicos/exportar?mes=${mes}`);
  }
  /** Sinal de trabalho na app (tempo ativo no ecrã da empresa). Sem reenvios: se falhar, perde-se só esse bocado. */
  registarTempo(empresaId: string, categoria: CategoriaTempo, segundos: number) {
    return this.pedido<{ contados: number }>("POST", `/v1/empresas/${empresaId}/tempo`, { categoria, segundos }, 1);
  }
  definirHonorarios(empresaId: string, h: Honorarios) {
    return this.pedido<Honorarios | null>("PUT", `/v1/empresas/${empresaId}/honorarios`, h);
  }
  partilharRelatorioTempo(empresaId: string, mes: string, nota?: string) {
    return this.pedido<RelatorioTempo>("POST", `/v1/empresas/${empresaId}/relatorios-tempo`, nota ? { mes, nota } : { mes });
  }
  horasCarteira(mes?: string) {
    return this.pedido<{ mes: string; hoje: string; empresas: LinhaHorasCarteira[]; total: { minutos: number; faturaveis: number; reunioes: number; previstas: number; minutosReunioes: number; minutosApp: number; investidos: number; valor: number | null } }>("GET", `/v1/contabilista/servicos${mes ? `?mes=${mes}` : ""}`);
  }
  exportarHorasCarteira(mes: string) {
    return this.pedido<{ nome: string; csv: string }>("GET", `/v1/contabilista/servicos/exportar?mes=${mes}`);
  }

  // ── Regras por fornecedor ──
  regrasFornecedor(empresaId: string) {
    return this.pedido<RegraFornecedor[]>("GET", `/v1/empresas/${empresaId}/regras-fornecedor`);
  }
  guardarRegraFornecedor(empresaId: string, nif: string, r: { nome: string; conta: string; ivaDedutivel: boolean; autoLancar: boolean }) {
    return this.pedido<RegraFornecedor>("PUT", `/v1/empresas/${empresaId}/regras-fornecedor/${nif}`, r);
  }
  removerRegraFornecedor(empresaId: string, nif: string) {
    return this.pedido<{ ok: true }>("DELETE", `/v1/empresas/${empresaId}/regras-fornecedor/${nif}`);
  }

  // ── Banco ──
  importarExtrato(empresaId: string, movimentos: LinhaExtrato[]) {
    return this.pedido<{ novos: number; repetidos: number; comSugestao: number }>("POST", `/v1/empresas/${empresaId}/banco/importar`, { movimentos });
  }
  movimentos(empresaId: string) {
    return this.pedido<MovimentoBancario[]>("GET", `/v1/empresas/${empresaId}/banco/movimentos`);
  }
  conciliar(empresaId: string, movimentoId: string, documentoId: string) {
    return this.pedido<MovimentoBancario>("POST", `/v1/empresas/${empresaId}/banco/movimentos/${movimentoId}/conciliar`, { documentoId });
  }
  conciliarAutomatico(empresaId: string) {
    return this.pedido<{ conciliados: number }>("POST", `/v1/empresas/${empresaId}/banco/conciliar-automatico`, {});
  }
  desfazerConciliacao(empresaId: string, movimentoId: string) {
    return this.pedido<MovimentoBancario>("POST", `/v1/empresas/${empresaId}/banco/movimentos/${movimentoId}/desfazer`, {});
  }
  pedirFaturaEmFalta(empresaId: string, movimentoId: string) {
    return this.pedido<MovimentoBancario>("POST", `/v1/empresas/${empresaId}/banco/movimentos/${movimentoId}/pedir-fatura`, {});
  }
  ignorarMovimento(empresaId: string, movimentoId: string) {
    return this.pedido<MovimentoBancario>("POST", `/v1/empresas/${empresaId}/banco/movimentos/${movimentoId}/ignorar`, {});
  }
  anexos(empresaId: string, documentoId: string) {
    return this.pedido<Anexo[]>("GET", `/v1/empresas/${empresaId}/documentos/${documentoId}/anexos`);
  }
  /** Endereço para ver/descarregar o original (imagem ou PDF). */
  urlAnexo(empresaId: string, documentoId: string, anexoId: string) {
    return `${this.base}/v1/empresas/${empresaId}/documentos/${documentoId}/anexos/${anexoId}?token=${encodeURIComponent(this.token ?? "")}`;
  }
  urlEnvioAnexo(empresaId: string, documentoId: string) {
    return `${this.base}/v1/empresas/${empresaId}/documentos/${documentoId}/anexos`;
  }
  /** Empresa: pede a anulação (o contabilista decide). Contabilista: anula logo. Nada é apagado. */
  pedirAnulacao(empresaId: string, id: string, motivo: MotivoAnulacao, detalhe?: string) {
    return this.pedido<Documento>("POST", `/v1/empresas/${empresaId}/documentos/${id}/anulacao`, { motivo, ...(detalhe ? { detalhe } : {}) });
  }
  aprovarAnulacao(empresaId: string, id: string) {
    return this.pedido<Documento>("POST", `/v1/empresas/${empresaId}/documentos/${id}/anulacao/aprovar`, {});
  }
  recusarAnulacao(empresaId: string, id: string) {
    return this.pedido<Documento>("POST", `/v1/empresas/${empresaId}/documentos/${id}/anulacao/recusar`, {});
  }
  validarDocumento(empresaId: string, id: string, alteracoes: { contaSugerida?: string; ivaDedutivel?: boolean; terceiroNome?: string } = {}) {
    return this.pedido<Documento>("POST", `/v1/empresas/${empresaId}/documentos/${id}/validar`, alteracoes);
  }

  // ── Lançamentos ──
  lancamentos(empresaId: string, estado?: string) {
    return this.pedido<Lancamento[]>("GET", `/v1/empresas/${empresaId}/lancamentos${estado ? `?estado=${estado}` : ""}`);
  }
  aprovarLancamento(empresaId: string, id: string, versao: number, contaDebito?: string) {
    return this.pedido<Lancamento>("POST", `/v1/empresas/${empresaId}/lancamentos/${id}/aprovar`, { versao, contaDebito });
  }
  aprovarConfiancaAlta(empresaId: string) {
    return this.pedido<{ aprovados: number }>("POST", `/v1/empresas/${empresaId}/lancamentos/aprovar-confianca-alta`, {});
  }
  estornarLancamento(empresaId: string, id: string, versao: number) {
    return this.pedido<Lancamento>("POST", `/v1/empresas/${empresaId}/lancamentos/${id}/estornar`, { versao });
  }

  // ── IVA ──
  apuramento(empresaId: string, periodo: string) {
    return this.pedido<ApuramentoIVA>("GET", `/v1/empresas/${empresaId}/iva/${periodo}`);
  }
  ficheiroDP(empresaId: string, periodo: string) {
    return this.pedido<{ nome: string; xml: string }>("POST", `/v1/empresas/${empresaId}/iva/${periodo}/ficheiro`, {});
  }
  registarSubmissao(empresaId: string, periodo: string, comprovativo: string) {
    return this.pedido<Submissao>("POST", `/v1/empresas/${empresaId}/iva/${periodo}/submissao`, { comprovativo });
  }

  // ── Pedidos ──
  pedidos(empresaId: string) {
    return this.pedido<Pedido[]>("GET", `/v1/empresas/${empresaId}/pedidos`);
  }
  criarPedido(empresaId: string, tipo: string, detalhe: string) {
    return this.pedido<Pedido>("POST", `/v1/empresas/${empresaId}/pedidos`, { tipo, detalhe });
  }
  marcarRecebido(empresaId: string, id: string) {
    return this.pedido<Pedido>("POST", `/v1/empresas/${empresaId}/pedidos/${id}/recebido`, {});
  }

  // ── SAF-T, fecho, prazos, regras, assistente ──
  gerarSAFT(empresaId: string, ano: number) {
    return this.pedido<{ nome: string; xml: string; avisos: string[] }>("POST", `/v1/empresas/${empresaId}/saft/${ano}`, {});
  }
  verificarFecho(empresaId: string, periodo: string) {
    return this.pedido<VerificacaoFecho>("GET", `/v1/empresas/${empresaId}/periodos/${periodo}`);
  }
  fecharPeriodo(empresaId: string, periodo: string) {
    return this.pedido<VerificacaoFecho>("POST", `/v1/empresas/${empresaId}/periodos/${periodo}/fechar`, {});
  }
  prazos(empresaId: string) {
    return this.pedido<{ codigo: string; descricao: string; periodo: string; prazo: string; submetida: boolean }[]>("GET", `/v1/empresas/${empresaId}/prazos`);
  }
  regras() {
    return this.pedido<Regras>("GET", "/v1/regras");
  }
  perguntar(empresaId: string, pergunta: string) {
    return this.pedido<RespostaAssistente>("POST", `/v1/empresas/${empresaId}/assistente`, { pergunta });
  }
  sincronizar(empresaId: string, desde: number) {
    return this.pedido<{ eventos: Evento[]; cursor: number; maisDados: boolean }>("GET", `/v1/empresas/${empresaId}/sync?desde=${desde}`);
  }
}

/**
 * Tempo real: abre um WebSocket, recupera eventos perdidos pelo cursor
 * e volta a ligar sozinho (1 s, 2 s, 4 s… até 30 s).
 */
export class TempoReal {
  private ws: WebSocket | null = null;
  private cursores = new Map<string, number>();
  private tentativa = 0;
  private parado = false;

  constructor(private api: ApiContabia, private empresas: () => string[], private aoReceber: (e: Evento) => void, private aoEstado?: (ligado: boolean) => void) {}

  ligar() {
    this.parado = false;
    const url = this.api.base.replace(/^http/, "ws") + `/v1/tempo-real?token=${encodeURIComponent(this.api.token ?? "")}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = async () => {
      this.tentativa = 0;
      this.aoEstado?.(true);
      for (const id of this.empresas()) await this.recuperar(id);
    };
    ws.onmessage = (m) => {
      const e = JSON.parse(String(m.data)) as Evento;
      const atual = this.cursores.get(e.empresaId) ?? 0;
      if (e.seq > atual) {
        this.cursores.set(e.empresaId, e.seq);
        this.aoReceber(e);
      }
    };
    ws.onclose = () => {
      this.aoEstado?.(false);
      if (this.parado || !this.api.token) return;
      const espera = Math.min(30_000, 1000 * 2 ** this.tentativa++);
      setTimeout(() => {
        if (this.parado) return;
        // confirma a sessão antes de voltar a ligar (uma sessão inválida termina aqui)
        this.api.eu().then(() => this.ligar(), (e: ErroApi) => { if (e.status !== 401) this.ligar(); });
      }, espera);
    };
  }

  async recuperar(empresaId: string) {
    let cursor = this.cursores.get(empresaId) ?? 0;
    for (;;) {
      const r = await this.api.sincronizar(empresaId, cursor);
      for (const e of r.eventos) this.aoReceber(e);
      cursor = r.cursor;
      this.cursores.set(empresaId, cursor);
      if (!r.maisDados) break;
    }
  }

  parar() {
    this.parado = true;
    this.ws?.close();
  }
}

export interface ContagemAvisos { alta: number; normal: number; info: number; total: number }
