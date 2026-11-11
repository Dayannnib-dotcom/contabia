import { useState } from "react";
import { Share, View } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import { formatarNIF, type Ligacao } from "@contabia/shared";
import { Botao, Cartao, Chip, Ecra, Erro, MensagemLuis, Numero, Texto, Titulo, cor, useDados, useSessao } from "@contabia/ui";

async function confirmarBiometria(): Promise<boolean> {
  const tem = await LocalAuthentication.hasHardwareAsync().catch(() => false);
  if (!tem) return true; // sem sensor (web/emulador): segue com a sessão já autenticada
  const r = await LocalAuthentication.authenticateAsync({ promptMessage: "Confirmar ligação ao contabilista", cancelLabel: "Cancelar" });
  return r.success;
}

export default function LigacaoEcra() {
  const { api, sessao } = useSessao();
  const { dados, erro: erroCarregar, recarregar } = useDados(async () => {
    const [eu, ligs] = await Promise.all([api.eu(), api.ligacoes()]);
    return { empresa: eu.empresa!, ligs };
  }, [sessao!.id]);
  const [erro, setErro] = useState<string | null>(null);
  const [aTratar, setATratar] = useState<string | null>(null);

  async function acao(l: Ligacao, tipo: "aceitar" | "recusar" | "revogar") {
    setErro(null);
    if (tipo === "aceitar" && !(await confirmarBiometria())) return setErro("Confirmação biométrica cancelada.");
    setATratar(l.id + tipo);
    try {
      if (tipo === "aceitar") await api.aceitarLigacao(l.id, l.versao);
      else if (tipo === "recusar") await api.recusarLigacao(l.id, l.versao);
      else await api.revogarLigacao(l.id, l.versao);
      await recarregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setATratar(null);
    }
  }

  const e = dados?.empresa;
  const pendentes = dados?.ligs.filter((l) => l.estado === "pendente") ?? [];
  const ativas = dados?.ligs.filter((l) => l.estado === "ativa") ?? [];

  return (
    <Ecra>
      <Titulo sub="O contabilista usa estes dois dados para pedir a ligação. Só fica ligado depois de aceitar aqui.">Os seus dados de ligação</Titulo>
      {e ? (
        <Cartao>
          <View style={{ flexDirection: "row", gap: 16 }}>
            <View style={{ flex: 1, gap: 2 }}><Texto sec tamanho={12}>Utilizador da empresa</Texto><Numero tamanho={17}>{e.utilizador}</Numero></View>
            <View style={{ flex: 1, gap: 2 }}><Texto sec tamanho={12}>NIF</Texto><Numero tamanho={17}>{formatarNIF(e.nif)}</Numero></View>
          </View>
          <Botao titulo="Partilhar com o contabilista" variante="secundario"
            onPress={() => Share.share({ message: `Dados de ligação Contabia — Utilizador: ${e.utilizador} · NIF: ${e.nif}` })} />
        </Cartao>
      ) : null}
      <Erro texto={erro ?? erroCarregar} />

      {pendentes.map((l) => (
        <Cartao key={l.id} destaque>
          <Texto forte tamanho={16}>{l.contabilista?.nome}</Texto>
          <Texto sec tamanho={12}>Contabilista Certificado · n.º {l.contabilista?.numeroOCC}</Texto>
          <Texto>Pede para se ligar à sua empresa. Se aceitar, poderá ver e pedir documentos, fazer os lançamentos e o apuramento de IVA, gerar o SAF-T e fechar períodos.</Texto>
          <Texto sec tamanho={12}>Pode revogar o acesso a qualquer momento. O pedido expira em 72 horas.</Texto>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Botao titulo="Recusar" variante="secundario" onPress={() => acao(l, "recusar")} carregando={aTratar === l.id + "recusar"} estilo={{ flex: 1 }} />
            <Botao titulo="Aceitar com biometria" onPress={() => acao(l, "aceitar")} carregando={aTratar === l.id + "aceitar"} estilo={{ flex: 2 }} />
          </View>
        </Cartao>
      ))}

      {ativas.map((l) => (
        <Cartao key={l.id}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: cor.menta }} /><Texto forte cor={cor.verdeEscuro}>Ligação ativa</Texto></View>
          <Texto>{l.contabilista?.nome} está ligado. Tudo o que carregar chega-lhe ao segundo, e os pedidos dele aparecem aqui.</Texto>
          <Botao titulo="Revogar acesso" variante="perigo" onPress={() => acao(l, "revogar")} carregando={aTratar === l.id + "revogar"} />
        </Cartao>
      ))}

      {dados && !pendentes.length && !ativas.length ? (
        <MensagemLuis texto="Ainda não tem contabilista ligado. Partilhe o seu utilizador e NIF; quando ele pedir a ligação, aparece aqui para aceitar." />
      ) : null}
      {dados?.ligs.filter((l) => ["recusada", "revogada", "expirada"].includes(l.estado)).slice(0, 3).map((l) => (
        <View key={l.id} style={{ flexDirection: "row", justifyContent: "space-between" }}><Texto sec>{l.contabilista?.nome}</Texto><Chip texto={l.estado} /></View>
      ))}
    </Ecra>
  );
}
