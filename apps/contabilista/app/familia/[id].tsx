import { useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { ANO_FISCAL_CASA, NOME_CATEGORIA_CASA, dataPT, euros, formatarNIF, type CategoriaCasa } from "@contabia/shared";
import { Botao, Cartao, Chip, Ecra, Erro, Linha, MensagemLuis, Numero, Texto, Titulo, Vazio, cor, useDados, useSessao } from "@contabia/ui";

const CATEGORIAS: CategoriaCasa[] = ["gerais", "saude", "educacao", "rendas", "exigencia", "sem_deducao"];

/** Uma família na carteira: agregado, deduções estimadas e faturas (o contabilista pode corrigir categorias). */
export default function Familia() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useSessao();
  const { dados, erro } = useDados(() => api.familia(id), [id]);
  const { dados: faturas, recarregar } = useDados(() => api.familiaDespesas(id, ANO_FISCAL_CASA), [id]);
  const [aberta, setAberta] = useState<string | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const pedido = dados?.agregado.servicoIRS;

  return (
    <Ecra>
      <Titulo sub={`Plano Família · ${ANO_FISCAL_CASA}`}>{dados?.agregado.nome ?? "Família"}</Titulo>
      <Erro texto={erro ?? falha} />
      {pedido ? <MensagemLuis escuro texto={`Esta família pediu o serviço de IRS ${pedido.tipo === "familia" ? "de família (69 €)" : "individual (45 €)"} a ${dataPT(pedido.pedidoEm.slice(0, 10))}. Combine com ela a revisão e a entrega.`} /> : null}
      {dados ? (
        <Cartao>
          <Texto sec tamanho={12}>DEDUÇÕES ESTIMADAS</Texto>
          <Numero tamanho={28}>{euros(dados.deducoes.total)}</Numero>
          {dados.deducoes.linhas.map((l) => (
            <View key={l.categoria} style={{ gap: 4 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Texto tamanho={14}>{l.nome}</Texto>
                <Texto tamanho={13} sec>{euros(l.deducao)} de {euros(l.limite)}</Texto>
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: cor.linha, overflow: "hidden" }}>
                <View style={{ width: `${Math.round(l.usado * 100)}%`, height: 6, backgroundColor: l.usado >= 1 ? cor.verde : cor.menta }} />
              </View>
            </View>
          ))}
        </Cartao>
      ) : null}
      {dados ? (
        <Cartao estilo={{ paddingVertical: 4 }}>
          {dados.membros.filter((m) => m.ativo).map((m) => (
            <Linha key={m.id} esquerda={m.nome} sub={`NIF ${formatarNIF(m.nif)}`} direita={<Chip texto={m.tipo === "titular" ? "Titular" : "Dependente"} tipo={m.tipo === "titular" ? "bom" : "neutro"} />} />
          ))}
        </Cartao>
      ) : null}
      <Texto forte tamanho={16}>Faturas de {ANO_FISCAL_CASA}</Texto>
      {faturas && !faturas.length ? <Vazio texto="A família ainda não registou faturas." /> : null}
      {faturas?.map((d) => (
        <Cartao key={d.id} estilo={{ paddingVertical: 4, opacity: d.anulada ? 0.6 : 1 }}>
          <Linha esquerda={d.emitente ?? `NIF ${d.nifEmitente}`} sub={`${dataPT(d.data)} · ${NOME_CATEGORIA_CASA[d.categoria]}${d.anulada ? " · anulada" : ""}`}
            direita={<Texto forte>{euros(d.total)}</Texto>} onPress={d.anulada ? undefined : () => setAberta(aberta === d.id ? null : d.id)} />
          {aberta === d.id ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingVertical: 10 }}>
              {CATEGORIAS.map((c) => (
                <Botao key={c} titulo={NOME_CATEGORIA_CASA[c]} variante={d.categoria === c ? "principal" : "secundario"} estilo={{ minHeight: 38, paddingHorizontal: 12 }}
                  onPress={async () => { setFalha(null); try { await api.familiaMudarCategoria(id, d.id, c); setAberta(null); recarregar(); } catch (e) { setFalha((e as Error).message); } }} />
              ))}
            </View>
          ) : null}
        </Cartao>
      ))}
    </Ecra>
  );
}
