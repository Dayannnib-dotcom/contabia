import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { dataPT, euros, type Documento } from "@contabia/shared";
import { Cartao, Chip, Ecra, Erro, Linha, Texto, Titulo, Vazio, cor, useDados, useSessao } from "@contabia/ui";

const TIPOS: [Documento["tipo"], string][] = [["compra", "Compras"], ["venda", "Vendas"], ["banco", "Bancos"], ["pessoal", "Pessoal"]];
const ESTADO: Record<Documento["estado"], [string, "erro" | "aviso" | "bom"]> = { validar: ["Validar", "erro"], sem_anexo: ["Sem anexo", "aviso"], validado: ["Validado", "bom"] };

export default function Documentos() {
  const { api, sessao } = useSessao();
  const router = useRouter();
  const [tipo, setTipo] = useState<Documento["tipo"]>("compra");
  const { dados, erro } = useDados(() => api.documentos(sessao!.id), [sessao!.id]);
  const lista = (dados ?? []).filter((d) => d.tipo === tipo);

  return (
    <Ecra>
      <Titulo sub={dados ? `${dados.length} documentos · ${dados.filter((d) => d.estado === "validado").length} validados` : undefined}>Documentos</Titulo>
      <View accessibilityRole="tablist" style={{ flexDirection: "row", backgroundColor: "#E8ECE9", borderRadius: 12, padding: 4, gap: 4 }}>
        {TIPOS.map(([t, n]) => (
          <Pressable key={t} accessibilityRole="tab" accessibilityState={{ selected: t === tipo }} onPress={() => setTipo(t)}
            style={{ flex: 1, minHeight: 40, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: t === tipo ? "#FFF" : "transparent" }}>
            <Text style={{ fontSize: 13, fontWeight: t === tipo ? "600" : "500", color: t === tipo ? cor.texto : cor.textoSec }}>{n}</Text>
          </Pressable>
        ))}
      </View>
      <Erro texto={erro} />
      <Cartao estilo={{ paddingVertical: 4 }}>
        {lista.length === 0 ? <Vazio texto="Sem documentos deste tipo. Use «Digitalizar» para adicionar." /> : null}
        {lista.map((d) => (
          <Linha key={d.id} onPress={() => router.push({ pathname: "/documento/[id]", params: { id: d.id } })}
            esquerda={d.terceiroNome}
            sub={`${dataPT(d.data)} · ${d.contaSugerida} ${d.categoria}${d.ivaDedutivel ? "" : " · IVA não dedutível"}`}
            direita={<View style={{ alignItems: "flex-end", gap: 4 }}><Text style={{ fontVariant: ["tabular-nums"], fontWeight: "600", color: cor.texto }}>{euros(d.total)}</Text><Chip texto={ESTADO[d.estado][0]} tipo={ESTADO[d.estado][1]} /></View>} />
        ))}
      </Cartao>
      <Texto sec tamanho={12}>Toque num documento para o validar ou corrigir a classificação.</Texto>
    </Ecra>
  );
}
