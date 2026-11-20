import { useState } from "react";
import { View } from "react-native";
import { ANO_FISCAL_CASA, NOME_CATEGORIA_CASA, dataPT, euros, type DespesaCasa } from "@contabia/shared";
import { Botao, Campo, Cartao, Chip, Ecra, Erro, Linha, Texto, Titulo, Vazio, useDados, useSessao } from "@contabia/ui";
import { EscolherCategoria } from "../../components/CategoriaCasa";

/** Faturas da casa do ano: mudar a categoria ou anular (nada se apaga). */
export default function FaturasCasa() {
  const { api } = useSessao();
  const { dados, erro, recarregar } = useDados(() => api.casaDespesas(ANO_FISCAL_CASA), []);
  const [aberta, setAberta] = useState<string | null>(null);
  const ativas = dados?.filter((d) => !d.anulada) ?? [];
  const total = ativas.reduce((s, d) => s + d.total, 0);
  return (
    <Ecra>
      <Titulo sub={`${ativas.length} faturas · ${euros(total)} em ${ANO_FISCAL_CASA}`}>Faturas da casa</Titulo>
      <Erro texto={erro} />
      {dados && !dados.length ? <Vazio texto="Ainda não há faturas. Use «Fotografar uma fatura» no painel." /> : null}
      {dados?.map((d) => (
        <Cartao key={d.id} estilo={{ paddingVertical: 4, opacity: d.anulada ? 0.6 : 1 }}>
          <Linha
            esquerda={d.emitente ?? `NIF ${d.nifEmitente}`}
            sub={`${dataPT(d.data)} · ${NOME_CATEGORIA_CASA[d.categoria]}${d.anulada ? " · anulada" : ""}`}
            direita={d.anulada ? <Chip texto="Anulada" /> : <Texto forte>{euros(d.total)}</Texto>}
            onPress={d.anulada ? undefined : () => setAberta(aberta === d.id ? null : d.id)}
          />
          {aberta === d.id ? <Editar despesa={d} feito={() => { setAberta(null); recarregar(); }} /> : null}
        </Cartao>
      ))}
    </Ecra>
  );
}

function Editar({ despesa, feito }: { despesa: DespesaCasa; feito: () => void }) {
  const { api } = useSessao();
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  return (
    <View style={{ gap: 12, paddingVertical: 12 }}>
      <EscolherCategoria valor={despesa.categoria} aoMudar={async (c) => { try { await api.casaAlterarDespesa(despesa.id, { categoria: c }); feito(); } catch (e) { setErro((e as Error).message); } }} />
      <Campo rotulo="Motivo para anular" value={motivo} onChangeText={setMotivo} placeholder="ex.: fatura em duplicado" />
      <Erro texto={erro} />
      <Botao titulo="Anular fatura" variante="perigo" desativado={motivo.trim().length < 3} onPress={async () => { try { await api.casaAnularDespesa(despesa.id, motivo); feito(); } catch (e) { setErro((e as Error).message); } }} />
    </View>
  );
}
