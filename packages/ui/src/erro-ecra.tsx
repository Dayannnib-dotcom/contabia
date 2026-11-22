import { Platform, Pressable, Text, View } from "react-native";

/**
 * Ecrã mostrado se alguma parte da app falhar ao desenhar (ou se faltar a internet ao abrir
 * um ecrã novo): em vez de um ecrã em branco, explica e deixa tentar de novo.
 * Não usa a sessão nem outros contextos, para funcionar mesmo quando são eles que falham.
 */
export function EcraErro({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  const semRede = /load|fetch|network|chunk|module/i.test(error?.message ?? "");
  const recomecar = () => {
    if (Platform.OS === "web" && typeof window !== "undefined") window.location.reload();
    else void retry();
  };
  return (
    <View style={{ flex: 1, backgroundColor: "#F6F7F5", alignItems: "center", justifyContent: "center", padding: 24, gap: 14 }}>
      <Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: "700", color: "#12232E", textAlign: "center" }}>
        {semRede ? "Sem ligação à internet" : "Algo correu mal neste ecrã"}
      </Text>
      <Text style={{ fontSize: 15, color: "#4B5A63", textAlign: "center", maxWidth: 360, lineHeight: 21 }}>
        {semRede
          ? "Não consegui abrir este ecrã. Os seus dados estão guardados. Verifique a ligação e tente de novo."
          : "Os seus dados estão guardados. Tente de novo; se voltar a acontecer, avise o seu contabilista ou a equipa Contabia."}
      </Text>
      <Pressable accessibilityRole="button" onPress={() => void retry()}
        style={{ backgroundColor: "#0B6E5B", borderRadius: 12, minHeight: 48, paddingHorizontal: 24, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: "#FFFFFF", fontSize: 16, fontWeight: "600" }}>Tentar de novo</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={recomecar} style={{ minHeight: 44, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: "#0B6E5B", fontSize: 15, fontWeight: "600" }}>Recomeçar a app</Text>
      </Pressable>
    </View>
  );
}
