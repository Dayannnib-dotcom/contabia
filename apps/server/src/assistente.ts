/**
 * Luís — assistente virtual. Com ANTHROPIC_API_KEY usa um modelo de linguagem
 * com o contexto da empresa; sem chave, responde às perguntas frequentes por regras.
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
Respondes em português europeu, tratas o utilizador por «você», em frases curtas, sempre com o passo seguinte.
Respondes só a dúvidas simples de contabilidade e fiscalidade portuguesa, citando a fonte legal (artigo e código).
Nunca tomas decisões fiscais nem dizes que és Contabilista Certificado. Se a questão for complexa, ambígua
ou com impacto fiscal relevante, diz que vais encaminhá-la para o contabilista.
Responde em JSON: {"resposta": string, "fontes": string[], "encaminharParaContabilista": boolean}.`;

export async function perguntar(pergunta: string, ctx: ContextoAssistente, chaveApi?: string): Promise<RespostaAssistente> {
  if (chaveApi) {
    try {
      return await perguntarModelo(pergunta, ctx, chaveApi);
    } catch {
      // sem rede ou erro do serviço: continua com as regras locais
    }
  }
  return responderPorRegras(pergunta, ctx);
}

async function perguntarModelo(pergunta: string, ctx: ContextoAssistente, chave: string): Promise<RespostaAssistente> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": chave, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.MODELO_IA ?? "claude-sonnet-5-5",
      max_tokens: 600,
      system: SISTEMA,
      messages: [{ role: "user", content: `Contexto da empresa: ${JSON.stringify(ctx)}\n\nPergunta: ${pergunta}` }],
    }),
  });
  if (!r.ok) throw new Error(`IA ${r.status}`);
  const j = (await r.json()) as { content: { type: string; text: string }[] };
  const texto = j.content.find((c) => c.type === "text")?.text ?? "";
  const json = JSON.parse(texto.slice(texto.indexOf("{"), texto.lastIndexOf("}") + 1));
  return { resposta: String(json.resposta), fontes: (json.fontes ?? []).map(String), encaminharParaContabilista: !!json.encaminharParaContabilista };
}

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
      resposta: "As faturas emitidas comunicam-se à AT até ao dia 5 do mês seguinte. Se não houver faturação, tem de comunicar a inexistência. Na Contabia o envio é automático.",
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
  if (tem("fatura-recibo", "fatura recibo", "emitir")) {
    return {
      resposta: "Use «Emitir fatura»: indique cliente, serviço e valor, ou dite por voz. A fatura-recibo regista a fatura e o recebimento de uma vez; o ATCUD e o código QR são gerados na emissão.",
      fontes: ["CIVA, art. 36.º", "Portaria n.º 195/2020"], encaminharParaContabilista: false,
    };
  }
  return {
    resposta: "Essa questão merece a análise do seu contabilista. Já lha encaminhei com o contexto da empresa; ele responde-lhe aqui.",
    fontes: [], encaminharParaContabilista: true,
  };
}
