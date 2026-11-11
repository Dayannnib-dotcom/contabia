/**
 * Leitura do código QR das faturas portuguesas (Portaria n.º 195/2020).
 * Formato: campos "CHAVE:VALOR" separados por "*".
 */
export interface DadosQR {
  nifEmitente: string;
  nifAdquirente: string;
  paisAdquirente: string;
  tipoDocumento: string;
  estado: string;
  data: string; // ISO YYYY-MM-DD
  identificacao: string;
  atcud: string;
  espacoFiscal: string; // PT, PT-AC, PT-MA
  bases: { isenta: number; reduzida: number; intermedia: number; normal: number };
  iva: { reduzida: number; intermedia: number; normal: number };
  naoSujeito: number;
  totalImpostos: number;
  total: number;
  retencao: number;
  hash: string;
  certificado: string;
}

const num = (v?: string) => (v ? Number(v) : 0);

export function lerQR(texto: string): DadosQR {
  const campos = new Map<string, string>();
  for (const parte of texto.trim().split("*")) {
    const i = parte.indexOf(":");
    if (i > 0) campos.set(parte.slice(0, i), parte.slice(i + 1));
  }
  const obrig = ["A", "B", "D", "F", "G", "H", "I1", "N", "O"];
  const falta = obrig.filter((k) => !campos.has(k));
  if (falta.length) throw new Error(`Código QR incompleto: faltam ${falta.join(", ")}`);
  const f = (k: string) => campos.get(k) ?? "";
  const d = f("F");
  return {
    nifEmitente: f("A"),
    nifAdquirente: f("B"),
    paisAdquirente: f("C") || "PT",
    tipoDocumento: f("D"),
    estado: f("E") || "N",
    data: /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d,
    identificacao: f("G"),
    atcud: f("H"),
    espacoFiscal: f("I1"),
    bases: { isenta: num(f("I2")), reduzida: num(f("I3")), intermedia: num(f("I5")), normal: num(f("I7")) },
    iva: { reduzida: num(f("I4")), intermedia: num(f("I6")), normal: num(f("I8")) },
    naoSujeito: num(f("L")),
    totalImpostos: num(f("N")),
    total: num(f("O")),
    retencao: num(f("P")),
    hash: f("Q"),
    certificado: f("R"),
  };
}

/** Confirma que a soma das bases e do IVA bate com o total do QR. */
export function qrConsistente(q: DadosQR): boolean {
  const bases = q.bases.isenta + q.bases.reduzida + q.bases.intermedia + q.bases.normal + q.naoSujeito;
  const iva = q.iva.reduzida + q.iva.intermedia + q.iva.normal;
  return Math.abs(iva - q.totalImpostos) < 0.02 && Math.abs(bases + q.totalImpostos - q.total) < 0.02;
}
