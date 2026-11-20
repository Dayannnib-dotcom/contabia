import { View } from "react-native";
import { NOME_CATEGORIA_CASA, REGRAS_CASA, type CategoriaCasa } from "@contabia/shared";
import { Botao, Texto } from "@contabia/ui";

export const CATEGORIAS_CASA: CategoriaCasa[] = ["gerais", "saude", "educacao", "rendas", "exigencia", "sem_deducao"];

/** Escolha da categoria de IRS, com a explicação da escolhida. */
export function EscolherCategoria({ valor, aoMudar }: { valor: CategoriaCasa; aoMudar: (c: CategoriaCasa) => void }) {
  return (
    <View style={{ gap: 8 }}>
      <Texto forte tamanho={14}>Categoria no IRS</Texto>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {CATEGORIAS_CASA.map((c) => (
          <Botao key={c} titulo={NOME_CATEGORIA_CASA[c]} variante={valor === c ? "principal" : "secundario"} onPress={() => aoMudar(c)} estilo={{ minHeight: 40, paddingHorizontal: 12 }} />
        ))}
      </View>
      {valor !== "sem_deducao" ? <Texto sec tamanho={12}>{REGRAS_CASA[valor].ajuda}</Texto> : <Texto sec tamanho={12}>Fica guardada, mas não conta para as deduções.</Texto>}
    </View>
  );
}
