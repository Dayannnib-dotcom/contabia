import { FilaPendente } from "../../components/FilaPendente";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { dataPT, euros, type Documento } from "@contabia/shared";
import { Botao, Campo, Cartao, Chip, Ecra, Erro, Linha, Texto, Titulo, Vazio, cor, useDados, useSessao } from "@contabia/ui";

const TIPOS: [Documento["tipo"], string][] = [["compra", "Compras"], ["venda", "Vendas"], ["banco", "Bancos"], ["pessoal", "Pessoal"]];
type Filtro = "todos" | "validar" | "sem_original" | "anulados";
const FILTROS: Record<Filtro, [string, (d: Documento) => boolean]> = {
  todos: ["Todos", (d) => d.estado !== "anulado"],
  validar: ["Por validar", (d) => d.estado === "validar" || d.estado === "sem_anexo"],
  sem_original: ["Sem original", (d) => !d.anexos && d.estado !== "anulado"],
  anulados: ["Anulados", (d) => d.estado === "anulado" || d.estado === "anulacao_pedida"],
};
const ESTADO: Record<Documento["estado"], [string, "erro" | "aviso" | "bom" | "neutro"]> = { validar: ["Validar", "erro"], sem_anexo: ["Sem anexo", "aviso"], validado: ["Validado", "bom"], anulacao_pedida: ["Anulação pedida", "aviso"], anulado: ["Anulado", "neutro"] };

export default function Documentos() {
  const { api, sessao } = useSessao();
  const router = useRouter();
  const [tipo, setTipo] = useState<Documento["tipo"]>("compra");
  const { dados, erro } = useDados(() => api.documentos(sessao!.id), [sessao!.id]);
  const [pesquisa, setPesquisa] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const doTipo = (dados ?? []).filter((d) => d.tipo === tipo);
  const q = pesquisa.trim().toLowerCase().replace(",", ".");
  const lista = doTipo
    .filter((d) => FILTROS[filtro][1](d))
    .filter((d) => !q || [d.terceiroNome, d.numero, d.terceiroNif, d.total.toFixed(2), d.categoria, d.data.split("-").reverse().join("/")].some((x) => x.toLowerCase().includes(q)));

  return (
    <Ecra>
      <Titulo sub={dados ? `${dados.length} documentos · ${dados.filter((d) => d.estado === "validado").length} validados` : undefined}>Documentos</Titulo>
      <FilaPendente />
      {sessao!.perfil !== "colaborador" ? <Botao titulo="Importar do e-Fatura" variante="secundario" onPress={() => router.push("/importar")} /> : null}
      <View accessibilityRole="tablist" style={{ flexDirection: "row", backgroundColor: "#E8ECE9", borderRadius: 12, padding: 4, gap: 4 }}>
        {TIPOS.map(([t, n]) => (
          <Pressable key={t} accessibilityRole="tab" accessibilityState={{ selected: t === tipo }} onPress={() => setTipo(t)}
            style={{ flex: 1, minHeight: 40, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: t === tipo ? "#FFF" : "transparent" }}>
            <Text style={{ fontSize: 13, fontWeight: t === tipo ? "600" : "500", color: t === tipo ? cor.texto : cor.textoSec }}>{n}</Text>
          </Pressable>
        ))}
      </View>
      <Campo rotulo="Pesquisar" value={pesquisa} onChangeText={setPesquisa} placeholder="Fornecedor, n.º, NIF ou valor" autoCorrect={false} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {(Object.keys(FILTROS) as Filtro[]).map((f) => {
          const n = doTipo.filter(FILTROS[f][1]).length;
          const ativo = f === filtro;
          return (
            <Pressable key={f} accessibilityRole="button" accessibilityState={{ selected: ativo }} onPress={() => setFiltro(f)}
              style={{ paddingHorizontal: 14, minHeight: 36, borderRadius: 18, justifyContent: "center", borderWidth: 1, borderColor: ativo ? cor.verde : cor.borda, backgroundColor: ativo ? cor.verdeClaro : cor.cartao }}>
              <Text style={{ fontSize: 13, fontWeight: ativo ? "700" : "500", color: ativo ? cor.verdeEscuro : cor.textoSec }}>{FILTROS[f][0]} · {n}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <Erro texto={erro} />
      <Cartao estilo={{ paddingVertical: 4 }}>
        {lista.length === 0 ? <Vazio texto={q || filtro !== "todos" ? "Nenhum documento corresponde à pesquisa." : "Sem documentos deste tipo. Use «Digitalizar» para adicionar."} /> : null}
        {lista.map((d) => (
          <Linha key={d.id} onPress={() => router.push({ pathname: "/documento/[id]", params: { id: d.id } })}
            esquerda={d.terceiroNome}
            sub={`${dataPT(d.data)} · ${d.numero}${d.anexos ? " · 📎" : ""} · ${d.categoria}${d.ivaDedutivel ? "" : " · IVA não dedutível"}`}
            direita={<View style={{ alignItems: "flex-end", gap: 4 }}><Text style={{ fontVariant: ["tabular-nums"], fontWeight: "600", color: cor.texto }}>{euros(d.total)}</Text><Chip texto={ESTADO[d.estado][0]} tipo={ESTADO[d.estado][1]} /></View>} />
        ))}
      </Cartao>
      <Texto sec tamanho={12}>Toque num documento para o validar ou corrigir a classificação.</Texto>
    </Ecra>
  );
}
