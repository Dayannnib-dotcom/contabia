import { useState } from "react";
import { View } from "react-native";
import { formatarNIF, type Ligacao } from "@contabia/shared";
import { Botao, Campo, Cartao, Chip, Ecra, Erro, MensagemLuis, Numero, Texto, Titulo, confirmarBiometria, cor, partilhar, useDados, useSessao } from "@contabia/ui";

const dataCurta = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

export default function LigacaoEcra() {
  const { api, sessao } = useSessao();
  const { dados, erro: erroCarregar, recarregar } = useDados(async () => {
    const [eu, ligs] = await Promise.all([api.eu(), api.ligacoes()]);
    return { empresa: eu.empresa!, ligs };
  }, [sessao!.id]);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [aTratar, setATratar] = useState<string | null>(null);
  const [contabilista, setContabilista] = useState("");
  const [aConvidar, setAConvidar] = useState(false);

  async function acao(l: Ligacao, tipo: "aceitar" | "recusar" | "revogar") {
    setErro(null);
    setAviso(null);
    if (tipo === "aceitar" && !(await confirmarBiometria("Confirmar ligação ao contabilista"))) return setErro("Confirmação biométrica cancelada.");
    setATratar(l.id + tipo);
    try {
      if (tipo === "aceitar") await api.aceitarLigacao(l.id, l.versao);
      else if (tipo === "recusar") await api.recusarLigacao(l.id, l.versao);
      else await api.revogarLigacao(l.id, l.versao);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setATratar(null);
      await recarregar();
    }
  }

  async function convidar() {
    setErro(null);
    setAviso(null);
    setAConvidar(true);
    try {
      const l = await api.convidarContabilista(contabilista.trim());
      setContabilista("");
      setAviso(l.estado === "ativa"
        ? `Ligação ativa com ${l.contabilista?.nome ?? "o seu contabilista"}: ele já lhe tinha enviado um pedido.`
        : `Convite enviado a ${l.contabilista?.nome ?? "o contabilista"}. Fica ativo quando ele aceitar na app dele.`);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setAConvidar(false);
      await recarregar();
    }
  }

  async function partilharDados() {
    if (!e) return;
    const r = await partilhar(`Dados de ligação Contabia — Utilizador: ${e.utilizador} · NIF: ${e.nif}`, "Dados de ligação Contabia");
    if (r === "copiado") setAviso("Dados copiados. Cole-os numa mensagem ao seu contabilista.");
  }

  const gestor = sessao!.perfil !== "colaborador";
  const e = dados?.empresa;
  const ligs = dados?.ligs ?? [];
  const ativas = ligs.filter((l) => l.estado === "ativa");
  const recebidos = ligs.filter((l) => l.estado === "pendente" && l.iniciadaPor === "contabilista");
  const enviados = ligs.filter((l) => l.estado === "pendente" && l.iniciadaPor === "empresa");
  const historico = ligs.filter((l) => ["recusada", "revogada", "expirada"].includes(l.estado)).slice(0, 3);
  const valorOk = contabilista.includes("@") ? /^\S+@\S+\.\S+$/.test(contabilista.trim()) : /^\d{1,10}$/.test(contabilista.trim());

  return (
    <Ecra>
      <Titulo sub="A ligação funciona nos dois sentidos: o contabilista pode pedi-la, ou a empresa pode convidá-lo. Fica ativa quando o outro lado aceitar.">Ligação ao contabilista</Titulo>
      <Erro texto={erro ?? erroCarregar} />
      {aviso ? <MensagemLuis texto={aviso} /> : null}

      {!gestor ? <MensagemLuis texto="A ligação ao contabilista é gerida pelo gestor da empresa. Aqui pode ver quem é o contabilista." /> : null}
      {gestor && recebidos.map((l) => (
        <Cartao key={l.id} destaque>
          <Chip texto="Pedido recebido" tipo="aviso" />
          <Texto forte tamanho={16}>{l.contabilista?.nome}</Texto>
          <Texto sec tamanho={12}>Contabilista Certificado · n.º OCC {l.contabilista?.numeroOCC}</Texto>
          <Texto>Pede para se ligar à sua empresa. Se aceitar, poderá ver e pedir documentos, fazer os lançamentos e o apuramento de IVA, gerar o SAF-T e fechar períodos.</Texto>
          <Texto sec tamanho={12}>Pode revogar o acesso a qualquer momento. O pedido expira a {dataCurta(l.expiraEm)}.</Texto>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Botao titulo="Recusar" variante="secundario" onPress={() => acao(l, "recusar")} carregando={aTratar === l.id + "recusar"} estilo={{ flex: 1 }} />
            <Botao titulo="Aceitar com biometria" onPress={() => acao(l, "aceitar")} carregando={aTratar === l.id + "aceitar"} estilo={{ flex: 2 }} />
          </View>
        </Cartao>
      ))}

      {ativas.map((l) => (
        <Cartao key={l.id}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: cor.menta }} /><Texto forte cor={cor.verdeEscuro}>Ligação ativa</Texto></View>
          <Texto>{l.contabilista?.nome} (n.º OCC {l.contabilista?.numeroOCC}) está ligado. Tudo o que carregar chega-lhe ao segundo, e os pedidos dele aparecem no seu painel.</Texto>
          {gestor ? <Botao titulo="Revogar acesso" variante="perigo" onPress={() => acao(l, "revogar")} carregando={aTratar === l.id + "revogar"} /> : null}
        </Cartao>
      ))}

      {gestor && enviados.map((l) => (
        <Cartao key={l.id}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Texto forte>{l.contabilista?.nome}</Texto>
              <Texto sec tamanho={12}>n.º OCC {l.contabilista?.numeroOCC} · expira a {dataCurta(l.expiraEm)}</Texto>
            </View>
            <Chip texto="À espera do contabilista" tipo="aviso" />
          </View>
          <Texto sec tamanho={12}>O contabilista recebeu o convite na app dele. Assim que aceitar, a ligação fica ativa.</Texto>
          <Botao titulo="Cancelar convite" variante="secundario" onPress={() => acao(l, "revogar")} carregando={aTratar === l.id + "revogar"} />
        </Cartao>
      ))}

      {gestor && !ativas.length ? (
        <Cartao>
          <Texto forte tamanho={15}>Opção 1 · Convidar o meu contabilista</Texto>
          <Texto sec tamanho={12}>Escreva o email com que o contabilista entra na Contabia, ou o número dele na Ordem (OCC).</Texto>
          <Campo rotulo="Email ou n.º OCC do contabilista" value={contabilista} onChangeText={setContabilista} autoCapitalize="none" autoCorrect={false} placeholder="ex.: ana@gabinete.pt ou 12345" />
          <Botao titulo="Enviar convite" onPress={convidar} carregando={aConvidar} desativado={!valorOk} />
        </Cartao>
      ) : null}

      {gestor && e && !ativas.length ? (
        <Cartao>
          <Texto forte tamanho={15}>Opção 2 · O contabilista pede a ligação</Texto>
          <Texto sec tamanho={12}>Partilhe estes dois dados. Ele escreve-os na app dele e o pedido aparece aqui para aceitar.</Texto>
          <View style={{ flexDirection: "row", gap: 16 }}>
            <View style={{ flex: 1, gap: 2 }}><Texto sec tamanho={12}>Utilizador da empresa</Texto><Numero tamanho={17}>{e.utilizador}</Numero></View>
            <View style={{ flex: 1, gap: 2 }}><Texto sec tamanho={12}>NIF</Texto><Numero tamanho={17}>{formatarNIF(e.nif)}</Numero></View>
          </View>
          <Botao titulo="Partilhar com o contabilista" variante="secundario" onPress={partilharDados} />
        </Cartao>
      ) : null}

      {historico.map((l) => (
        <View key={l.id} style={{ flexDirection: "row", justifyContent: "space-between" }}><Texto sec>{l.contabilista?.nome}</Texto><Chip texto={l.estado} /></View>
      ))}
    </Ecra>
  );
}
