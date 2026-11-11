import { useEffect, useState } from "react";
import { Switch, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { dataPT, euros, formatarNIF } from "@contabia/shared";
import { Botao, Campo, Cartao, Ecra, Erro, Linha, MensagemLuis, Texto, Titulo, cor, useDados, useSessao } from "@contabia/ui";

export default function DetalheDocumento() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api, sessao } = useSessao();
  const router = useRouter();
  const { dados } = useDados(async () => (await api.documentos(sessao!.id)).find((d) => d.id === id) ?? null, [id]);
  const [conta, setConta] = useState("");
  const [dedutivel, setDedutivel] = useState(true);
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [aEnviar, setAEnviar] = useState(false);
  useEffect(() => {
    if (dados) { setConta(dados.contaSugerida); setDedutivel(dados.ivaDedutivel); setNome(dados.terceiroNome); }
  }, [dados]);
  if (!dados) return <Ecra><Texto sec>A carregar…</Texto></Ecra>;

  async function validar() {
    setAEnviar(true);
    try {
      await api.validarDocumento(sessao!.id, dados!.id, { contaSugerida: conta, ivaDedutivel: dedutivel, ...(nome !== dados!.terceiroNome ? { terceiroNome: nome } : {}) });
      router.back();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setAEnviar(false);
    }
  }

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
      <MensagemLuis texto={`Sugestão: ${dados.categoria} (conta SNC ${dados.contaSugerida})${dados.ivaDedutivel ? ", IVA dedutível." : ", IVA não dedutível."} Confirme ou corrija.`} />
      {dados.estado !== "validado" ? (
        <View style={{ gap: 14 }}>
          <Campo rotulo="Nome do fornecedor ou cliente" value={nome} onChangeText={setNome} />
          <Campo rotulo="Conta SNC" value={conta} onChangeText={setConta} keyboardType="number-pad" />
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Texto forte>IVA dedutível</Texto>
            <Switch value={dedutivel} onValueChange={setDedutivel} trackColor={{ true: cor.verde }} accessibilityLabel="IVA dedutível" />
          </View>
          <Erro texto={erro} />
          <Botao titulo="Validar documento" onPress={validar} carregando={aEnviar} desativado={!/^\d{2,8}$/.test(conta)} />
        </View>
      ) : (
        <Texto sec>Documento validado. O seu contabilista já o recebeu.</Texto>
      )}
    </Ecra>
  );
}
