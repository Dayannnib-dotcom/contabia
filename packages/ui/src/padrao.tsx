import React, { ReactNode, useId } from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import { SvgXml } from "react-native-svg";
import { raio } from "./tema";
import type { Mosaico } from "./padroes";

/**
 * Padrões na app (Guia 2, regra 8 revista a 20/11/2026):
 * um padrão por bloco e no máximo dois por ecrã; o texto fica sempre numa área lisa por cima;
 * sem rotação, sombra nem gradiente; leitores de ecrã ignoram-nos (são decorativos).
 */
function svgMosaico(m: Mosaico, escala: number, id: string, desvio: [number, number]) {
  const w = m.w * escala, h = m.h * escala;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"><defs><pattern id="${id}" patternUnits="userSpaceOnUse" width="${w}" height="${h}" patternTransform="translate(${desvio[0]} ${desvio[1]})"><g transform="scale(${escala})">${m.corpo}</g></pattern></defs><rect width="100%" height="100%" fill="url(#${id})"/></svg>`;
}

/** Fundo com o mosaico repetido; ocupa todo o espaço do pai. */
export function FundoPadrao({ mosaico, escala = 0.7, desvio = [0, 0] }: { mosaico: Mosaico; escala?: number; desvio?: [number, number] }) {
  const id = "p" + useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={StyleSheet.absoluteFill}>
      <SvgXml xml={svgMosaico(mosaico, escala, id, desvio)} width="100%" height="100%" />
    </View>
  );
}

/** Faixa decorativa (por exemplo, no topo de um cartão escuro). */
export function FaixaPadrao({ mosaico, altura = 40, escala, desvio, estilo }: { mosaico: Mosaico; altura?: number; escala?: number; desvio?: [number, number]; estilo?: StyleProp<ViewStyle> }) {
  return <View style={[{ height: altura, overflow: "hidden" }, estilo]}><FundoPadrao mosaico={mosaico} escala={escala} desvio={desvio} /></View>;
}

/** Placa: moldura com padrão à volta de um cartão; o cartão (liso) fica por cima. */
export function PlacaPadrao({ mosaico, children, escala, estilo }: { mosaico: Mosaico; children: ReactNode; escala?: number; estilo?: StyleProp<ViewStyle> }) {
  return (
    <View style={[s.placa, estilo]}>
      <FundoPadrao mosaico={mosaico} escala={escala} />
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  placa: { padding: 12, borderRadius: raio.xl, overflow: "hidden", borderWidth: 1, borderColor: "#DDE2DF" },
});
