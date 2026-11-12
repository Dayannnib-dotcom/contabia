import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { cor } from "./tema";
import { Logo, Luis } from "./marca";
import { Botao } from "./componentes";

/** Entrada animada: logótipo, nome, sinais de confiança e saudação do Luís. */
export function EcraEntrada({ papel, saudacao, onEntrar, onCriarConta, rotulo = "assistente virtual" }: { papel: string; saudacao: string; onEntrar: () => void; onCriarConta: () => void; rotulo?: string }) {
  const v = useRef(Array.from({ length: 7 }, () => new Animated.Value(0))).current;
  useEffect(() => {
    Animated.stagger(
      260,
      v.map((x) => Animated.timing(x, { toValue: 1, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: true })),
    ).start();
  }, [v]);
  const sobe = (i: number) => ({
    opacity: v[i],
    transform: [{ translateY: v[i].interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }],
  });
  const confianca = [
    "Dados encriptados e alojados na UE",
    "Faturação certificada pela AT · n.º [CERTIFICADO]",
    "Cada empresa acompanhada por um Contabilista Certificado",
  ];
  return (
    <SafeAreaView style={s.fundo}>
      <View style={s.topo}>
        <Animated.View style={{ opacity: v[0], transform: [{ scale: v[0].interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] }}>
          <Logo tamanho={96} fundo={cor.tinta2} />
        </Animated.View>
        <Animated.Text style={[s.nome, sobe(1)]}>contabia</Animated.Text>
        <Animated.Text style={[s.lema, sobe(1)]}>{papel}</Animated.Text>
      </View>
      <View style={{ gap: 12 }}>
        {confianca.map((t, i) => (
          <Animated.View key={t} style={[s.confianca, sobe(2 + i)]}>
            <View style={s.ponto} />
            <Text style={s.confiancaTxt}>{t}</Text>
          </Animated.View>
        ))}
      </View>
      <Animated.View style={[s.luis, sobe(5)]}>
        <Luis tamanho={52} id="entrada" />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: cor.texto }}>Luís <Text style={{ fontWeight: "400", color: cor.textoSec }}>· {rotulo}</Text></Text>
          <Text style={{ fontSize: 14, lineHeight: 20, color: cor.texto }}>{saudacao}</Text>
        </View>
      </Animated.View>
      <Animated.View style={[{ gap: 10, marginTop: "auto" }, sobe(6)]}>
        <Botao titulo="Entrar" variante="menta" onPress={onEntrar} />
        <Botao titulo="Criar conta" variante="contorno" onPress={onCriarConta} />
      </Animated.View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  fundo: { flex: 1, backgroundColor: cor.tinta, padding: 28, gap: 28 },
  topo: { alignItems: "center", gap: 12, marginTop: 48 },
  nome: { fontSize: 38, fontWeight: "700", color: "#FFFFFF", letterSpacing: -0.8 },
  lema: { fontSize: 16, color: "#C9D6DC", textAlign: "center" },
  confianca: { flexDirection: "row", alignItems: "center", gap: 12 },
  ponto: { width: 10, height: 10, borderRadius: 5, backgroundColor: cor.menta },
  confiancaTxt: { color: "#DCE6EA", fontSize: 14, flex: 1 },
  luis: { flexDirection: "row", gap: 12, backgroundColor: "#FFFFFF", borderRadius: 20, padding: 14 },
});
