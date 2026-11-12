import { useEffect } from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { formatarNIF, saudacao } from "@contabia/shared";
import { Botao, Cartao, Chip, Ecra, Erro, Icone, MensagemLuis, Numero, Texto, Titulo, Vazio, cor, useDados, useSessao } from "@contabia/ui";

const pl = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

export default function Carteira() {
  const { api, sessao, online, sair, definirEmpresas } = useSessao();
  const router = useRouter();
  const { dados, erro } = useDados(() => api.carteira(), [sessao!.id]);
  const { dados: ligs } = useDados(() => api.ligacoes(), [sessao!.id]);
  const convites = (ligs ?? []).filter((l) => l.estado === "pendente" && l.iniciadaPor === "empresa");
  useEffect(() => { if (dados) definirEmpresas(dados.map((r) => r.empresa.id)); }, [dados, definirEmpresas]);

  const rev = dados?.reduce((s, r) => s + r.lancamentosPorRever, 0) ?? 0;
  const ped = dados?.reduce((s, r) => s + r.pedidosPendentes, 0) ?? 0;
  const iva = dados?.filter((r) => !r.ivaSubmetido).length ?? 0;
  const prioridade = dados?.slice().sort((a, b) => (b.lancamentosPorRever + b.pedidosPendentes + (b.ivaSubmetido ? 0 : 1)) - (a.lancamentosPorRever + a.pedidosPendentes + (a.ivaSubmetido ? 0 : 1))).find((r) => r.lancamentosPorRever + r.pedidosPendentes + (r.ivaSubmetido ? 0 : 1) > 0);
  const msg = !dados ? "A preparar o resumo do dia…"
    : dados.length === 0 ? "Ainda não tem empresas. Use «Ligar empresa» com o utilizador e o NIF que a empresa lhe der."
    : rev + ped + iva === 0 ? `Está tudo revisto e submetido ${dados.length === 1 ? "na sua empresa" : `nas suas ${dados.length} empresas`}. Bom trabalho!`
    : `Hoje temos muito trabalho por ver e submeter: ${pl(rev, "lançamento", "lançamentos")} para rever, ${pl(ped, "pedido", "pedidos")} à espera das empresas e ${pl(iva, "declaração de IVA", "declarações de IVA")} por submeter.${prioridade ? ` Sugiro começar pela ${prioridade.empresa.nome.replace(/\.$/, "")}.` : ""}`;
  const primeira = dados?.find((r) => r.lancamentosPorRever > 0);

  return (
    <Ecra>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Titulo sub={online ? "Sincronizado em tempo real" : "A ligar…"}>{saudacao()}, {sessao!.nome.split(" ")[0]}</Titulo>
        <Pressable accessibilityRole="button" accessibilityLabel="Terminar sessão" onPress={sair} style={{ padding: 10 }}><Icone nome="sair" cor={cor.textoSec} /></Pressable>
      </View>
      {convites.length ? (
        <MensagemLuis texto={convites.length === 1 ? `A ${convites[0].empresa?.nome?.replace(/\.$/, "")} convidou-o para ser o contabilista dela.` : `Tem ${convites.length} convites de empresas à espera de resposta.`}
          acao={<Botao titulo="Ver convites" variante="menta" onPress={() => router.push("/(tabs)/ligar")} estilo={{ alignSelf: "flex-start", minHeight: 40, marginTop: 6 }} />} />
      ) : null}
      <MensagemLuis escuro rotulo="Luís · assistente do seu gabinete" texto={msg} acao={primeira ? <Botao titulo="Começar revisão" variante="menta" onPress={() => router.push({ pathname: "/empresa/[id]", params: { id: primeira.empresa.id, sec: "revisao" } })} estilo={{ alignSelf: "flex-start", minHeight: 40, marginTop: 6 }} /> : undefined} />
      <Erro texto={erro} />
      <View style={{ flexDirection: "row", gap: 10 }}>
        {[["Por rever", rev], ["Pedidos", ped], ["IVA por submeter", iva]].map(([t, n]) => (
          <Cartao key={String(t)} estilo={{ flex: 1, gap: 2 }}><Texto sec tamanho={12}>{t}</Texto><Numero tamanho={26}>{n}</Numero></Cartao>
        ))}
      </View>
      <Texto forte tamanho={16}>Carteira</Texto>
      {dados?.length === 0 ? <Vazio texto="Sem empresas ligadas." /> : null}
      {dados?.map((r) => (
        <Cartao key={r.empresa.id} onPress={() => router.push({ pathname: "/empresa/[id]", params: { id: r.empresa.id } })}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Texto forte>{r.empresa.nome}</Texto>
              <Texto sec tamanho={12}>NIF {formatarNIF(r.empresa.nif)} · {r.empresa.regiao === "PT" ? "Continente" : r.empresa.regiao === "PT-MA" ? "Madeira" : "Açores"} · IVA {r.empresa.regimeIVA}</Texto>
            </View>
            <Icone nome="seguir" cor={cor.textoSec} />
          </View>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            <Chip texto={r.lancamentosPorRever ? `${r.lancamentosPorRever} por rever` : "Revisto"} tipo={r.lancamentosPorRever ? "erro" : "bom"} />
            {r.pedidosPendentes ? <Chip texto={`${r.pedidosPendentes} pedidos`} tipo="aviso" /> : null}
            <Chip texto={r.ivaSubmetido ? "IVA submetido" : "IVA por submeter"} tipo={r.ivaSubmetido ? "bom" : "aviso"} />
          </View>
        </Cartao>
      ))}
    </Ecra>
  );
}
