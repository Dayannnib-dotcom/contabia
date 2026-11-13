/**
 * Respostas rápidas do contabilista para os clientes (português de Portugal).
 *
 * Como responder depressa e bem:
 *  1. o aviso já traz a resposta sugerida, com os dados preenchidos (empresa, prazo, documento);
 *  2. um toque abre o WhatsApp do contabilista (wa.me) ou o e-mail com o texto pronto;
 *  3. o contabilista revê e carrega em enviar — a mensagem sai do número/e-mail dele, que o cliente já conhece.
 * Sem custos nem aprovação da Meta. O envio automático (WhatsApp Business Platform) pode vir depois,
 * pelo Activepieces, com modelos aprovados.
 */

export type IdResposta =
  | "pedir_documento"
  | "lembrete_pedido"
  | "lembrete_prazo"
  | "documentos_recebidos"
  | "resposta_pergunta"
  | "anulacao_aprovada"
  | "anulacao_recusada"
  | "iva_a_pagar"
  | "estudo_recebido"
  | "boas_vindas"
  | "livre";

export interface ContextoResposta {
  empresa: string;
  contacto?: string | null;
  contabilista?: string | null;
  prazo?: string | null; // AAAA-MM-DD
  obrigacao?: string | null;
  documento?: string | null;
  valor?: number | null;
  pergunta?: string | null;
}

export interface ModeloResposta { id: IdResposta; nome: string; assunto: (c: ContextoResposta) => string; texto: (c: ContextoResposta) => string }

const dataPT = (iso?: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "");
const euro = (v?: number | null) => (v == null ? "" : new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(v));
const ola = (c: ContextoResposta) => (c.contacto ? `Olá, ${c.contacto.split(" ")[0]}.` : "Olá.");
const ass = (c: ContextoResposta) => (c.contabilista ? `\n\nCumprimentos,\n${c.contabilista}` : "\n\nCumprimentos.");

export const MODELOS_RESPOSTA: ModeloResposta[] = [
  {
    id: "pedir_documento", nome: "Pedir documento",
    assunto: (c) => `${c.empresa} — documento em falta`,
    texto: (c) => `${ola(c)} Para fechar a contabilidade${c.obrigacao ? ` (${c.obrigacao})` : ""}, preciso de: ${c.documento ?? "[documento]"}.\nPode fotografá-lo na app Contabia ou responder a esta mensagem com o ficheiro.${c.prazo ? ` Se possível, até ${dataPT(c.prazo)}.` : ""}${ass(c)}`,
  },
  {
    id: "lembrete_pedido", nome: "Lembrar pedido",
    assunto: (c) => `${c.empresa} — lembrete: ${c.documento ?? "documento pendente"}`,
    texto: (c) => `${ola(c)} Só um lembrete: ainda falta ${c.documento ?? "o documento que pedi"}. Basta fotografá-lo na app Contabia.${c.prazo ? ` O prazo termina a ${dataPT(c.prazo)}.` : ""}${ass(c)}`,
  },
  {
    id: "lembrete_prazo", nome: "Lembrar prazo",
    assunto: (c) => `${c.empresa} — ${c.obrigacao ?? "prazo fiscal"}${c.prazo ? ` até ${dataPT(c.prazo)}` : ""}`,
    texto: (c) => `${ola(c)} ${c.obrigacao ?? "A próxima obrigação"} termina a ${c.prazo ? dataPT(c.prazo) : "[data]"}. Para eu submeter a tempo, envie pela app Contabia as faturas que ainda não carregou (compras e vendas).${ass(c)}`,
  },
  {
    id: "documentos_recebidos", nome: "Confirmar receção",
    assunto: (c) => `${c.empresa} — documentos recebidos`,
    texto: (c) => `${ola(c)} Recebi os documentos, obrigado. Vou tratar deles e aviso se faltar alguma coisa.${ass(c)}`,
  },
  {
    id: "resposta_pergunta", nome: "Responder à pergunta",
    assunto: (c) => `${c.empresa} — a sua pergunta`,
    texto: (c) => `${ola(c)}${c.pergunta ? ` Sobre a sua pergunta («${c.pergunta.slice(0, 160)}»):` : ""} \n[resposta]${ass(c)}`,
  },
  {
    id: "anulacao_aprovada", nome: "Anulação aprovada",
    assunto: (c) => `${c.empresa} — documento anulado`,
    texto: (c) => `${ola(c)} Confirmei a anulação de ${c.documento ?? "o documento"}. Fica guardado no arquivo como anulado, como a lei exige.${ass(c)}`,
  },
  {
    id: "anulacao_recusada", nome: "Anulação recusada",
    assunto: (c) => `${c.empresa} — documento mantido`,
    texto: (c) => `${ola(c)} Mantive ${c.documento ?? "o documento"} na contabilidade porque [motivo]. Se tiver dúvidas, falamos.${ass(c)}`,
  },
  {
    id: "iva_a_pagar", nome: "IVA a pagar",
    assunto: (c) => `${c.empresa} — IVA a pagar${c.prazo ? ` até ${dataPT(c.prazo)}` : ""}`,
    texto: (c) => `${ola(c)} A declaração de IVA está submetida. O valor a pagar é ${euro(c.valor) || "[valor]"}${c.prazo ? `, até ${dataPT(c.prazo)}` : ""}. A referência de pagamento está no Portal das Finanças.${ass(c)}`,
  },
  {
    id: "estudo_recebido", nome: "Estudo de viabilidade",
    assunto: (c) => `${c.empresa} — estudo de viabilidade`,
    texto: (c) => `${ola(c)} Recebemos o seu pedido de estudo de viabilidade económica. Para começar, gostava de marcar 20 minutos para perceber o projeto. Que dia lhe dá jeito esta semana?${ass(c)}`,
  },
  {
    id: "boas_vindas", nome: "Boas-vindas",
    assunto: (c) => `Bem-vinda, ${c.empresa}`,
    texto: (c) => `${ola(c)} Bem-vinda à carteira. A partir de agora, basta fotografar as faturas na app Contabia: eu vejo-as no mesmo instante e aviso-a dos prazos. Qualquer dúvida, responda a esta mensagem.${ass(c)}`,
  },
  {
    id: "livre", nome: "Mensagem livre",
    assunto: (c) => c.empresa,
    texto: (c) => `${ola(c)} ${ass(c).trimStart()}`,
  },
];

export function gerarResposta(id: IdResposta, c: ContextoResposta) {
  const m = MODELOS_RESPOSTA.find((x) => x.id === id) ?? MODELOS_RESPOSTA[MODELOS_RESPOSTA.length - 1];
  return { id: m.id, nome: m.nome, assunto: m.assunto(c), texto: m.texto(c) };
}

/** Telefone em formato internacional só com algarismos (Portugal por omissão). Null se não for válido. */
export function telefoneInternacional(t?: string | null): string | null {
  if (!t) return null;
  let d = t.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (/^[29]\d{8}$/.test(d)) d = "351" + d; // fixo (2…) ou móvel (9…) português
  return /^\d{8,15}$/.test(d) ? d : null;
}

/** Ligação que abre o WhatsApp com a mensagem já escrita (o contabilista só carrega em enviar). */
export function ligacaoWhatsApp(telefone: string | null | undefined, texto: string): string | null {
  const n = telefoneInternacional(telefone);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(texto)}` : null;
}

/** Ligação que abre o e-mail com destinatário, assunto e texto preenchidos. */
export function ligacaoEmail(email: string | null | undefined, assunto: string, texto: string): string | null {
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return null;
  return `mailto:${email}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(texto)}`;
}

// ── Avisos do contabilista ──

export type Urgencia = "alta" | "normal" | "info";

export interface Notificacao {
  id: string;
  empresaId: string | null;
  empresaNome: string | null;
  tipo: string;
  titulo: string;
  corpo: string;
  urgencia: Urgencia;
  /** Resposta rápida sugerida para este aviso, já com o contexto. */
  resposta: { id: IdResposta; contexto: ContextoResposta } | null;
  /** Para onde levar o contabilista ao tocar (separador da empresa). */
  abrir: { empresaId: string; separador?: string } | null;
  /** Contacto do cliente para responder já (WhatsApp / e-mail). */
  contacto: { nome: string | null; telefone: string | null; email: string | null } | null;
  lida: boolean;
  criadaEm: string;
  atualizadaEm: string;
}

export const NOME_URGENCIA: Record<Urgencia, string> = { alta: "Urgente", normal: "Para tratar", info: "Para saber" };
