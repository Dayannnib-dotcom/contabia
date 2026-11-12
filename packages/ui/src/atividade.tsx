import { View } from "react-native";
import { Cartao, Texto, Vazio } from "./componentes";
import { useDados, useSessao } from "./sessao";
import { cor } from "./tema";

const hora = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** Registo de quem fez o quê (gestor, colaboradores e contabilista). */
export function RegistoAtividade({ empresaId }: { empresaId: string }) {
  const { api } = useSessao();
  const { dados, erro } = useDados(() => api.atividade(empresaId), [empresaId]);
  if (erro) return <Texto sec>{erro}</Texto>;
  if (!dados) return <Texto sec>A carregar…</Texto>;
  if (!dados.length) return <Vazio texto="Ainda sem atividade. Tudo o que for feito nesta empresa aparece aqui, com quem e quando." />;
  return (
    <Cartao estilo={{ paddingVertical: 6 }}>
      {dados.map((a, i) => (
        <View key={i} style={{ flexDirection: "row", gap: 10, paddingVertical: 8, borderBottomWidth: i < dados.length - 1 ? 1 : 0, borderBottomColor: cor.linha }}>
          <Texto sec tamanho={12} estilo={{ width: 78 }}>{hora(a.em)}</Texto>
          <Texto tamanho={13} estilo={{ flex: 1 }}><Texto forte tamanho={13}>{a.quem}</Texto> {a.acao}</Texto>
        </View>
      ))}
    </Cartao>
  );
}
