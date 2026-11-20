import { useState } from "react";
import { View } from "react-native";
import { dataPT, validarNIF } from "@contabia/shared";
import { Botao, Campo, Cartao, Chip, Ecra, Erro, Linha, Texto, Titulo, useDados, useSessao } from "@contabia/ui";

/** Agregado familiar: titulares (até dois) e dependentes; consentimento para faturas de saúde. */
export default function AgregadoCasa() {
  const { api } = useSessao();
  const { dados, erro, recarregar } = useDados(() => api.casa(), []);
  const [nome, setNome] = useState("");
  const [nif, setNif] = useState("");
  const [tipo, setTipo] = useState<"titular" | "dependente">("dependente");
  const [falha, setFalha] = useState<string | null>(null);
  const [retirar, setRetirar] = useState<string | null>(null);
  const ativos = dados?.membros.filter((m) => m.ativo) ?? [];
  const consentimento = dados?.agregado.consentimentoSaudeEm;
  async function fazer(f: () => Promise<unknown>) { setFalha(null); try { await f(); recarregar(); } catch (e) { setFalha((e as Error).message); } }

  return (
    <Ecra>
      <Titulo sub="Quem entra na sua declaração de IRS">Agregado familiar</Titulo>
      <Erro texto={erro ?? falha} />
      <Cartao estilo={{ paddingVertical: 4 }}>
        {ativos.map((m) => (
          <Linha key={m.id} esquerda={m.nome} sub={`NIF ${m.nif}`} direita={<Chip texto={m.tipo === "titular" ? "Titular" : "Dependente"} tipo={m.tipo === "titular" ? "bom" : "neutro"} />}
            onPress={ativos.length > 1 ? () => setRetirar(retirar === m.id ? null : m.id) : undefined} />
        ))}
      </Cartao>
      {retirar ? (
        <Botao titulo={`Retirar ${ativos.find((m) => m.id === retirar)?.nome.split(" ")[0] ?? ""} do agregado`} variante="perigo"
          onPress={() => fazer(async () => { await api.casaDesativarMembro(retirar); setRetirar(null); })} />
      ) : ativos.length > 1 ? <Texto sec tamanho={12}>Para retirar alguém do agregado, toque no nome. Fica no histórico.</Texto> : null}

      <Cartao>
        <Texto forte tamanho={15}>Acrescentar pessoa</Texto>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {(["dependente", "titular"] as const).map((x) => (
            <Botao key={x} titulo={x === "titular" ? "Titular" : "Dependente"} variante={tipo === x ? "principal" : "secundario"} onPress={() => setTipo(x)} estilo={{ flex: 1 }} />
          ))}
        </View>
        <Campo rotulo="Nome" value={nome} onChangeText={setNome} />
        <Campo rotulo="NIF" value={nif} onChangeText={setNif} keyboardType="number-pad" erro={nif.length >= 9 && !validarNIF(nif)} ajuda={tipo === "titular" ? "Cônjuge ou unido de facto, se entregam o IRS em conjunto." : "Filhos ou outros dependentes a seu cargo."} />
        <Botao titulo="Acrescentar" desativado={nome.trim().length < 2 || !validarNIF(nif)} onPress={() => fazer(async () => { await api.casaNovoMembro({ nome, nif: nif.replace(/\s/g, ""), tipo }); setNome(""); setNif(""); })} />
      </Cartao>

      <Cartao>
        <Texto forte tamanho={15}>Faturas de saúde</Texto>
        <Texto tamanho={13}>{consentimento
          ? `Deu o seu consentimento a ${dataPT(consentimento.slice(0, 10))} para guardarmos faturas de saúde. Usamo-las só para calcular a dedução.`
          : "Faturas de farmácias, consultas e exames são dados de saúde. Só as guardamos com o seu consentimento expresso."}</Texto>
        <Botao titulo={consentimento ? "Retirar consentimento" : "Dou o meu consentimento"} variante={consentimento ? "secundario" : "principal"} onPress={() => fazer(() => api.casaConsentirSaude(!consentimento))} />
        {consentimento ? <Texto sec tamanho={12}>Se retirar, as faturas de saúde já guardadas ficam até pedir para as anular.</Texto> : null}
      </Cartao>
    </Ecra>
  );
}
