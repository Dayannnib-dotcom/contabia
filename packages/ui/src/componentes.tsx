import React, { useEffect, useRef, type ReactNode } from "react";
import {
  ActivityIndicator, Animated, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
  type StyleProp, type TextInputProps, type TextStyle, type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { cor, espaco, letra, raio } from "./tema";
import { Luis } from "./marca";

/** `aoInteragir`: chamado a cada toque ou deslocação (serve para medir o tempo ativo). */
export function Ecra({ children, rolar = true, estilo, aoInteragir }: { children: ReactNode; rolar?: boolean; estilo?: StyleProp<ViewStyle>; aoInteragir?: () => void }) {
  return (
    <SafeAreaView style={[s.ecra, estilo]} edges={["top", "left", "right"]} onTouchStart={aoInteragir}>
      {rolar ? <ScrollView contentContainerStyle={s.conteudo} keyboardShouldPersistTaps="handled" onScroll={aoInteragir} scrollEventThrottle={2000}>{children}</ScrollView> : <View style={[s.conteudo, { flex: 1 }]}>{children}</View>}
    </SafeAreaView>
  );
}

export function Titulo({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <View style={{ gap: 2, marginBottom: espaco.s }}>
      <Text style={s.titulo} accessibilityRole="header">{children}</Text>
      {sub ? <Text style={s.sub}>{sub}</Text> : null}
    </View>
  );
}

export function Texto({ children, sec, forte, tamanho, cor: c, estilo }: { children: ReactNode; sec?: boolean; forte?: boolean; tamanho?: number; cor?: string; estilo?: StyleProp<TextStyle> }) {
  return <Text style={[{ color: c ?? (sec ? cor.textoSec : cor.texto), fontSize: tamanho ?? letra.normal, fontWeight: forte ? "600" : "400", lineHeight: (tamanho ?? letra.normal) * 1.4 }, estilo]}>{children}</Text>;
}

export function Numero({ children, tamanho = letra.media, forte = true, cor: c }: { children: ReactNode; tamanho?: number; forte?: boolean; cor?: string }) {
  return <Text style={{ fontVariant: ["tabular-nums"], fontSize: tamanho, fontWeight: forte ? "600" : "400", color: c ?? cor.texto }}>{children}</Text>;
}

type Variante = "principal" | "secundario" | "perigo" | "menta" | "contorno";
export function Botao({ titulo, onPress, variante = "principal", carregando, desativado, estilo, icone }: {
  titulo: string; onPress?: () => void; variante?: Variante; carregando?: boolean; desativado?: boolean; estilo?: StyleProp<ViewStyle>; icone?: ReactNode;
}) {
  const v = {
    principal: { bg: cor.verde, fg: "#FFFFFF", bd: cor.verde },
    secundario: { bg: cor.cartao, fg: cor.texto, bd: cor.bordaForte },
    perigo: { bg: cor.cartao, fg: cor.vermelho, bd: "#E8B4B4" },
    menta: { bg: cor.menta, fg: "#0C1A22", bd: cor.menta },
    contorno: { bg: "transparent", fg: "#FFFFFF", bd: "#4B6878" },
  }[variante];
  const off = desativado || carregando;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!carregando }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [s.botao, { backgroundColor: off ? "#C9D0CC" : v.bg, borderColor: off ? "#C9D0CC" : v.bd, opacity: pressed ? 0.85 : 1 }, estilo]}
    >
      {carregando ? <ActivityIndicator color={v.fg} /> : icone}
      <Text style={{ color: off ? cor.textoSec : v.fg, fontSize: letra.media, fontWeight: "600" }}>{titulo}</Text>
    </Pressable>
  );
}

export function Cartao({ children, estilo, destaque, onPress }: { children: ReactNode; estilo?: StyleProp<ViewStyle>; destaque?: boolean; onPress?: () => void }) {
  const corpo = <View style={[s.cartao, destaque && { borderColor: cor.verde, borderWidth: 2 }, estilo]}>{children}</View>;
  return onPress ? <Pressable accessibilityRole="button" onPress={onPress}>{corpo}</Pressable> : corpo;
}

export function Chip({ texto, tipo = "neutro" }: { texto: string; tipo?: "bom" | "aviso" | "erro" | "neutro" }) {
  const c = { bom: [cor.verdeClaro, cor.verdeEscuro], aviso: [cor.ambar, cor.ambarTexto], erro: [cor.vermelhoClaro, cor.vermelho], neutro: [cor.linha, cor.texto] }[tipo];
  return <View style={[s.chip, { backgroundColor: c[0] }]}><Text style={{ color: c[1], fontSize: 12, fontWeight: "600" }}>{texto}</Text></View>;
}

export function Campo({ rotulo, ajuda, erro, rotuloCor, ...p }: TextInputProps & { rotulo: string; ajuda?: string; erro?: boolean; rotuloCor?: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 13, fontWeight: "600", color: rotuloCor ?? cor.texto }}>{rotulo}</Text>
      <TextInput
        placeholderTextColor="#8A9893"
        accessibilityLabel={rotulo}
        {...p}
        style={[s.campo, erro && { borderColor: cor.vermelho }, p.style]}
      />
      {ajuda ? <Text style={{ fontSize: 12, color: erro ? cor.vermelho : cor.textoSec }}>{ajuda}</Text> : null}
    </View>
  );
}

/**
 * Linha de lista. Se `direita` contém um botão próprio, use `direitaInterativa`:
 * assim tocar no botão não dispara também o toque na linha.
 */
export function Linha({ esquerda, direita, sub, onPress, direitaInterativa }: { esquerda: ReactNode; direita?: ReactNode; sub?: string; onPress?: () => void; direitaInterativa?: boolean }) {
  const texto = (
    <View style={{ flex: 1, gap: 2 }}>
      {typeof esquerda === "string" ? <Texto forte>{esquerda}</Texto> : esquerda}
      {sub ? <Texto sec tamanho={12}>{sub}</Texto> : null}
    </View>
  );
  if (onPress && direitaInterativa) {
    return (
      <View style={s.linha}>
        <Pressable accessibilityRole="button" onPress={onPress} style={{ flex: 1 }}>{texto}</Pressable>
        {direita}
      </View>
    );
  }
  const c = <View style={s.linha}>{texto}{direita}</View>;
  return onPress ? <Pressable accessibilityRole="button" onPress={onPress}>{c}</Pressable> : c;
}

/** Mensagem do Luís, que entra a subir suavemente. */
export function MensagemLuis({ texto, escuro, acao, rotulo = "Luís · assistente virtual" }: { texto: string; escuro?: boolean; acao?: ReactNode; rotulo?: string }) {
  const y = useRef(new Animated.Value(16)).current;
  const o = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(y, { toValue: 0, duration: 500, useNativeDriver: true }),
      Animated.timing(o, { toValue: 1, duration: 500, useNativeDriver: true }),
    ]).start();
  }, [texto, o, y]);
  return (
    <Animated.View style={[s.luis, escuro && { backgroundColor: cor.tinta, borderColor: cor.tinta }, { opacity: o, transform: [{ translateY: y }] }]}>
      <Luis tamanho={44} id="msg" />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ fontSize: 13, fontWeight: "600", color: escuro ? "#9FE3CF" : cor.verdeEscuro }}>{rotulo}</Text>
        <Text style={{ fontSize: 14, lineHeight: 20, color: escuro ? "#FFFFFF" : cor.texto }}>{texto}</Text>
        {acao}
      </View>
    </Animated.View>
  );
}

export function Vazio({ texto }: { texto: string }) {
  return <Text style={{ color: cor.textoSec, textAlign: "center", paddingVertical: espaco.xl }}>{texto}</Text>;
}

export function Erro({ texto }: { texto?: string | null }) {
  if (!texto) return null;
  return <View style={[s.chip, { backgroundColor: cor.vermelhoClaro, alignSelf: "stretch", padding: espaco.m, borderRadius: raio.m }]}><Text style={{ color: cor.vermelho, fontWeight: "600" }}>{texto}</Text></View>;
}

const s = StyleSheet.create({
  ecra: { flex: 1, backgroundColor: cor.fundo },
  conteudo: { padding: espaco.xl, gap: espaco.l, paddingBottom: 40 },
  titulo: { fontSize: letra.titulo, fontWeight: "600", color: cor.texto, letterSpacing: -0.2 },
  sub: { fontSize: 13, color: cor.textoSec },
  botao: { minHeight: 48, borderRadius: raio.m, borderWidth: 1, paddingHorizontal: espaco.l, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  cartao: { backgroundColor: cor.cartao, borderColor: cor.borda, borderWidth: 1, borderRadius: raio.l, padding: espaco.l, gap: espaco.m },
  chip: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: raio.pill, alignSelf: "flex-start" },
  campo: { minHeight: 48, borderRadius: raio.m, borderWidth: 1, borderColor: cor.bordaForte, backgroundColor: cor.cartao, paddingHorizontal: 14, fontSize: 15, color: cor.texto },
  linha: { flexDirection: "row", alignItems: "center", gap: espaco.m, paddingVertical: espaco.m, borderTopWidth: 1, borderTopColor: cor.linha },
  luis: { flexDirection: "row", gap: espaco.m, alignItems: "flex-start", backgroundColor: cor.cartao, borderColor: cor.borda, borderWidth: 1, borderRadius: raio.l, padding: espaco.m },
});
