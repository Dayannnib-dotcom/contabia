/**
 * Conciliação bancária: para cada movimento do extrato procura a fatura com o mesmo
 * valor e explica porquê (como fazem as melhores apps): valor, proximidade da data e
 * nome/NIF do fornecedor na descrição. Só sugere; a confirmação é humana, exceto
 * quando o próprio contabilista manda conciliar as de confiança alta.
 */
export interface DocConc { id: string; tipo: string; terceiro_nif: string; terceiro_nome: string; numero: string; data: string; total: number }
export interface Sugestao { documentoId: string; motivo: string; confianca: "alta" | "media"; pontos: number }

const PALAVRAS_VAZIAS = new Set(["LDA", "UNIPESSOAL", "SA", "S.A.", "DE", "DA", "DO", "DOS", "DAS", "E", "COMPRA", "PAGAMENTO", "TRF", "MB", "WAY"]);
const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
const euros = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;
const dias = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

export function sugerir(mov: { data: string; descricao: string; valor: number }, docs: DocConc[], usados: Set<string>): Sugestao | null {
  const tipo = mov.valor < 0 ? "compra" : "venda";
  const valor = Math.abs(mov.valor);
  const desc = sem(mov.descricao);
  const candidatos = docs
    .filter((d) => d.tipo === tipo && !usados.has(d.id) && Math.abs(Number(d.total) - valor) < 0.005)
    .map((d) => {
      const dd = dias(d.data, mov.data); // pagamento depois da fatura = positivo
      if (dd < -10 || dd > 120) return null;
      let pontos = 60;
      const razoes = [`mesmo valor (${euros(valor)})`];
      if (Math.abs(dd) <= 7) { pontos += 20; razoes.push(dd === 0 ? "no mesmo dia da fatura" : `${Math.abs(dd)} dias ${dd >= 0 ? "depois" : "antes"} da fatura`); }
      else if (dd <= 45) { pontos += 10; razoes.push(`${dd} dias depois da fatura`); }
      const palavra = sem(d.terceiro_nome).split(/[^A-Z0-9]+/).find((p) => p.length >= 4 && !PALAVRAS_VAZIAS.has(p) && desc.includes(p));
      if (desc.includes(d.terceiro_nif)) { pontos += 25; razoes.push("a descrição tem o NIF do fornecedor"); }
      else if (palavra) { pontos += 25; razoes.push(`a descrição menciona «${palavra}»`); }
      return { d, pontos, razoes };
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => b.pontos - a.pontos);
  if (!candidatos.length) return null;
  const [melhor, segundo] = candidatos;
  const empate = segundo && segundo.pontos === melhor.pontos;
  const confianca = melhor.pontos >= 85 && !empate ? "alta" : "media";
  const motivo = `${melhor.d.numero} de ${melhor.d.terceiro_nome}: ${melhor.razoes.join(", ")}${empate ? ". Atenção: há outra fatura com o mesmo valor" : ""}.`;
  return { documentoId: melhor.d.id, motivo: motivo.charAt(0).toUpperCase() + motivo.slice(1), confianca, pontos: melhor.pontos };
}
