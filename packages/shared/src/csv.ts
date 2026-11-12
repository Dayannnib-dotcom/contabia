/** Utilitários de leitura de CSV portugueses (vírgula decimal, datas dd/mm/aaaa). */
export const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function separarLinha(l: string, sep: string): string[] {
  const out: string[] = [];
  let atual = "";
  let aspas = false;
  for (let i = 0; i < l.length; i++) {
    const c = l[i];
    if (c === '"') {
      if (aspas && l[i + 1] === '"') { atual += '"'; i++; } else aspas = !aspas;
    } else if (c === sep && !aspas) {
      out.push(atual.trim());
      atual = "";
    } else atual += c;
  }
  out.push(atual.trim());
  return out;
}

export function numero(v: string): number {
  const s = v.replace(/[€\s]/g, "");
  if (!s) return 0;
  // 1.234,56 → 1234.56 ; 1234.56 fica igual
  const n = s.includes(",") ? Number(s.replace(/\./g, "").replace(",", ".")) : Number(s);
  return Number.isFinite(n) ? n : NaN;
}

export function dataISO(v: string): string | null {
  const s = v.trim().slice(0, 10);
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

/** Encontra a coluna cujo nome contém todas as palavras de uma das alternativas. */
export function coluna(cab: string[], ...alternativas: string[][]): number {
  for (const palavras of alternativas) {
    const i = cab.findIndex((c) => palavras.every((p) => c.includes(p)));
    if (i >= 0) return i;
  }
  return -1;
}

