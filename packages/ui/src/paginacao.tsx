import { useEffect, useState } from "react";
import { Botao } from "./componentes";

/**
 * Mostra listas longas aos poucos (por defeito 50 de cada vez), para o telemóvel não
 * desenhar centenas de documentos de uma vez. Volta ao início quando `chave` muda
 * (por exemplo, ao mudar de filtro ou de pesquisa).
 */
export function usePaginacao<T>(lista: T[], chave: unknown, passo = 50) {
  const [limite, setLimite] = useState(passo);
  useEffect(() => setLimite(passo), [chave, passo]);
  return {
    visiveis: lista.slice(0, limite),
    resto: Math.max(0, lista.length - limite),
    mostrarMais: () => setLimite((l) => l + passo),
  };
}

export function MostrarMais({ resto, passo = 50, onPress }: { resto: number; passo?: number; onPress: () => void }) {
  if (resto <= 0) return null;
  return <Botao titulo={`Mostrar mais ${Math.min(resto, passo)} (faltam ${resto})`} variante="contorno" onPress={onPress} />;
}
