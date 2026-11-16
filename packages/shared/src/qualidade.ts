/**
 * Auditor de qualidade (auditoria técnica, 16/11/2026): só regras, sem IA.
 * Os erros certos já são recusados ao registar (NIF inválido, IVA incoerente, número repetido,
 * data futura, período fechado). Aqui ficam os casos PROVÁVEIS, que só o contabilista decide:
 * avisa-o, não bloqueia a empresa.
 */
export type TipoAlerta = "possivel_duplicado" | "periodo_ja_declarado" | "fornecedor_novo_valor_alto" | "documento_antigo";

export interface AlertaQualidade {
  tipo: TipoAlerta;
  urgencia: "alta" | "normal";
  titulo: string;
  detalhe: string;
}

export interface DocumentoAuditado {
  tipo: string;
  numero: string;
  data: string; // AAAA-MM-DD
  total: number;
  terceiroNome: string;
}

export interface ContextoQualidade {
  hoje: string;
  /** Documentos do mesmo terceiro, com o mesmo total e outro número, até 5 dias de distância. */
  semelhantes: { numero: string; data: string }[];
  /** Quantos documentos já existiam deste terceiro. */
  documentosDoTerceiro: number;
  /** Total médio das compras da empresa (null se ainda não há histórico). */
  mediaCompras: number | null;
  /** Período de IVA do documento («2026-10» ou «2026T3») se a declaração já foi submetida. */
  periodoDeclarado: string | null;
}

const dataPT = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const euros = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;

export const LIMIAR_VALOR_ALTO = 1000;

export function auditarDocumento(d: DocumentoAuditado, c: ContextoQualidade): AlertaQualidade[] {
  const alertas: AlertaQualidade[] = [];
  if (c.periodoDeclarado) {
    alertas.push({
      tipo: "periodo_ja_declarado", urgencia: "alta",
      titulo: `Documento num período de IVA já declarado`,
      detalhe: `${d.numero} (${dataPT(d.data)}) pertence a um período cuja declaração periódica já foi submetida. Pode exigir declaração de substituição ou entrar no período seguinte.`,
    });
  }
  if (c.semelhantes.length) {
    const s = c.semelhantes[0];
    alertas.push({
      tipo: "possivel_duplicado", urgencia: "normal",
      titulo: `Possível despesa repetida: ${d.terceiroNome}`,
      detalhe: `${d.numero} tem o mesmo valor (${euros(d.total)}) que ${s.numero} de ${dataPT(s.data)}. Pode ser a mesma despesa com outro documento (por exemplo, fatura e fatura-recibo).`,
    });
  }
  if (d.tipo === "compra" && c.documentosDoTerceiro === 0) {
    const limite = Math.max(LIMIAR_VALOR_ALTO, (c.mediaCompras ?? 0) * 5);
    if (d.total >= limite) {
      alertas.push({
        tipo: "fornecedor_novo_valor_alto", urgencia: "normal",
        titulo: `Fornecedor novo com valor alto: ${d.terceiroNome}`,
        detalhe: `Primeira compra a este fornecedor, de ${euros(d.total)}. Confirme a conta e se é investimento (ativo) ou gasto do período.`,
      });
    }
  }
  const dias = Math.round((Date.parse(c.hoje) - Date.parse(d.data)) / 86400000);
  if (dias > 365) {
    alertas.push({
      tipo: "documento_antigo", urgencia: "normal",
      titulo: `Documento com mais de um ano`,
      detalhe: `${d.numero} é de ${dataPT(d.data)}. Confirme se ainda deve entrar na contabilidade e em que período.`,
    });
  }
  return alertas;
}
