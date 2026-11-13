import React from "react";
import Svg, { Path, Rect, Circle } from "react-native-svg";

const P: Record<string, string> = {
  painel: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  documentos: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  digitalizar: "M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M8 12h8",
  assistente: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z",
  revisao: "M9 6h11M9 12h11M9 18h11M3 6l1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17",
  ligar: "M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1",
  voltar: "m15 6-6 6 6 6",
  seguir: "m9 6 6 6-6 6",
  enviar: "M5 12h14M13 6l6 6-6 6",
  sair: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10",
  sino: "M6 16v-5a6 6 0 1 1 12 0v5l2 2H4zM10 21a2 2 0 0 0 4 0",
  email: "M3 6h18v12H3zM3 7l9 6 9-6",
  relogio: "M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 7v5l3 2",
  conversa: "M20 12a8 8 0 0 1-11.7 7.1L4 20l1-3.9A8 8 0 1 1 20 12zM9 10.5c.3 1.6 1.9 3.2 3.5 3.5l1.2-1.1 1.8.9-.3 1.6c-3.5.2-6.6-2.9-6.4-6.4l1.6-.3.9 1.8z",
};

export function Icone({ nome, cor = "currentColor", tamanho = 22 }: { nome: keyof typeof P | "prazos" | "carteira"; cor?: string; tamanho?: number }) {
  const comum = { stroke: cor, strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  return (
    <Svg width={tamanho} height={tamanho} viewBox="0 0 24 24">
      {nome === "prazos" ? (
        <>
          <Rect x={3} y={5} width={18} height={16} rx={2} {...comum} />
          <Path d="M3 10h18M8 3v4M16 3v4" {...comum} />
        </>
      ) : nome === "carteira" ? (
        <>
          <Circle cx={9} cy={8} r={4} {...comum} />
          <Path d="M2 21c0-4 3-6 7-6s7 2 7 6M16 3.5a4 4 0 0 1 0 8M19 15c2 .8 3 2.6 3 6" {...comum} />
        </>
      ) : (
        <Path d={P[nome]} {...comum} />
      )}
    </Svg>
  );
}
