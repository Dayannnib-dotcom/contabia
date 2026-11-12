import { useEffect, useState } from "react";
import { Switch, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { MOTIVOS_ANULACAO, dataPT, euros, formatarNIF, motivoLegivel, type MotivoAnulacao } from "@contabia/shared";
import { Botao, Campo, Cartao, Chip, Ecra, Erro, Linha, ListaAnexos, MensagemLuis, Texto, Titulo, cor, useDados, useSessao } from "@contabia/ui";
import { enviarAnexo, escolherDaGaleria, escolherPDF, fotografar, type Ficheiro } from "../../lib/anexar";
import { Pressable } from "react-native";

export default function DetalheDocumento() {
  const { id, novo } = useLocalSearchParams<{ id: string; novo?: string }>();
  const { api, sessao } = useSessao();
  const router = useRouter();
  const { dados, recarregar } = useDados(async () => {
    const doc = (await api.documentos(sessao!.id)).find((d) => d.id === id) ?? null;
    return doc ? { ...doc, ficheiros: await api.anexos(sessao!.id, doc.id) } : null;
  }, [id]);
  const [aAnexar, setAAnexar] = useState(false);
  const [erroAnexo, setErroAnexo] = useState<string | null>(null);

  async function anexar(escolher: () => Promise<Ficheiro | null>) {
    setErroAnexo(null);
    try {
      const f = await escolher();
      if (!f) return;
      setAAnexar(true);
      await enviarAnexo(api, sessao!.id, id, f);
      await recarregar();
    } catch (e) {
      setErroAnexo((e as Error).message);
    } finally {
      setAAnexar(false);
    }
  }
  const [conta, setConta] = useState("");
  const [dedutivel, setDedutivel] = useState(true);
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [aEnviar, setAEnviar] = useState(false);
  const [anular, setAnular] = useState(false);
  const [motivo, setMotivo] = useState<MotivoAnulacao | null>(null);
  const [detalhe, setDetalhe] = useState("");
  const [confirmar, setConfirmar] = useState(false);
  useEffect(() => {
    if (dados) { setConta(dados.contaSugerida); setDedutivel(dados.ivaDedutivel); setNome(dados.terceiroNome); }
  }, [dados]);
  if (!dados) return <Ecra><Texto sec>A carregar…</Texto></Ecra>;

  async function validar() {
    setAEnviar(true);
    try {
      await api.validarDocumento(sessao!.id, dados!.id, { contaSugerida: conta, ivaDedutivel: dedutivel, ...(nome !== dados!.terceiroNome ? { terceiroNome: nome } : {}) });
      router.dismissTo("/(tabs)/documentos");
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setAEnviar(false);
    }
  }

  async function pedirAnulacao() {
    if (!motivo) return;
    setAEnviar(true);
    setErro(null);
    try {
      await api.pedirAnulacao(sessao!.id, dados!.id, motivo, detalhe.trim() || undefined);
      setAnular(false); setConfirmar(false); setMotivo(null); setDetalhe("");
      await recarregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setAEnviar(false);
    }
  }

  const anulado = dados.estado === "anulado";
  const pedida = dados.estado === "anulacao_pedida";

  return (
    <Ecra>
      <Titulo sub={`${dados.numero} · ${dataPT(dados.data)}`}>{dados.terceiroNome}</Titulo>
      <Cartao estilo={{ paddingVertical: 4 }}>
        <Linha esquerda="NIF" direita={<Texto>{formatarNIF(dados.terceiroNif)}</Texto>} />
        <Linha esquerda="ATCUD" direita={<Texto>{dados.atcud || "—"}</Texto>} />
        <Linha esquerda="Base" direita={<Texto>{euros(dados.base)}</Texto>} />
        <Linha esquerda={`IVA ${dados.taxa}%`} direita={<Texto>{euros(dados.iva)}</Texto>} />
        <Linha esquerda="Total" direita={<Texto forte>{euros(dados.total)}</Texto>} />
      </Cartao>
      <Cartao>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Texto forte tamanho={15}>Original da fatura</Texto>
          <Chip texto={dados.ficheiros.length ? "Guardado na nuvem" : "Falta o original"} tipo={dados.ficheiros.length ? "bom" : "aviso"} />
        </View>
        {!dados.ficheiros.length ? (
          <Texto sec tamanho={12}>{novo ? "Documento registado! Agora fotografe a fatura em papel ou junte o PDF: o original fica guardado 10 anos, como a lei exige." : "Fotografe a fatura ou junte o PDF. Assim não precisa de guardar o papel."}</Texto>
        ) : null}
        <ListaAnexos api={api} empresaId={sessao!.id} documentoId={dados.id} anexos={dados.ficheiros} />
        <Erro texto={erroAnexo} />
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <Botao titulo="Fotografar" onPress={() => anexar(fotografar)} carregando={aAnexar} estilo={{ flexGrow: 1 }} />
          <Botao titulo="Galeria" variante="secundario" onPress={() => anexar(escolherDaGaleria)} desativado={aAnexar} estilo={{ flexGrow: 1 }} />
          <Botao titulo="PDF" variante="secundario" onPress={() => anexar(escolherPDF)} desativado={aAnexar} estilo={{ flexGrow: 1 }} />
        </View>
      </Cartao>
      <MensagemLuis texto={`Sugestão: ${dados.categoria} (conta SNC ${dados.contaSugerida})${dados.ivaDedutivel ? ", IVA dedutível." : ", IVA não dedutível."} Confirme ou corrija.`} />
      {anulado ? (
        <Cartao>
          <Chip texto="Anulado" />
          <Texto>Este documento foi anulado e já não conta para o IVA nem para a contabilidade.</Texto>
          {dados.anulacao ? <Texto sec tamanho={12}>Motivo: {motivoLegivel(dados.anulacao.motivo)}</Texto> : null}
          <Texto sec tamanho={12}>Continua guardado na nuvem, como a lei exige (10 anos).</Texto>
        </Cartao>
      ) : pedida ? (
        <Cartao>
          <Chip texto="Anulação pedida" tipo="aviso" />
          <Texto>Pediu para anular este documento. O seu contabilista vai confirmar.</Texto>
          {dados.anulacao ? <Texto sec tamanho={12}>Motivo: {motivoLegivel(dados.anulacao.motivo)}</Texto> : null}
        </Cartao>
      ) : dados.estado !== "validado" ? (
        <View style={{ gap: 14 }}>
          <Campo rotulo="Nome do fornecedor ou cliente" value={nome} onChangeText={setNome} />
          <Campo rotulo="Conta SNC" value={conta} onChangeText={setConta} keyboardType="number-pad" />
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Texto forte>IVA dedutível</Texto>
            <Switch value={dedutivel} onValueChange={setDedutivel} trackColor={{ true: cor.verde }} accessibilityLabel="IVA dedutível" />
          </View>
          <Erro texto={!anular ? erro : null} />
          <Botao titulo="Validar documento" onPress={validar} carregando={aEnviar} desativado={!/^\d{2,8}$/.test(conta)} />
        </View>
      ) : (
        <Texto sec>Documento validado. O seu contabilista já o recebeu.</Texto>
      )}

      {!anulado && !pedida ? (
        !anular ? (
          <Botao titulo="Este documento tem um erro" variante="secundario" onPress={() => setAnular(true)} />
        ) : (
          <Cartao>
            <Texto forte tamanho={15}>Pedir anulação ao contabilista</Texto>
            <Texto sec tamanho={12}>Os documentos nunca são apagados. O contabilista confirma a anulação e o documento deixa de contar, mas fica guardado no histórico.</Texto>
            {(Object.keys(MOTIVOS_ANULACAO) as MotivoAnulacao[]).map((m) => (
              <Pressable key={m} accessibilityRole="radio" accessibilityState={{ checked: motivo === m }} onPress={() => { setMotivo(m); setConfirmar(false); }}
                style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 }}>
                <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: motivo === m ? cor.verde : cor.bordaForte, alignItems: "center", justifyContent: "center" }}>
                  {motivo === m ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: cor.verde }} /> : null}
                </View>
                <Texto>{MOTIVOS_ANULACAO[m]}</Texto>
              </Pressable>
            ))}
            <Campo rotulo="Explique ao contabilista (opcional)" value={detalhe} onChangeText={setDetalhe} placeholder="ex.: o valor certo é 100 €" />
            <Erro texto={erro} />
            {!confirmar ? (
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Botao titulo="Cancelar" variante="secundario" onPress={() => { setAnular(false); setMotivo(null); setErro(null); }} estilo={{ flex: 1 }} />
                <Botao titulo="Continuar" onPress={() => setConfirmar(true)} desativado={!motivo} estilo={{ flex: 1 }} />
              </View>
            ) : (
              <View style={{ gap: 8 }}>
                <Texto forte>Confirma que quer pedir a anulação de {dados.numero}?</Texto>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <Botao titulo="Não" variante="secundario" onPress={() => setConfirmar(false)} estilo={{ flex: 1 }} />
                  <Botao titulo="Sim, pedir anulação" variante="perigo" onPress={pedirAnulacao} carregando={aEnviar} estilo={{ flex: 2 }} />
                </View>
              </View>
            )}
          </Cartao>
        )
      ) : null}
    </Ecra>
  );
}
