import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { dataPT, diasAte, nomePeriodo, saudacao } from "@contabia/shared";
import { Botao, Cartao, Chip, Ecra, Erro, Icone, Linha, MensagemLuis, Numero, Texto, Titulo, cor, useDados, useSessao } from "@contabia/ui";

const MESES = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

export default function Painel() {
  const { api, sessao, online, sair } = useSessao();
  const router = useRouter();
  const id = sessao!.id;
  const { dados, erro, recarregar } = useDados(async () => {
    const [resumo, prazos, pedidos, ligacoes] = await Promise.all([api.resumo(id), api.prazos(id), api.pedidos(id), api.ligacoes()]);
    return { resumo, prazos, pedidos: pedidos.filter((p) => p.estado === "pendente"), ligPendente: ligacoes.find((l) => l.estado === "pendente" && l.iniciadaPor === "contabilista"), conviteEnviado: ligacoes.find((l) => l.estado === "pendente" && l.iniciadaPor === "empresa"), ligAtiva: ligacoes.find((l) => l.estado === "ativa") };
  }, [id]);

  const hoje = new Date().toISOString().slice(0, 10);
  const prox = dados?.prazos.find((p) => !p.submetida);
  const faltas = (dados?.resumo.documentosPorValidar ?? 0) + (dados?.pedidos.length ?? 0) + (dados?.ligPendente ? 1 : 0);
  const msg = !dados ? "A preparar o seu resumo…"
    : faltas === 0 ? `${saudacao()}! Estou atento a todas as suas faturas e obrigações. Por agora está tudo em dia — pode ficar descansado.`
    : `${saudacao()}! Estou atento às suas faturas e obrigações. Tem ${faltas} ${faltas === 1 ? "coisa" : "coisas"} para tratar${prox ? `; o próximo prazo é a ${dataPT(prox.prazo)}` : ""}.`;

  return (
    <Ecra>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
        <Titulo sub={online ? "Sincronizado em tempo real" : "Sem ligação — guardamos e enviamos depois"}>{dados?.resumo.empresa.nome ?? sessao!.nome}</Titulo>
        <Pressable accessibilityRole="button" accessibilityLabel="Terminar sessão" onPress={sair} style={{ padding: 10 }}>
          <Icone nome="sair" cor={cor.textoSec} />
        </Pressable>
      </View>
      <MensagemLuis texto={msg} escuro rotulo="Luís · o seu gestor virtual" />
      <Erro texto={erro} />

      {prox ? (
        <Cartao onPress={() => router.push("/(tabs)/prazos")} estilo={{ backgroundColor: cor.ambar, borderColor: cor.ambar, flexDirection: "row", alignItems: "center" }}>
          <View style={{ width: 52, alignItems: "center" }}>
            <Text style={{ fontSize: 11, fontWeight: "700", color: cor.ambarTexto }}>{MESES.at(Number(prox.prazo.slice(5, 7)) - 1)}</Text>
            <Numero tamanho={22}>{dataPT(prox.prazo).slice(0, 2)}</Numero>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Texto forte>{prox.descricao}</Texto>
            <Texto tamanho={12} cor={cor.ambarTexto}>{nomePeriodo(prox.periodo)} · faltam {diasAte(hoje, prox.prazo)} dias</Texto>
          </View>
        </Cartao>
      ) : null}

      <Cartao>
        <Texto forte tamanho={15}>Precisa da sua atenção</Texto>
        {dados?.ligPendente ? (
          <Linha esquerda="Pedido de ligação do contabilista" sub={dados.ligPendente.contabilista?.nome} direita={<Chip texto="Responder" tipo="aviso" />} onPress={() => router.push("/ligacao")} />
        ) : null}
        {dados?.conviteEnviado && !dados.ligAtiva ? (
          <Linha esquerda="Convite enviado ao contabilista" sub={`${dados.conviteEnviado.contabilista?.nome ?? ""} · à espera que aceite`} direita={<Chip texto="Enviado" />} onPress={() => router.push("/ligacao")} />
        ) : null}
        {(dados?.resumo.documentosPorValidar ?? 0) > 0 ? (
          <Linha esquerda={`${dados!.resumo.documentosPorValidar} documentos por validar`} sub="A IA já sugeriu a classificação" direita={<Chip texto="Validar" tipo="erro" />} onPress={() => router.push("/(tabs)/documentos")} />
        ) : null}
        {dados?.pedidos.map((p) => (
          <Linha key={p.id} esquerda={`Pedido do contabilista: ${p.tipo}`} sub={p.detalhe || "Carregue o documento e depois toque em «Já enviei»"}
            direita={<Botao titulo="Já enviei" variante="menta" estilo={{ minHeight: 36, paddingHorizontal: 12 }} onPress={async () => { try { await api.marcarRecebido(id, p.id); recarregar(); } catch {} }} />}
            onPress={() => router.push("/(tabs)/digitalizar")} direitaInterativa />
        ))}
        {dados && faltas === 0 ? <Texto sec>Nada pendente.</Texto> : null}
      </Cartao>

      <Cartao>
        <Linha esquerda="Ligação ao contabilista" sub={dados?.ligAtiva ? `Ativa · ${dados.ligAtiva.contabilista?.nome}` : "Convide o seu contabilista ou partilhe o utilizador e o NIF"} direita={<Icone nome="seguir" cor={cor.textoSec} />} onPress={() => router.push("/ligacao")} />
        <Linha esquerda="Atualizações fiscais" sub="Aplicadas automaticamente na data legal" direita={<Icone nome="seguir" cor={cor.textoSec} />} onPress={() => router.push("/atualizacoes")} />
      </Cartao>
    </Ecra>
  );
}
