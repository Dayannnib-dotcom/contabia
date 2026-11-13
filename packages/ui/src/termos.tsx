import { Linking, Platform, Pressable } from "react-native";
import { Texto } from "./componentes";
import { useSessao } from "./sessao";
import { cor } from "./tema";

/** Ligação para os Termos e Condições (página do servidor). */
export function LigacaoTermos({ prefixo = "", tamanho = 13 }: { prefixo?: string; tamanho?: number }) {
  const { api } = useSessao();
  const url = `${api.base.replace(/\/$/, "")}/termos`;
  const abrir = () => (Platform.OS === "web" ? void window.open(url, "_blank", "noopener") : void Linking.openURL(url));
  return (
    <Pressable accessibilityRole="link" accessibilityLabel="Termos e Condições" onPress={abrir}>
      <Texto tamanho={tamanho} cor={cor.textoSec}>{prefixo}<Texto tamanho={tamanho} forte cor={cor.verde}>Termos e Condições</Texto></Texto>
    </Pressable>
  );
}
