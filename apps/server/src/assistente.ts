/**
 * Luís — assistente virtual. Perguntas frequentes por regras; com ANTHROPIC_API_KEY, o resto vai
 * primeiro ao modelo rápido (Haiku) e só ao forte (Sonnet) quando é preciso, com limite mensal por empresa.
 * Responde sempre com fonte e encaminha para o contabilista o que não for simples.
 */
import { euros, nomePeriodo, type Empresa, type RespostaAssistente } from "@contabia/shared";

export interface ContextoAssistente {
  empresa: Empresa;
  ivaPeriodo?: { periodo: string; valor: number; aFavorDoEstado: boolean; pendentes: number };
  pedidosPendentes: string[];
  documentosPorValidar: number;
  proximoPrazo?: { descricao: string; prazo: string };
}

const SISTEMA = `És o Luís, assistente virtual da Contabia, uma app de contabilidade para empresas em Portugal.
Respondes em português de Portugal (telemóvel, ecrã, ficheiro; «a + infinitivo»), em tratamento formal na 3.ª pessoa,
sem nunca escrever «você», «tu» nem «o senhor»: usas o verbo sem sujeito ou «o seu / a sua».
Tom calmo, concreto e próximo: no máximo 3 frases curtas — a resposta direta, o porquê com a fonte, o passo seguinte.
Nunca usas «a única», «a melhor», «garantido», pontos de exclamação em avisos nem emojis.
Respondes só a dúvidas simples de contabilidade e fiscalidade portuguesa, citando a fonte legal (artigo e código).
Nunca tomas decisões fiscais nem dizes que és Contabilista Certificado. Se a questão for complexa, ambígua
ou com impacto fiscal relevante, diz que vais encaminhá-la para o contabilista.
Responde em JSON: {"resposta": string, "fontes": string[], "encaminharParaContabilista": boolean, "confianca": "alta" | "baixa"}.
Usa "baixa" quando não tens a certeza da regra ou da fonte.`;

/** Modelo rápido e barato por omissão; o forte só quando o rápido indica pouca confiança. */
const MODELO_RAPIDO = process.env.MODELO_IA ?? "claude-haiku-5-5";
const MODELO_FORTE = process.env.MODELO_IA_FORTE ?? "claude-sonnet-5-5";
const TEMPO_MAXIMO_MS = 15_000;

export interface OpcoesIA {
  chaveApi?: string;
  /** Chamado antes de cada pedido ao modelo; devolve false quando a empresa chegou ao limite do mês. */
  podeUsar?: () => Promise<boolean>;
  /** Regista o uso (para o limite mensal e para o custo). */
  registarUso?: (modelo: string, entrada: number, saida: number) => Promise<void>;
  /** Para os testes: substitui a chamada à API. */
  chamar?: ChamarModelo;
}
export type ChamarModelo = (modelo: string, pergunta: string, ctx: ContextoAssistente, chave: string) => Promise<RespostaModelo>;
interface RespostaModelo extends RespostaAssistente { confianca: "alta" | "baixa"; entrada: number; saida: number }

/**
 * Escada de custo: 1) perguntas frequentes por regras (grátis); 2) modelo rápido;
 * 3) modelo forte só se o rápido tiver pouca confiança; 4) contabilista.
 * Sem chave, sem rede, sem orçamento ou com erro: volta às regras, que encaminham o resto.
 */
export async function perguntar(pergunta: string, ctx: ContextoAssistente, opcoes: OpcoesIA | string = {}): Promise<RespostaAssistente> {
  const o: OpcoesIA = typeof opcoes === "string" ? { chaveApi: opcoes } : opcoes;
  const porRegras = responderPorRegras(pergunta, ctx);
  if (!porRegras.encaminharParaContabilista || !o.chaveApi) return porRegras;
  const chamar = o.chamar ?? chamarModelo;
  try {
    if (o.podeUsar && !(await o.podeUsar())) return porRegras;
    const r1 = await chamar(MODELO_RAPIDO, pergunta, ctx, o.chaveApi);
    await o.registarUso?.(MODELO_RAPIDO, r1.entrada, r1.saida);
    if (r1.confianca === "alta" || r1.encaminharParaContabilista) return limpar(r1);
    if (o.podeUsar && !(await o.podeUsar())) return limpar(r1);
    const r2 = await chamar(MODELO_FORTE, pergunta, ctx, o.chaveApi);
    await o.registarUso?.(MODELO_FORTE, r2.entrada, r2.saida);
    return limpar(r2);
  } catch {
    return porRegras; // sem rede, tempo esgotado ou resposta inválida
  }
}

const limpar = (r: RespostaModelo): RespostaAssistente => ({ resposta: r.resposta, fontes: r.fontes, encaminharParaContabilista: r.encaminharParaContabilista });

const chamarModelo: ChamarModelo = async (modelo, pergunta, ctx, chave) => {
  const r = await fetch(process.env.URL_IA ?? "https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal: AbortSignal.timeout(TEMPO_MAXIMO_MS),
    headers: { "x-api-key": chave, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: modelo,
      max_tokens: 600,
      // as instruções fixas ficam em cache: cada leitura custa uma fração do preço normal
      system: [{ type: "text", text: SISTEMA, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `Contexto da empresa: ${JSON.stringify(ctx)}\n\nPergunta: ${pergunta}` }],
    }),
  });
  if (!r.ok) throw new Error(`IA ${r.status}`);
  const j = (await r.json()) as { content: { type: string; text: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
  const texto = j.content.find((c) => c.type === "text")?.text ?? "";
  const json = JSON.parse(texto.slice(texto.indexOf("{"), texto.lastIndexOf("}") + 1));
  if (typeof json.resposta !== "string" || !json.resposta.trim()) throw new Error("resposta vazia");
  return {
    resposta: json.resposta.trim(),
    fontes: Array.isArray(json.fontes) ? json.fontes.map(String).slice(0, 5) : [],
    encaminharParaContabilista: !!json.encaminharParaContabilista,
    confianca: json.confianca === "baixa" ? "baixa" : "alta",
    entrada: j.usage?.input_tokens ?? 0,
    saida: j.usage?.output_tokens ?? 0,
  };
};

export function responderPorRegras(pergunta: string, ctx: ContextoAssistente): RespostaAssistente {
  const p = pergunta.toLowerCase();
  const tem = (...ps: string[]) => ps.some((x) => p.includes(x));

  if (tem("refei", "almoço", "almoco", "jantar", "restaurante")) {
    return {
      resposta: "Em regra, não. O IVA de refeições e despesas de receção está excluído do direito à dedução, salvo exceções. A despesa pode contar para o IRC, sujeita a tributação autónoma. Peça sempre fatura com o NIF da empresa.",
      fontes: ["CIVA, art. 21.º"], encaminharParaContabilista: false,
    };
  }
  if (tem("comunicar", "e-fatura", "efatura", "saf-t de fatura")) {
    return {
      resposta: "As faturas emitidas comunicam-se à AT até ao dia 5 do mês seguinte. Se não houver faturação, tem de comunicar a inexistência. O seu contabilista confirma que a comunicação está feita.",
      fontes: ["DL n.º 198/2012, art. 3.º"], encaminharParaContabilista: false,
    };
  }
  if (tem("quanto iva", "iva vou pagar", "iva a pagar", "iva deste")) {
    const i = ctx.ivaPeriodo;
    if (!i) return { resposta: "Ainda não tenho lançamentos suficientes para estimar o IVA. Valide os documentos do período e volto a calcular.", fontes: [], encaminharParaContabilista: false };
    return {
      resposta: `Com os documentos lançados até hoje, ${nomePeriodo(i.periodo)}: ${i.aFavorDoEstado ? "a entregar" : "a recuperar"} ${euros(i.valor)}.${i.pendentes ? ` Ainda há ${i.pendentes} lançamentos por rever, por isso o valor pode mudar.` : ""}`,
      fontes: ["Apuramento Contabia"], encaminharParaContabilista: false,
    };
  }
  if (tem("falta", "pendente", "documentos")) {
    const itens = [
      ...ctx.pedidosPendentes.map((x) => `«${x}» (pedido do contabilista)`),
      ...(ctx.documentosPorValidar ? [`${ctx.documentosPorValidar} documentos por validar`] : []),
    ];
    return {
      resposta: itens.length ? `Falta: ${itens.join("; ")}.` : "Não falta nada. Está tudo em dia.",
      fontes: [], encaminharParaContabilista: false,
    };
  }
  if (tem("prazo", "quando", "até quando")) {
    const pz = ctx.proximoPrazo;
    return {
      resposta: pz ? `O próximo prazo é «${pz.descricao}», até ${pz.prazo.split("-").reverse().join("/")}.` : "Não há prazos próximos.",
      fontes: ["Calendário fiscal Contabia"], encaminharParaContabilista: false,
    };
  }
  if (tem("fatura-recibo", "fatura recibo")) {
    return {
      resposta: "A fatura-recibo regista a venda e o recebimento num só documento, e tem de ter o ATCUD e o código QR. Emita-a no seu programa de faturação certificado e fotografe o QR na Contabia para o seu contabilista a receber.",
      fontes: ["CIVA, art. 36.º", "Portaria n.º 195/2020"], encaminharParaContabilista: false,
    };
  }
  return {
    resposta: "Essa questão merece a análise do seu contabilista. Já lha encaminhei com o contexto da empresa; ele responde-lhe aqui.",
    fontes: [], encaminharParaContabilista: true,
  };
}
