/** 1967.4 → "1 967,40 €" (formato português). */
export function euros(v: number, simbolo = true): string {
  const sinal = v < 0 ? "−" : "";
  const [int, dec] = Math.abs(v).toFixed(2).split(".");
  const milhares = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${sinal}${milhares},${dec}${simbolo ? " €" : ""}`;
}

/** "2026-11-20" → "20/11/2026" */
export function dataPT(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** "2026-10" → "outubro de 2026"; "2026T3" → "3.º trimestre de 2026" */
export function nomePeriodo(p: string): string {
  const t = /^(\d{4})T(\d)$/.exec(p);
  if (t) return `${t[2]}.º trimestre de ${t[1]}`;
  const m = /^(\d{4})-(\d{2})$/.exec(p);
  if (m) return `${MESES.at(Number(m[2]) - 1)} de ${m[1]}`;
  return p;
}

export function arred(v: number): number {
  return Math.round(v * 100) / 100;
}

/** «Bom dia» até às 12h, «Boa tarde» até às 20h, depois «Boa noite». */
export function saudacao(d: Date = new Date()): string {
  const h = d.getHours();
  return h < 12 ? "Bom dia" : h < 20 ? "Boa tarde" : "Boa noite";
}
