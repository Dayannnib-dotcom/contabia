/** Valida um NIF português: 9 dígitos e dígito de controlo módulo 11. */
export function validarNIF(entrada: string): boolean {
  const nif = limparNIF(entrada);
  if (!/^\d{9}$/.test(nif)) return false;
  if (!"12356789".includes(nif.charAt(0))) return false;
  let soma = 0;
  for (let i = 0; i < 8; i++) soma += Number(nif.charAt(i)) * (9 - i);
  const resto = soma % 11;
  const controlo = resto < 2 ? 0 : 11 - resto;
  return controlo === Number(nif.charAt(8));
}

export function limparNIF(entrada: string): string {
  return entrada.replace(/[\s.-]/g, "");
}

/** Formata para leitura: 509 999 999 */
export function formatarNIF(nif: string): string {
  const n = limparNIF(nif);
  return n.length === 9 ? `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}` : n;
}

/** Mensagem de ajuda enquanto o utilizador escreve. */
export function ajudaNIF(entrada: string): { estado: "vazio" | "incompleto" | "valido" | "invalido"; mensagem: string } {
  const n = limparNIF(entrada);
  if (!n) return { estado: "vazio", mensagem: "O NIF é validado à medida que escreve." };
  if (!/^\d+$/.test(n)) return { estado: "invalido", mensagem: "O NIF só tem algarismos." };
  if (n.length < 9) return { estado: "incompleto", mensagem: `Faltam ${9 - n.length} dígitos.` };
  if (n.length > 9) return { estado: "invalido", mensagem: "O NIF tem 9 dígitos." };
  return validarNIF(n)
    ? { estado: "valido", mensagem: "NIF válido" }
    : { estado: "invalido", mensagem: "NIF inválido: o dígito de controlo não confere." };
}

/** Utilizador da empresa: minúsculas, sem acentos nem espaços. */
export function normalizarUtilizador(u: string): string {
  return u.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, ".");
}

export function utilizadorValido(u: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{2,39}$/.test(normalizarUtilizador(u));
}
