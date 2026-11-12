import { FilaPendente } from "../../components/FilaPendente";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { dataPT, diasAte, euros, nomePeriodo, saudacao } from "@contabia/shared";
import { Botao, Cartao, GraficoMensal, useAvisosPrazos, Chip, Ecra, Erro, Icone, Linha, MensagemLuis, Numero, Texto, Titulo, cor, useDados, useSessao } from "@contabia/ui";

const MESES = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

export default function Painel() {
  const { api, sessao, online } = useSessao();
  const router = useRouter();
  const id = sessao!.id;
  const gestor = sessao!.perfil !== "colaborador";
  const { dados, erro, recarregar } = useDados(async () => {
    const [resumo, prazos, pedidos, ligacoes, docs, apoios] = await Promise.all([api.resumo(id), api.prazos(id), api.pedidos(id), api.ligacoes(), api.documentos(id), api.apoios(id).catch(() => null)]);
    return { resumo, docs, apoios, prazos, pedidos: pedidos.filter((p) => p.estado === "pendente"), ligPendente: ligacoes.find((l) => l.estado === "pendente" && l.iniciadaPor === "contabilista"), conviteEnviado: ligacoes.find((l) => l.estado === "pendente" && l.iniciadaPor === "empresa"), ligAtiva: ligacoes.find((l) => l.estado === "ativa") };
  }, [id]);

  // Avisos no telemóvel 7 dias, 2 dias e no dia de cada prazo por submeter (funcionam com a app fechada).
  useAvisosPrazos(dados ? dados.prazos.filter((p) => !p.submetida).map((p) => ({
    chave: `${p.codigo}:${p.periodo}`, prazo: p.prazo,
    titulo: p.descricao,
    corpo: `Luís: termina a ${p.prazo.split("-").reverse().join("/")} (${nomePeriodo(p.periodo)}). Envie já as faturas e documentos que faltam ao seu contabilista.`,
  })) : null);
  const hoje = new Date().toISOString().slice(0, 10);
  const prox = dados?.prazos.find((p) => !p.submetida);
  const faltas = (dados?.resumo.documentosPorValidar ?? 0) + (dados?.pedidos.length ?? 0) + (dados?.ligPendente ? 1 : 0);
  const msg = !dados ? "A preparar o seu resumo…"
    : faltas === 0 ? `${saudacao()}! Estou atento a todas as suas faturas e obrigações. Por agora está tudo em dia — pode ficar descansado.`
    : `${saudacao()}! Estou atento às suas faturas e obrigações. Tem ${faltas} ${faltas === 1 ? "coisa" : "coisas"} para tratar${prox ? `; o próximo prazo é a ${dataPT(prox.prazo)}` : ""}.`;

  return (
    <Ecra>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
        <Titulo sub={`${sessao!.quem ? `${sessao!.quem} · ` : ""}${online ? "Sincronizado em tempo real" : "Sem internet — pode continuar a registar faturas; enviamos quando a rede voltar"}`}>{dados?.resumo.empresa.nome ?? sessao!.nome}</Titulo>
      </View>
      <MensagemLuis texto={msg} escuro rotulo="Luís · o seu gestor virtual" />
      <Erro texto={erro} />
      <FilaPendente compacto />

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

      {dados?.docs.length ? (
        <Cartao>
          <Texto forte tamanho={15}>Os seus números</Texto>
          <GraficoMensal docs={dados.docs} />
          {(() => {
            // IVA estimado do período em curso: IVA das vendas − IVA dedutível das compras
            const agora = new Date();
            const trimestral = dados.resumo.empresa.regimeIVA === "trimestral";
            const m0 = trimestral ? Math.floor(agora.getMonth() / 3) * 3 : agora.getMonth();
            const meses = (trimestral ? [m0, m0 + 1, m0 + 2] : [m0]).map((m) => `${agora.getFullYear()}-${String(m + 1).padStart(2, "0")}`);
            const doPeriodo = dados.docs.filter((d) => meses.includes(d.data.slice(0, 7)) && d.estado !== "anulado" && d.estado !== "anulacao_pedida");
            const iva = doPeriodo.reduce((s2, d) => s2 + (d.tipo === "venda" ? d.iva : d.tipo === "compra" && d.ivaDedutivel ? -d.iva : 0), 0);
            return (
              <View style={{ borderTopWidth: 1, borderTopColor: cor.linha, paddingTop: 10, gap: 2 }}>
                <Texto sec tamanho={12}>IVA estimado {trimestral ? "deste trimestre" : "deste mês"} (com o que já registou)</Texto>
                <Texto forte tamanho={20}>{iva >= 0 ? `${euros(iva)} a pagar` : `${euros(-iva)} a recuperar`}</Texto>
              </View>
            );
          })()}
        </Cartao>
      ) : null}

      {dados?.apoios ? (() => {
        const abertos = dados.apoios.apoios.filter((a) => a.apoio.estado === "aberto");
        const prox = abertos.find((a) => a.diasParaFim !== null);
        return (
          <Cartao onPress={() => router.push("/apoios")} estilo={{ backgroundColor: cor.tinta, borderColor: cor.tinta, gap: 6 }}>
            <Texto tamanho={11} forte cor={cor.menta}>APOIOS EUROPEUS</Texto>
            <Texto forte tamanho={17} cor="#FFFFFF">
              {!dados.apoios.perfil.cae ? "Há fundos europeus para a sua atividade?"
                : abertos.length ? `${abertos.length === 1 ? "1 aviso aberto pode" : `${abertos.length} avisos abertos podem`} servir à sua empresa`
                : "Sem avisos abertos para a sua atividade agora"}
            </Texto>
            <Texto tamanho={13} cor="#C9D6DC">
              {!dados.apoios.perfil.cae ? "Indique o CAE e eu procuro os apoios a que se pode candidatar."
                : prox ? `O próximo a fechar: ${prox.apoio.nome}, ${prox.diasParaFim! <= 0 ? "hoje" : `daqui a ${prox.diasParaFim} ${prox.diasParaFim === 1 ? "dia" : "dias"}`}.`
                : "Veja os avisos previstos e peça um estudo de viabilidade."}
            </Texto>
            <Texto forte tamanho={14} cor={cor.menta}>{dados.apoios.perfil.cae ? "Ver apoios e pedir estudo ›" : "Indicar o CAE ›"}</Texto>
          </Cartao>
        );
      })() : null}

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
        {gestor ? <Linha esquerda="Utilizadores e atividade" sub="Colaboradores e registo de quem fez o quê" direita={<Icone nome="seguir" cor={cor.textoSec} />} onPress={() => router.push("/utilizadores")} /> : null}
        {gestor ? <Linha esquerda="Banco" sub="Importar extrato e ligar pagamentos às faturas" direita={<Icone nome="seguir" cor={cor.textoSec} />} onPress={() => router.push("/banco")} /> : null}
        <Linha esquerda="Conta e segurança" sub="Os seus dados estão guardados na nuvem" direita={<Icone nome="seguir" cor={cor.textoSec} />} onPress={() => router.push("/conta")} />
        <Linha esquerda="Atualizações fiscais" sub="Aplicadas automaticamente na data legal" direita={<Icone nome="seguir" cor={cor.textoSec} />} onPress={() => router.push("/atualizacoes")} />
      </Cartao>
    </Ecra>
  );
}
