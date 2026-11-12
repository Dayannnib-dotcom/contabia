import { Platform, Share } from "react-native";

/**
 * Partilha texto. No telemóvel abre a folha de partilha; no navegador usa a
 * partilha nativa se existir, senão copia para a área de transferência.
 * Devolve "partilhado", "copiado" ou "cancelado".
 */
export async function partilhar(texto: string, titulo = "Contabia"): Promise<"partilhado" | "copiado" | "cancelado"> {
  if (Platform.OS === "web") {
    const nav = globalThis.navigator as Navigator | undefined;
    try {
      if (nav?.share) {
        await nav.share({ title: titulo, text: texto });
        return "partilhado";
      }
    } catch {
      return "cancelado";
    }
    try {
      await nav?.clipboard?.writeText(texto);
      return "copiado";
    } catch {
      return "cancelado";
    }
  }
  try {
    const r = await Share.share({ title: titulo, message: texto });
    return r.action === Share.dismissedAction ? "cancelado" : "partilhado";
  } catch {
    return "cancelado";
  }
}

/**
 * Entrega um ficheiro (ex.: SAF-T, DP IVA). No navegador descarrega-o;
 * no telemóvel abre a folha de partilha com o conteúdo.
 */
export async function entregarFicheiro(nome: string, conteudo: string, tipo = "application/xml"): Promise<"descarregado" | "partilhado" | "copiado" | "cancelado"> {
  if (Platform.OS === "web" && typeof document !== "undefined") {
    try {
      const url = URL.createObjectURL(new Blob([conteudo], { type: `${tipo};charset=utf-8` }));
      const a = document.createElement("a");
      a.href = url;
      a.download = nome;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return "descarregado";
    } catch {
      return partilhar(conteudo, nome);
    }
  }
  return partilhar(conteudo, nome);
}
