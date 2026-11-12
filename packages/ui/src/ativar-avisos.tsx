import { useEffect, useState } from "react";
import { View } from "react-native";
import { agendarAvisos, permissaoAvisos, type AvisoPrazo } from "./avisos";
import { Botao, Texto } from "./componentes";
import { cor } from "./tema";

/** Mostra se os avisos de prazos estão ligados; se não, um botão para os ativar. */
export function AtivarAvisos({ avisos }: { avisos: AvisoPrazo[] | null }) {
  const [ativos, setAtivos] = useState<boolean | null>(null);
  useEffect(() => { permissaoAvisos(false).then(setAtivos).catch(() => setAtivos(false)); }, []);
  if (ativos === null) return null;
  if (ativos) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: cor.menta }} />
        <Texto sec tamanho={12}>Avisos de prazos ativos: 7 dias antes, 2 dias antes e no próprio dia.</Texto>
      </View>
    );
  }
  return (
    <Botao titulo="Ativar avisos de prazos" variante="secundario"
      onPress={async () => {
        const ok = await permissaoAvisos(true).catch(() => false);
        setAtivos(ok);
        if (ok && avisos) await agendarAvisos(avisos, false).catch(() => undefined);
      }} />
  );
}
