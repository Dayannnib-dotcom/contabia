import { useMemo, useState } from "react";
import { Pressable, Switch, View } from "react-native";
import { formatarNIF } from "@contabia/shared";
import { Botao, Campo, Cartao, Chip, Erro, Texto, cor, useDados, useSessao } from "@contabia/ui";

/** Regras do contabilista por fornecedor: conta SNC, IVA e lançamento automático. */
export function Regras({ empresaId }: { empresaId: string }) {
  const { api } = useSessao();
  const { dados, recarregar } = useDados(async () => {
    const [regras, docs] = await Promise.all([api.regrasFornecedor(empresaId), api.documentos(empresaId)]);
    // fornecedores mais frequentes sem regra, para sugerir
    const contagem = new Map<string, { nif: string; nome: string; conta: string; dedutivel: boolean; n: number }>();
    for (const d of docs) {
      if (d.tipo === "venda" || d.estado === "anulado") continue;
      const c = contagem.get(d.terceiroNif) ?? { nif: d.terceiroNif, nome: d.terceiroNome, conta: d.contaSugerida, dedutivel: d.ivaDedutivel, n: 0 };
      c.n++;
      contagem.set(d.terceiroNif, c);
    }
    const comRegra = new Set(regras.map((r) => r.nif));
    return { regras, sugestoes: [...contagem.values()].filter((c) => !comRegra.has(c.nif)).sort((a, b) => b.n - a.n).slice(0, 6) };
  }, [empresaId]);
  const [editar, setEditar] = useState<{ nif: string; nome: string; conta: string; ivaDedutivel: boolean; autoLancar: boolean } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const regras = useMemo(() => dados?.regras ?? [], [dados]);

  async function guardar() {
    if (!editar) return;
    setOcupado(true);
    setErro(null);
    try {
      await api.guardarRegraFornecedor(empresaId, editar.nif, editar);
      setEditar(null);
      await recarregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  if (editar) {
    return (
      <Cartao>
        <Texto forte tamanho={16}>Regra para {editar.nome}</Texto>
        <Texto sec tamanho={12}>NIF {formatarNIF(editar.nif)}. Aplica-se a todas as faturas deste fornecedor, incluindo as que estão por validar.</Texto>
        <Campo rotulo="Conta SNC" value={editar.conta} onChangeText={(v) => setEditar({ ...editar, conta: v })} keyboardType="number-pad" ajuda="ex.: 62421 combustíveis, 6223 rendas, 6262 comunicação" />
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Texto forte>IVA dedutível</Texto>
          <Switch value={editar.ivaDedutivel} onValueChange={(v) => setEditar({ ...editar, ivaDedutivel: v })} trackColor={{ true: cor.verde }} accessibilityLabel="IVA dedutível" />
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Texto forte>Lançar automaticamente</Texto>
            <Texto sec tamanho={12}>Quando a empresa valida a fatura, fica lançada sem passar pela revisão.</Texto>
          </View>
          <Switch value={editar.autoLancar} onValueChange={(v) => setEditar({ ...editar, autoLancar: v })} trackColor={{ true: cor.verde }} accessibilityLabel="Lançar automaticamente" />
        </View>
        <Erro texto={erro} />
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Botao titulo="Cancelar" variante="secundario" onPress={() => { setEditar(null); setErro(null); }} estilo={{ flex: 1 }} />
          <Botao titulo="Guardar regra" onPress={guardar} carregando={ocupado} desativado={!/^\d{2,8}$/.test(editar.conta)} estilo={{ flex: 2 }} />
        </View>
      </Cartao>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      <Texto sec>Defina como se classificam as faturas de cada fornecedor. A sua regra manda sobre a sugestão da IA e sobre a escolha da empresa.</Texto>
      <Erro texto={erro} />
      {regras.map((r) => (
        <Cartao key={r.nif}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
            <View style={{ flex: 1 }}><Texto forte>{r.nome}</Texto><Texto sec tamanho={12}>{r.conta} {r.categoria} · IVA {r.ivaDedutivel ? "dedutível" : "não dedutível"}</Texto></View>
            {r.autoLancar ? <Chip texto="Lança sozinho" tipo="bom" /> : <Chip texto="Com revisão" />}
          </View>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Botao titulo="Alterar" variante="secundario" onPress={() => setEditar({ nif: r.nif, nome: r.nome, conta: r.conta, ivaDedutivel: r.ivaDedutivel, autoLancar: r.autoLancar })} estilo={{ flex: 1 }} />
            <Botao titulo="Remover" variante="secundario" onPress={async () => { try { await api.removerRegraFornecedor(empresaId, r.nif); await recarregar(); } catch (e) { setErro((e as Error).message); } }} estilo={{ flex: 1 }} />
          </View>
        </Cartao>
      ))}
      {dados?.sugestoes.length ? <Texto forte tamanho={15}>Fornecedores frequentes sem regra</Texto> : null}
      {dados?.sugestoes.map((c) => (
        <Pressable key={c.nif} accessibilityRole="button" accessibilityLabel={`Criar regra para ${c.nome}`}
          onPress={() => setEditar({ nif: c.nif, nome: c.nome, conta: c.conta, ivaDedutivel: c.dedutivel, autoLancar: false })}>
          <Cartao>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
              <View style={{ flex: 1 }}><Texto forte>{c.nome}</Texto><Texto sec tamanho={12}>{c.n} {c.n === 1 ? "fatura" : "faturas"} · hoje sugerido {c.conta}</Texto></View>
              <Texto forte cor={cor.verde}>Criar regra ›</Texto>
            </View>
          </Cartao>
        </Pressable>
      ))}
      {dados && !regras.length && !dados.sugestoes.length ? <Texto sec>Ainda não há faturas de fornecedores nesta empresa.</Texto> : null}
    </View>
  );
}
