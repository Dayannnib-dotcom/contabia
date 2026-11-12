import { useState } from "react";
import { Platform, Pressable, View } from "react-native";
import Svg, { Line, Path, Text as SvgText } from "react-native-svg";
import { euros, type Documento } from "@contabia/shared";
import { Texto } from "./componentes";
import { cor } from "./tema";

/** Paleta validada (CVD, contraste, croma): vendas = verde-azulado, compras = âmbar. */
export const COR_VENDAS = "#12917A";
export const COR_COMPRAS = "#C97A1E";
const FONTE = Platform.OS === "web" ? "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" : undefined;
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function resumoMensal(docs: Documento[], hoje = new Date(), meses = 6) {
  const lista: { chave: string; rotulo: string; vendas: number; compras: number }[] = [];
  for (let i = meses - 1; i >= 0; i--) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    lista.push({ chave: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, rotulo: MESES[d.getMonth()], vendas: 0, compras: 0 });
  }
  for (const d of docs) {
    if (d.estado === "anulado" || d.estado === "anulacao_pedida") continue;
    const m = lista.find((x) => x.chave === d.data.slice(0, 7));
    if (!m) continue;
    if (d.tipo === "venda") m.vendas += d.base;
    else if (d.tipo === "compra") m.compras += d.base;
  }
  return lista;
}

/** Barra com o topo arredondado (4 px) e a base reta, assente no eixo. */
function barra(x: number, y: number, w: number, h: number) {
  if (h <= 0) return "";
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}

/** Vendas e compras (sem IVA) dos últimos 6 meses. Tocar num mês mostra os valores. */
export function GraficoMensal({ docs }: { docs: Documento[] }) {
  const [largura, setLargura] = useState(0);
  const dados = resumoMensal(docs);
  const [sel, setSel] = useState(dados.length - 1);
  const max = Math.max(1, ...dados.flatMap((m) => [m.vendas, m.compras]));
  const altura = 140;
  const topo = 8;
  const base = altura - 22;
  const grupo = largura / dados.length;
  const bw = Math.max(6, Math.min(18, (grupo - 14) / 2));
  const y = (v: number) => base - ((base - topo) * v) / max;
  const m = dados[sel];
  const descricao = dados.map((d) => `${d.rotulo}: vendas ${euros(d.vendas)}, compras ${euros(d.compras)}`).join("; ");

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", gap: 14 }}>
        {[[COR_VENDAS, "Vendas"], [COR_COMPRAS, "Compras"]].map(([c, n]) => (
          <View key={n} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: c }} />
            <Texto sec tamanho={12}>{n}</Texto>
          </View>
        ))}
      </View>
      <View onLayout={(e) => setLargura(e.nativeEvent.layout.width)} accessible accessibilityLabel={`Gráfico de vendas e compras dos últimos 6 meses. ${descricao}`}>
        {largura ? (
          <View>
            <Svg width={largura} height={altura}>
              <Line x1={0} x2={largura} y1={base} y2={base} stroke={cor.borda} strokeWidth={1} />
              {dados.map((d, i) => {
                const cx = grupo * i + grupo / 2;
                return [
                  i === sel ? <Path key={`s${i}`} d={`M${grupo * i + 2},${topo - 4} h${grupo - 4} v${base - topo + 4} h${-(grupo - 4)} Z`} fill={cor.linha} /> : null,
                  <Path key={`v${i}`} d={barra(cx - bw - 1, y(d.vendas), bw, base - y(d.vendas))} fill={COR_VENDAS} />,
                  <Path key={`c${i}`} d={barra(cx + 1, y(d.compras), bw, base - y(d.compras))} fill={COR_COMPRAS} />,
                  <SvgText key={`t${i}`} x={cx} y={altura - 6} fontSize={11} fontFamily={FONTE} fill={i === sel ? cor.texto : cor.textoSec} fontWeight={i === sel ? "700" : "400"} textAnchor="middle">{d.rotulo}</SvgText>,
                ];
              })}
            </Svg>
            {/* zonas de toque maiores do que as barras */}
            <View style={{ position: "absolute", inset: 0, flexDirection: "row" }}>
              {dados.map((d, i) => (
                <Pressable key={d.chave} style={{ flex: 1 }} onPress={() => setSel(i)} onHoverIn={() => setSel(i)}
                  accessibilityRole="button" accessibilityLabel={`${d.rotulo}: vendas ${euros(d.vendas)}, compras ${euros(d.compras)}`} />
              ))}
            </View>
          </View>
        ) : <View style={{ height: altura }} />}
      </View>
      {m ? (
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Texto forte tamanho={13}>{m.rotulo.charAt(0).toUpperCase() + m.rotulo.slice(1)} {m.chave.slice(0, 4)}</Texto>
          <Texto tamanho={13}>Vendas <Texto forte tamanho={13}>{euros(m.vendas)}</Texto> · Compras <Texto forte tamanho={13}>{euros(m.compras)}</Texto></Texto>
        </View>
      ) : null}
    </View>
  );
}
