import { useState } from "react";
import { Pressable, Switch, View } from "react-native";
import { useRouter } from "expo-router";
import { NOME_URGENCIA, type Notificacao } from "@contabia/shared";
import { Botao, Cartao, Chip, Ecra, Erro, LigacaoTermos, MensagemLuis, RespostaRapida, Texto, Titulo, cor, useDados, useSessao } from "@contabia/ui";

const quando = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `há ${m} min`;
  if (m < 60 * 24) return `há ${Math.round(m / 60)} h`;
  return iso.slice(0, 10).split("-").reverse().join("/");
};
const TIPO_CHIP = { alta: "erro", normal: "bom", info: "neutro" } as const;

/** Tudo o que o contabilista precisa de saber, por ordem de urgência, com a resposta pronta. */
export default function Avisos() {
  const { api } = useSessao();
  const router = useRouter();
  const [todas, setTodas] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const { dados, recarregar, erro: erroCarregar } = useDados(() => api.avisos(todas), [todas]);
  const [resumo, setResumo] = useState(true);

  async function lida(ids: string[] | "todas") {
    try { await api.marcarAvisosLidos(ids); await recarregar(); } catch (e) { setErro((e as Error).message); }
  }
  function abrirEmpresa(n: Notificacao) {
    if (!n.abrir) return;
    void lida([n.id]);
    router.push({ pathname: "/empresa/[id]", params: { id: n.abrir.empresaId, ...(n.abrir.separador ? { sec: n.abrir.separador } : {}) } });
  }

  const c = dados?.contagem;
  const lista = dados?.avisos ?? [];
  const luis = !dados ? "A juntar os seus avisos…"
    : !c?.total ? "Está tudo em dia. Aviso-o assim que um cliente precisar de si."
    : `Tem ${c.total} aviso(s) por ler${c.alta ? `, ${c.alta} urgente(s)` : ""}. Cada um traz a resposta pronta para o WhatsApp ou o e-mail.`;

  return (
    <Ecra>
      <Titulo sub="Documentos novos, perguntas, anulações, prazos e pedidos sem resposta — por ordem de urgência.">Avisos</Titulo>
      <MensagemLuis texto={luis} />
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {([[false, `Por ler${c?.total ? ` (${c.total})` : ""}`], [true, "Todos"]] as const).map(([v, t]) => (
          <Pressable key={t} accessibilityRole="tab" accessibilityState={{ selected: todas === v }} onPress={() => setTodas(v)}
            style={{ minHeight: 38, paddingHorizontal: 14, borderRadius: 19, borderWidth: 1, borderColor: todas === v ? cor.tinta : cor.bordaForte, backgroundColor: todas === v ? cor.tinta : "#FFF", justifyContent: "center" }}>
            <Texto forte cor={todas === v ? "#FFF" : cor.texto}>{t}</Texto>
          </Pressable>
        ))}
        {c?.total ? <Botao titulo="Marcar tudo como lido" variante="secundario" onPress={() => lida("todas")} estilo={{ marginLeft: "auto" }} /> : null}
      </View>
      <Erro texto={erro ?? erroCarregar} />

      {lista.map((n) => (
        <Cartao key={n.id} destaque={!n.lida && n.urgencia === "alta"} estilo={{ opacity: n.lida ? 0.7 : 1 }}>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <Chip texto={NOME_URGENCIA[n.urgencia]} tipo={TIPO_CHIP[n.urgencia]} />
            {!n.lida ? <View accessibilityLabel="Por ler" style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: cor.menta }} /> : null}
            <Texto sec tamanho={12} estilo={{ marginLeft: "auto" }}>{quando(n.atualizadaEm)}</Texto>
          </View>
          <Texto forte tamanho={16}>{n.titulo}</Texto>
          <Texto>{n.corpo}</Texto>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {n.contacto ? <Botao titulo={aberto === n.id ? "Fechar resposta" : "Responder"} onPress={() => setAberto(aberto === n.id ? null : n.id)} estilo={{ flexGrow: 1 }} /> : null}
            {n.tipo === "ligacao.pedida" && !n.contacto ? <Botao titulo="Ver o convite" onPress={() => { void lida([n.id]); router.push("/ligar"); }} estilo={{ flexGrow: 1 }} /> : null}
            {n.abrir ? <Botao titulo="Abrir empresa" variante="secundario" onPress={() => abrirEmpresa(n)} estilo={{ flexGrow: 1 }} /> : null}
            {!n.lida ? <Botao titulo="Lido" variante="secundario" onPress={() => lida([n.id])} /> : null}
          </View>
          {aberto === n.id && n.empresaId && n.contacto ? (
            <RespostaRapida empresaId={n.empresaId} contexto={n.resposta?.contexto ?? { empresa: n.empresaNome ?? "" }} contacto={n.contacto}
              modelo={n.resposta?.id ?? "livre"} onFechar={() => setAberto(null)} onFeito={() => void lida([n.id])} />
          ) : null}
        </Cartao>
      ))}

      <Cartao>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Texto forte>Resumo do dia por e-mail, às 9h</Texto>
            <Texto sec tamanho={13}>Só quando há alguma coisa para tratar.</Texto>
          </View>
          <Switch accessibilityLabel="Resumo do dia por e-mail" value={resumo} onValueChange={async (v) => { setResumo(v); try { await api.preferenciasContabilista({ resumoDiario: v }); } catch (e) { setResumo(!v); setErro((e as Error).message); } }}
            trackColor={{ true: cor.verde, false: cor.bordaForte }} />
        </View>
      </Cartao>
      <LigacaoTermos />
    </Ecra>
  );
}
