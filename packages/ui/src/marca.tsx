import React, { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";
import Svg, { Circle, ClipPath, Defs, G, Path, Rect, SvgXml } from "react-native-svg";
import { POSES_LUIS, type PoseLuis } from "./luis-corpo";
import { cor } from "./tema";

/** Logótipo Contabia — opção C «Atlântico». */
export function Logo({ tamanho = 40, fundo = cor.tinta }: { tamanho?: number; fundo?: string }) {
  return (
    <Svg width={tamanho} height={tamanho} viewBox="0 0 64 64" accessibilityLabel="Contabia">
      <Circle cx={32} cy={32} r={32} fill={fundo} />
      <Path d="M43 19a16 16 0 1 0 0 26" fill="none" stroke="#FFFFFF" strokeWidth={5.5} strokeLinecap="round" />
      <Path d="M27 32q5-5 10 0t10 0t10 0" fill="none" stroke={cor.menta} strokeWidth={4.5} strokeLinecap="round" />
    </Svg>
  );
}

const K = { stroke: "#12232E", strokeWidth: 3, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export type ExpressaoLuis = "sorriso" | "atento" | "a-pensar" | "alerta" | "celebrar";

/** Expressões aprovadas na Guia 2: só mudam sobrancelhas, olhos e boca. */
const ROSTO: Record<ExpressaoLuis, { sobrancelhas: string; olhar?: [number, number]; olhosFechados?: boolean; boca: string; bocaAberta: boolean; cantos?: string }> = {
  sorriso: { sobrancelhas: "M93 89 C99 85 107 85 112 88 M128 88 C133 85 141 85 147 89", boca: "M104 138 C112 148 128 148 136 138", bocaAberta: true, cantos: "M100 134 L104 138 M140 134 L136 138" },
  atento: { sobrancelhas: "M93 86 C99 82 107 82 112 85 M128 85 C133 82 141 82 147 86", boca: "M107 139 C114 145 126 145 133 139", bocaAberta: false },
  "a-pensar": { sobrancelhas: "M93 85 C99 80 107 80 112 84 M128 89 C133 87 141 87 147 89", olhar: [3, -3], boca: "M110 141 C117 143 125 141 131 136", bocaAberta: false },
  alerta: { sobrancelhas: "M93 90 C99 87 106 85 112 84 M128 84 C134 85 141 87 147 90", boca: "M109 140 C115 141 125 141 131 140", bocaAberta: false },
  celebrar: { sobrancelhas: "M93 86 C99 82 107 82 112 85 M128 85 C133 82 141 82 147 86", olhosFechados: true, boca: "M100 135 C110 153 130 153 140 135 Z", bocaAberta: true, cantos: "M96 131 L100 135 M144 131 L140 135" },
};

/** Respeita a opção «reduzir movimento» do sistema. */
function useReduzirMovimento() {
  const [reduzir, setReduzir] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled?.().then(setReduzir).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener?.("reduceMotionChanged", setReduzir);
    return () => sub?.remove?.();
  }, []);
  return reduzir;
}

/** Luís — assistente virtual. Pisca os olhos a cada 5 segundos (parado com «reduzir movimento»). */
export function Luis({ tamanho = 48, id = "luis", expressao = "sorriso" }: { tamanho?: number; id?: string; expressao?: ExpressaoLuis }) {
  const [olhos, setOlhos] = useState(true);
  const reduzir = useReduzirMovimento();
  useEffect(() => {
    if (reduzir) return;
    const t = setInterval(() => {
      setOlhos(false);
      setTimeout(() => setOlhos(true), 150);
    }, 5000);
    return () => clearInterval(t);
  }, [reduzir]);
  const r = ROSTO[expressao];
  const [dx, dy] = r.olhar ?? [0, 0];
  return (
    <Svg width={tamanho} height={tamanho} viewBox="0 0 240 240" accessibilityLabel="Luís, assistente virtual da Contabia">
      <Defs>
        <ClipPath id={`c-${id}`}>
          <Circle cx={120} cy={120} r={120} />
        </ClipPath>
      </Defs>
      <G clipPath={`url(#c-${id})`}>
        <Rect width={240} height={240} fill="#CFE9DF" />
        <Circle cx={120} cy={112} r={86} fill="#E3F1EC" />
        <Path d="M20 250 C24 206 54 186 92 180 L120 176 L148 180 C186 186 216 206 220 250 Z" fill="#D8C3A0" {...K} />
        <Path d="M150 182 C184 190 212 208 218 250 L176 250 C172 224 164 204 150 192 Z" fill="#C7AF89" />
        <Path d="M102 176 L94 186 L112 204 L120 214 L128 204 L146 186 L138 176" fill="#FFFFFF" {...K} />
        <Path d="M94 186 L112 236 M146 186 L128 236" fill="none" {...K} />
        <Path d="M114 194 L126 194 L130 232 L120 240 L110 232 Z" fill="#1F4E8C" {...K} />
        <Path d="M114 194 L120 188 L126 194" fill="#1F4E8C" {...K} />
        <Path d="M106 150 L134 150 L134 174 C128 180 112 180 106 174 Z" fill="#F0C9A6" />
        <Path d="M106 146 L106 176 M134 146 L134 176" fill="none" {...K} />
        <Path d="M78 100 C70 104 72 122 82 122" fill="#F0C9A6" {...K} />
        <Path d="M162 100 C170 104 168 122 158 122" fill="#F0C9A6" {...K} />
        <Path d="M82 94 C82 68 98 54 120 54 C142 54 158 68 158 94 L158 114 C158 140 141 160 120 162 C99 160 82 140 82 114 Z" fill="#F0C9A6" {...K} />
        <Path d="M80 104 C76 82 82 60 98 50 C112 41 132 40 146 46 C160 52 166 66 164 82 C163 92 160 98 158 104 C156 92 152 84 145 80 C134 74 122 78 112 76 C106 75 102 72 100 68 C96 76 90 82 86 88 C83 93 81 98 80 104 Z" fill="#8E949A" {...K} />
        <Path d="M104 60 C118 50 138 50 154 58 M110 68 C124 62 140 62 156 70 M90 80 C88 70 92 62 98 56" fill="none" stroke="#FFFFFF" strokeWidth={2.4} strokeLinecap="round" />
        <Path d={r.sobrancelhas} fill="none" stroke="#12232E" strokeWidth={3.6} strokeLinecap="round" />
        {r.olhosFechados ? (
          <Path d="M99 108 C102 103 108 103 111 108 M129 108 C132 103 138 103 141 108" fill="none" {...K} />
        ) : olhos ? (
          <G>
            <Circle cx={105 + dx} cy={106 + dy} r={3} fill="#12232E" />
            <Circle cx={135 + dx} cy={106 + dy} r={3} fill="#12232E" />
          </G>
        ) : (
          <Path d="M99 106 C103 109 107 109 111 106 M129 106 C133 109 137 109 141 106" fill="none" {...K} />
        )}
        <Circle cx={105} cy={106} r={13} fill="#FFFFFF" fillOpacity={0.35} {...K} />
        <Circle cx={135} cy={106} r={13} fill="#FFFFFF" fillOpacity={0.35} {...K} />
        <Path d="M118 104 C119 101.5 121 101.5 122 104 M92 103 L80 100 M148 103 L160 100" fill="none" {...K} />
        <Path d="M99 100 L103 98 M129 100 L133 98" stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" />
        <Path d="M120 114 C122 119 124 123 123 127 C121 129 118 129 116 128" fill="none" stroke="#12232E" strokeWidth={2.4} strokeLinecap="round" />
        <Path d={r.boca} fill={r.bocaAberta ? "#FFFFFF" : "none"} {...K} />
        {r.cantos ? <Path d={r.cantos} fill="none" stroke="#12232E" strokeWidth={2.2} strokeLinecap="round" /> : null}
        <Circle cx={94} cy={127} r={5} fill="#F2A08A" opacity={0.55} />
        <Circle cx={146} cy={127} r={5} fill="#F2A08A" opacity={0.55} />
      </G>
    </Svg>
  );
}

/** Luís de corpo inteiro (Guia 2): para ecrãs de boas-vindas e vazios, nunca nas conversas. Altura mínima 120. */
export function LuisCorpo({ pose = "cumprimentar", altura = 220 }: { pose?: PoseLuis; altura?: number }) {
  const h = Math.max(120, altura);
  return <SvgXml xml={POSES_LUIS[pose]} width={(h * 320) / 600} height={h} accessibilityLabel="Luís, assistente virtual da Contabia" />;
}
