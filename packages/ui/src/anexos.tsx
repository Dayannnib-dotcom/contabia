import { Image, Linking, Platform, Pressable, View } from "react-native";
import type { Anexo, ApiContabia } from "@contabia/shared";
import { Botao, Texto } from "./componentes";
import { cor } from "./tema";

const abrir = (url: string) => (Platform.OS === "web" ? void window.open(url, "_blank") : void Linking.openURL(url));

/** Mostra os originais guardados na nuvem (fotos em miniatura, PDF como botão). */
export function ListaAnexos({ api, empresaId, documentoId, anexos }: { api: ApiContabia; empresaId: string; documentoId: string; anexos: Anexo[] }) {
  if (!anexos.length) return null;
  return (
    <View style={{ gap: 10 }}>
      {anexos.map((a) => {
        const url = api.urlAnexo(empresaId, documentoId, a.id);
        return a.tipo.startsWith("image/") ? (
          <Pressable key={a.id} accessibilityRole="imagebutton" accessibilityLabel={`Abrir ${a.nome}`} onPress={() => abrir(url)}>
            <Image source={{ uri: url }} resizeMode="contain" style={{ width: "100%", height: 260, borderRadius: 10, backgroundColor: cor.fundo }} />
            <Texto sec tamanho={11}>{a.nome} · {Math.max(1, Math.round(a.tamanho / 1024))} KB · guardado a {a.criadoEm.slice(0, 10).split("-").reverse().join("/")}</Texto>
          </Pressable>
        ) : (
          <Botao key={a.id} titulo={`Abrir ${a.nome}`} variante="secundario" onPress={() => abrir(url)} />
        );
      })}
    </View>
  );
}

/** Para o contabilista: abre o original da fatura ligada a um lançamento. */
export function VerOriginal({ api, empresaId, documentoId }: { api: ApiContabia; empresaId: string; documentoId: string }) {
  return (
    <Pressable accessibilityRole="link" onPress={async () => {
      const lista = await api.anexos(empresaId, documentoId).catch(() => []);
      if (lista[0]) abrir(api.urlAnexo(empresaId, documentoId, lista[0].id));
    }}>
      <Texto tamanho={12} cor={cor.verde}>Ver original da fatura ›</Texto>
    </Pressable>
  );
}
