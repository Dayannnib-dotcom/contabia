import { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Icone, Luis, cor, useSessao } from "@contabia/ui";

interface Msg { de: "eu" | "luis"; texto: string; fontes?: string[]; encaminhada?: boolean }

const SUGESTOES = ["Que documentos faltam?", "Quanto IVA vou pagar?", "Próximos prazos", "Posso deduzir o IVA de um almoço?"];

export default function Assistente() {
  const { api, sessao } = useSessao();
  const [msgs, setMsgs] = useState<Msg[]>([{ de: "luis", texto: "Olá! Pergunte-me o que precisar sobre a contabilidade da sua empresa." }]);
  const [texto, setTexto] = useState("");
  const [aPensar, setAPensar] = useState(false);
  const rolo = useRef<{ scrollToEnd(o?: { animated?: boolean }): void } | null>(null);

  async function enviar(p = texto) {
    const pergunta = p.trim();
    if (!pergunta || aPensar) return;
    setTexto("");
    setMsgs((m) => [...m, { de: "eu", texto: pergunta }]);
    setAPensar(true);
    try {
      const r = await api.perguntar(sessao!.id, pergunta);
      setMsgs((m) => [...m, { de: "luis", texto: r.resposta, fontes: r.fontes, encaminhada: r.encaminharParaContabilista }]);
    } catch (e) {
      setMsgs((m) => [...m, { de: "luis", texto: `Não consegui responder agora (${(e as Error).message}). Tente de novo.` }]);
    } finally {
      setAPensar(false);
      setTimeout(() => rolo.current?.scrollToEnd({ animated: true }), 50);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: cor.fundo }} edges={["top"]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 16, backgroundColor: "#FFF", borderBottomWidth: 1, borderBottomColor: cor.borda }}>
        <Luis tamanho={42} id="cab" />
        <View><Text style={{ fontSize: 17, fontWeight: "600", color: cor.texto }}>Luís</Text><Text style={{ fontSize: 12, color: cor.textoSec }}>Assistente virtual · conhece a sua empresa</Text></View>
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
        <ScrollView ref={rolo as never} contentContainerStyle={{ padding: 16, gap: 12 }}>
          {msgs.map((m, i) => (
            <View key={i} style={{ alignSelf: m.de === "eu" ? "flex-end" : "flex-start", maxWidth: "86%", backgroundColor: m.de === "eu" ? cor.tinta : "#FFF", borderWidth: m.de === "eu" ? 0 : 1, borderColor: cor.borda, borderRadius: 18, padding: 12, gap: 6 }}>
              <Text style={{ color: m.de === "eu" ? "#FFF" : cor.texto, fontSize: 14, lineHeight: 20 }}>{m.texto}</Text>
              {m.fontes?.length ? <Text style={{ fontSize: 12, color: cor.textoSec }}>Fonte: {m.fontes.join(" · ")}</Text> : null}
              {m.de === "luis" && i > 0 ? <Text style={{ fontSize: 11, color: cor.textoSec }}>{m.encaminhada ? "Encaminhado ao seu contabilista." : "Informação geral — o seu Contabilista Certificado confirma o tratamento."}</Text> : null}
            </View>
          ))}
          {aPensar ? <Text style={{ color: cor.textoSec }}>O Luís está a escrever…</Text> : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {SUGESTOES.map((s) => (
              <Pressable key={s} accessibilityRole="button" onPress={() => enviar(s)} style={{ minHeight: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: cor.bordaForte, backgroundColor: "#FFF", justifyContent: "center" }}>
                <Text style={{ fontSize: 13, color: cor.texto }}>{s}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
        <View style={{ flexDirection: "row", gap: 8, padding: 12, backgroundColor: "#FFF", borderTopWidth: 1, borderTopColor: cor.borda }}>
          <TextInput value={texto} onChangeText={setTexto} onSubmitEditing={() => enviar()} placeholder="Escreva a sua pergunta…" placeholderTextColor="#8A9893" accessibilityLabel="Pergunta"
            style={{ flex: 1, minHeight: 46, borderRadius: 23, borderWidth: 1, borderColor: cor.borda, paddingHorizontal: 16, backgroundColor: cor.fundo, color: cor.texto }} />
          <Pressable accessibilityRole="button" accessibilityLabel="Enviar pergunta" onPress={() => enviar()} style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: cor.verde, alignItems: "center", justifyContent: "center" }}>
            <Icone nome="enviar" cor="#FFF" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
