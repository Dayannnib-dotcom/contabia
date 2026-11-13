import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Regras } from "../../components/Regras";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { euros, motivoLegivel, nomePeriodo, type Lancamento } from "@contabia/shared";
import { Apoios, EspacoServicosVista, useTempoTrabalho, RespostaRapida, Banco, Botao, RegistoAtividade, Campo, Cartao, Chip, Ecra, Erro, Linha, MensagemLuis, Numero, Texto, Titulo, Vazio, VerOriginal, cor, entregarFicheiro, useDados, useSessao } from "@contabia/ui";

type Sec = "servicos" | "revisao" | "banco" | "regras" | "iva" | "pedidos" | "saft" | "fecho" | "atividade" | "apoios";
const SECS: [Sec, string][] = [["revisao", "Revisão"], ["servicos", "Serviços e horas"], ["banco", "Banco"], ["regras", "Regras"], ["iva", "IVA"], ["pedidos", "Pedidos"], ["saft", "SAF-T"], ["fecho", "Fecho"], ["apoios", "Apoios UE"], ["atividade", "Atividade"]];

function mesAnterior(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

export default function EmpresaDetalhe() {
  const { id, sec: secInicial } = useLocalSearchParams<{ id: string; sec?: Sec }>();
  const { api } = useSessao();
  const nav = useNavigation();
  const [sec, setSec] = useState<Sec>(secInicial ?? "revisao");
  const [contactar, setContactar] = useState(false);
  // tempo de trabalho nesta empresa, medido por tarefa (só enquanto o contabilista está ativo)
  const marcar = useTempoTrabalho(id, sec);
  const { dados: resumo } = useDados(async () => {
    const r = await api.resumo(id);
    nav.setOptions({ title: r.empresa.nome });
    return r;
  }, [id]);

  return (
    <Ecra aoInteragir={marcar}>
      <Titulo sub={resumo ? `NIF ${resumo.empresa.nif} · IVA ${resumo.empresa.regimeIVA}` : undefined}>{resumo?.empresa.nome ?? "…"}</Titulo>
      {resumo ? (
        contactar ? (
          <Cartao>
            <RespostaRapida empresaId={id} contexto={{ empresa: resumo.empresa.nome }} onFechar={() => setContactar(false)}
              contacto={{ nome: resumo.empresa.contactoNome ?? null, telefone: resumo.empresa.telefone ?? null, email: resumo.empresa.email ?? null }} />
          </Cartao>
        ) : (
          <Botao titulo={`Contactar ${resumo.empresa.contactoNome?.split(" ")[0] ?? "o cliente"} · WhatsApp ou e-mail`} variante="secundario" onPress={() => setContactar(true)} />
        )
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} accessibilityRole="tablist">
        {SECS.map(([k, t]) => {
          const on = k === sec;
          const badge = k === "revisao" ? resumo?.lancamentosPorRever : k === "pedidos" ? resumo?.pedidosPendentes : 0;
          return (
            <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => setSec(k)}
              style={{ minHeight: 40, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: on ? cor.tinta : cor.bordaForte, backgroundColor: on ? cor.tinta : "#FFF", flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={{ color: on ? "#FFF" : cor.texto, fontWeight: "600" }}>{t}</Text>
              {badge ? <View style={{ minWidth: 20, height: 20, borderRadius: 10, backgroundColor: cor.menta, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 }}><Text style={{ fontSize: 11, fontWeight: "700", color: "#0C1A22" }}>{badge}</Text></View> : null}
            </Pressable>
          );
        })}
      </ScrollView>
      {sec === "revisao" ? <Revisao id={id} irPara={setSec} /> : null}
      {sec === "servicos" ? <EspacoServicosVista empresaId={id} papel="contabilista" /> : null}
      {sec === "regras" ? <Regras empresaId={id} /> : null}
      {sec === "banco" ? <Banco empresaId={id} papel="contabilista" /> : null}
      {sec === "iva" ? <Iva id={id} irPara={setSec} /> : null}
      {sec === "pedidos" ? <Pedidos id={id} /> : null}
      {sec === "saft" ? <Saft id={id} /> : null}
      {sec === "apoios" ? <Apoios empresaId={id} papel="contabilista" /> : null}
      {sec === "atividade" ? <RegistoAtividade empresaId={id} /> : null}
      {sec === "fecho" ? <Fecho id={id} irPara={setSec} /> : null}
    </Ecra>
  );
}

/** Pedidos de anulação feitos pela empresa: só o contabilista decide. */
function Anulacoes({ id, aoMudar }: { id: string; aoMudar: () => void }) {
  const { api } = useSessao();
  const { dados, recarregar } = useDados(async () => (await api.documentos(id)).filter((d) => d.estado === "anulacao_pedida"), [id]);
  const [aTratar, setATratar] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  if (!dados?.length) return null;
  async function decidir(docId: string, aprovar: boolean) {
    setATratar(docId + aprovar);
    setErro(null);
    try {
      if (aprovar) await api.aprovarAnulacao(id, docId); else await api.recusarAnulacao(id, docId);
      await recarregar();
      aoMudar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setATratar(null);
    }
  }
  return (
    <View style={{ gap: 10 }}>
      <Texto forte tamanho={16}>Pedidos de anulação ({dados.length})</Texto>
      <Erro texto={erro} />
      {dados.map((d) => (
        <Cartao key={d.id} destaque>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Texto forte>{d.numero} · {d.terceiroNome}</Texto>
              <Texto sec tamanho={12}>{d.data.split("-").reverse().join("/")} · {euros(d.total)}</Texto>
            </View>
            <Chip texto="Anulação pedida" tipo="aviso" />
          </View>
          <VerOriginal api={api} empresaId={id} documentoId={d.id} />
          {d.anulacao ? <Texto>Motivo da empresa: {motivoLegivel(d.anulacao.motivo)}</Texto> : null}
          <Texto sec tamanho={12}>Ao aprovar, o documento deixa de contar e os lançamentos são estornados com data de hoje. O documento fica guardado.</Texto>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Botao titulo="Manter documento" variante="secundario" onPress={() => decidir(d.id, false)} carregando={aTratar === d.id + "false"} estilo={{ flex: 1 }} />
            <Botao titulo="Aprovar anulação" variante="perigo" onPress={() => decidir(d.id, true)} carregando={aTratar === d.id + "true"} estilo={{ flex: 1 }} />
          </View>
        </Cartao>
      ))}
    </View>
  );
}

function Revisao({ id, irPara }: { id: string; irPara: (s: Sec) => void }) {
  const { api } = useSessao();
  const { dados, recarregar } = useDados(() => api.lancamentos(id, "proposto"), [id]);
  const [editar, setEditar] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [aTratar, setATratar] = useState<string | null>(null);

  async function aprovar(l: Lancamento, conta?: string) {
    setATratar(l.id);
    setErro(null);
    try {
      await api.aprovarLancamento(id, l.id, l.versao, conta);
      setEditar((e) => { const n = { ...e }; delete n[l.id]; return n; });
      await recarregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setATratar(null);
    }
  }

  if (!dados) return <Texto sec>A carregar…</Texto>;
  if (!dados.length) return <View style={{ gap: 12 }}><Anulacoes id={id} aoMudar={recarregar} /><MensagemLuis texto="Todos os lançamentos desta empresa estão revistos." acao={<Botao titulo="Seguir para o IVA" variante="menta" onPress={() => irPara("iva")} estilo={{ alignSelf: "flex-start", minHeight: 40 }} />} /></View>;
  return (
    <View style={{ gap: 12 }}>
      <Anulacoes id={id} aoMudar={recarregar} />
      <Texto sec>Propostos pela IA a partir dos documentos validados pela empresa. Nada é lançado sem a sua aprovação.</Texto>
      <Botao titulo="Aprovar todos com confiança alta" onPress={async () => { const r = await api.aprovarConfiancaAlta(id); setErro(r.aprovados ? null : "Não há lançamentos com confiança alta."); recarregar(); }} />
      <Erro texto={erro} />
      {dados.map((l) => (
        <Cartao key={l.id}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
            <View style={{ flex: 1 }}><Texto forte>{l.descricao}</Texto><Texto sec tamanho={12}>{l.diario} · {l.data.split("-").reverse().join("/")}</Texto></View>
            <Chip texto={l.confianca === "alta" ? "Confiança alta" : "Confiança média"} tipo={l.confianca === "alta" ? "bom" : "aviso"} />
          </View>
          {l.documentoId ? <VerOriginal api={api} empresaId={id} documentoId={l.documentoId} /> : null}
          {l.linhas.map((x, i) => (
            <View key={i} style={{ flexDirection: "row", gap: 8 }}>
              <Text style={{ width: 54, fontVariant: ["tabular-nums"], fontWeight: "600", color: cor.texto }}>{x.conta}</Text>
              <Text style={{ flex: 1, color: cor.textoSec, fontSize: 13 }} numberOfLines={1}>{x.descricao}</Text>
              <Text style={{ width: 90, textAlign: "right", fontVariant: ["tabular-nums"], color: cor.texto }}>{x.debito ? euros(x.debito, false) : ""}</Text>
              <Text style={{ width: 90, textAlign: "right", fontVariant: ["tabular-nums"], color: cor.texto }}>{x.credito ? euros(x.credito, false) : ""}</Text>
            </View>
          ))}
          {editar[l.id] !== undefined ? (
            <View style={{ gap: 8 }}>
              <Campo rotulo="Conta de débito correta" value={editar[l.id]} onChangeText={(v) => setEditar((e) => ({ ...e, [l.id]: v }))} keyboardType="number-pad" />
              <Botao titulo="Guardar e lançar" onPress={() => aprovar(l, editar[l.id])} carregando={aTratar === l.id} desativado={!/^\d{2,8}$/.test(editar[l.id])} />
            </View>
          ) : (
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Botao titulo="Corrigir" variante="secundario" onPress={() => setEditar((e) => ({ ...e, [l.id]: l.linhas[0]?.conta ?? "" }))} estilo={{ flex: 1 }} />
              <Botao titulo="Aprovar" onPress={() => aprovar(l)} carregando={aTratar === l.id} estilo={{ flex: 2 }} />
            </View>
          )}
        </Cartao>
      ))}
    </View>
  );
}

function Iva({ id, irPara }: { id: string; irPara: (s: Sec) => void }) {
  const { api } = useSessao();
  const { dados: prazos } = useDados(() => api.prazos(id), [id]);
  const dp = prazos?.find((p) => p.codigo === "dp_iva");
  const periodo = dp?.periodo;
  const { dados: ap, recarregar } = useDados(async () => (periodo ? api.apuramento(id, periodo) : null), [id, periodo]);
  const [ficheiro, setFicheiro] = useState<{ nome: string; xml: string } | null>(null);
  const [comp, setComp] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [aEnviar, setAEnviar] = useState(false);

  if (!dp || !ap) return <Texto sec>A carregar…</Texto>;
  if (dp.submetida) return <MensagemLuis texto={`A declaração de ${nomePeriodo(dp.periodo)} já está submetida e registada.`} acao={<Botao titulo="Ir para o fecho" variante="menta" onPress={() => irPara("fecho")} estilo={{ alignSelf: "flex-start", minHeight: 40 }} />} />;
  return (
    <View style={{ gap: 12 }}>
      <Cartao>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Texto forte tamanho={16}>IVA · {nomePeriodo(ap.periodo)}</Texto>
          <Chip texto={`Até ${dp.prazo.split("-").reverse().join("/")}`} tipo="aviso" />
        </View>
        {ap.campos.length === 0 ? <Vazio texto="Sem movimentos lançados neste período." /> : null}
        {ap.campos.map((c) => (
          <Linha key={c.campo} esquerda={<Text style={{ color: cor.texto }}><Text style={{ fontWeight: "700", fontVariant: ["tabular-nums"] }}>{c.campo}  </Text>{c.descricao}</Text>} direita={<Numero forte={false}>{euros(c.valor, false)}</Numero>} />
        ))}
        <Linha esquerda={<Text style={{ fontWeight: "700", color: cor.texto }}>{ap.resultado.campo}  {ap.resultado.descricao}</Text>} direita={<Numero tamanho={17}>{euros(ap.resultado.valor)}</Numero>} />
      </Cartao>
      {ap.lancamentosPendentes ? (
        <Cartao estilo={{ backgroundColor: cor.ambar, borderColor: cor.ambar }}>
          <Texto cor={cor.ambarTexto}>Há {ap.lancamentosPendentes} lançamentos por rever. Reveja-os antes de gerar a declaração.</Texto>
          <Botao titulo="Rever agora" variante="secundario" onPress={() => irPara("revisao")} />
        </Cartao>
      ) : !ficheiro ? (
        <Botao titulo="1. Gerar ficheiro da declaração" onPress={async () => { try { setFicheiro(await api.ficheiroDP(id, ap.periodo)); } catch (e) { setErro((e as Error).message); } }} />
      ) : (
        <Cartao>
          <Chip texto={ficheiro.nome} tipo="bom" />
          <Botao titulo="Descarregar / partilhar ficheiro" variante="secundario" onPress={() => entregarFicheiro(ficheiro.nome, ficheiro.xml)} />
          <Texto>2. Submeta-o no Portal das Finanças e registe aqui o comprovativo.</Texto>
          <Campo rotulo="N.º do comprovativo de entrega" value={comp} onChangeText={setComp} />
          <Botao titulo="Registar submissão" carregando={aEnviar} desativado={comp.length < 3}
            onPress={async () => { setAEnviar(true); try { await api.registarSubmissao(id, ap.periodo, comp); await recarregar(); } catch (e) { setErro((e as Error).message); } finally { setAEnviar(false); } }} />
        </Cartao>
      )}
      <Erro texto={erro} />
      <Texto sec tamanho={12}>A submissão é feita por si, com as suas credenciais. A Contabia prepara o ficheiro e guarda o comprovativo.</Texto>
    </View>
  );
}

const TIPOS_PEDIDO = ["Extrato bancário", "Fatura em falta", "Contrato", "Outro"];

function Pedidos({ id }: { id: string }) {
  const { api } = useSessao();
  const { dados, recarregar } = useDados(() => api.pedidos(id), [id]);
  const [tipo, setTipo] = useState(TIPOS_PEDIDO[0]);
  const [detalhe, setDetalhe] = useState("");
  const [aEnviar, setAEnviar] = useState(false);
  return (
    <View style={{ gap: 12 }}>
      <Cartao>
        <Texto forte tamanho={16}>Novo pedido à empresa</Texto>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {TIPOS_PEDIDO.map((t) => (
            <Pressable key={t} accessibilityRole="radio" accessibilityState={{ checked: t === tipo }} onPress={() => setTipo(t)}
              style={{ minHeight: 38, paddingHorizontal: 14, borderRadius: 19, borderWidth: 1, borderColor: t === tipo ? cor.verde : cor.bordaForte, backgroundColor: t === tipo ? cor.verdeClaro : "#FFF", justifyContent: "center" }}>
              <Text style={{ fontWeight: "600", color: t === tipo ? cor.verdeEscuro : cor.texto }}>{t}</Text>
            </Pressable>
          ))}
        </View>
        <Campo rotulo="Detalhe" value={detalhe} onChangeText={setDetalhe} placeholder="ex.: extrato do banco de outubro" />
        <Botao titulo="Enviar pedido" carregando={aEnviar} onPress={async () => { setAEnviar(true); try { await api.criarPedido(id, tipo, detalhe); setDetalhe(""); await recarregar(); } finally { setAEnviar(false); } }} />
        <Texto sec tamanho={12}>O Luís entrega o pedido na app da empresa e lembra-a até estar resolvido.</Texto>
      </Cartao>
      <Cartao estilo={{ paddingVertical: 4 }}>
        {dados?.length === 0 ? <Vazio texto="Sem pedidos." /> : null}
        {dados?.map((p) => (
          <Linha key={p.id} esquerda={p.tipo} sub={p.detalhe || undefined}
            direita={p.estado === "pendente" ? <Botao titulo="Recebido" variante="secundario" onPress={async () => { await api.marcarRecebido(id, p.id); recarregar(); }} estilo={{ minHeight: 38 }} /> : <Chip texto="Recebido" tipo="bom" />} />
        ))}
      </Cartao>
    </View>
  );
}

function Saft({ id }: { id: string }) {
  const { api } = useSessao();
  const ano = new Date().getFullYear();
  const [r, setR] = useState<{ nome: string; xml: string; avisos: string[] } | null>(null);
  const [aGerar, setAGerar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  return (
    <View style={{ gap: 12 }}>
      <Cartao>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}><Texto forte tamanho={16}>SAF-T de faturação</Texto><Chip texto="Envio automático" tipo="bom" /></View>
        <Texto sec>Comunicado até ao dia 5 de cada mês; hash, ATCUD e QR verificados em cada documento.</Texto>
      </Cartao>
      <Cartao>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}><Texto forte tamanho={16}>SAF-T da contabilidade {ano}</Texto><Chip texto="Preparação" tipo="aviso" /></View>
        <Texto sec>Estrutura 1.04_01 (Portaria n.º 302/2016). Gere um ficheiro de teste para validar antes de ser obrigatório.</Texto>
        <Botao titulo="Gerar e validar ficheiro" carregando={aGerar} onPress={async () => { setAGerar(true); setErro(null); try { setR(await api.gerarSAFT(id, ano)); } catch (e) { setErro((e as Error).message); } finally { setAGerar(false); } }} />
        <Erro texto={erro} />
        {r ? (
          <View style={{ gap: 8 }}>
            <Chip texto={r.nome} tipo="bom" />
            {r.avisos.length ? r.avisos.map((a) => <Texto key={a} cor={cor.ambarTexto} tamanho={13}>! {a}</Texto>) : <Texto cor={cor.verdeEscuro}>✓ Sem avisos</Texto>}
            <Botao titulo="Descarregar / partilhar ficheiro" variante="secundario" onPress={() => entregarFicheiro(r.nome, r.xml)} />
          </View>
        ) : null}
      </Cartao>
    </View>
  );
}

function Fecho({ id, irPara }: { id: string; irPara: (s: Sec) => void }) {
  const { api } = useSessao();
  const periodo = mesAnterior();
  const { dados, recarregar } = useDados(() => api.verificarFecho(id, periodo), [id, periodo]);
  const [erro, setErro] = useState<string | null>(null);
  const destino: Record<string, Sec | undefined> = { lancamentos: "revisao", pedidos: "pedidos", iva: "iva" };
  if (!dados) return <Texto sec>A carregar…</Texto>;
  return (
    <Cartao>
      <Texto forte tamanho={16}>Fecho de {nomePeriodo(periodo)}</Texto>
      {dados.passos.map((p) => (
        <Linha key={p.codigo}
          esquerda={<View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}><View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: p.ok ? cor.verdeClaro : cor.ambar, alignItems: "center", justifyContent: "center" }}><Text style={{ fontWeight: "700", color: p.ok ? cor.verdeEscuro : cor.ambarTexto }}>{p.ok ? "✓" : "!"}</Text></View><Text style={{ flex: 1, color: cor.texto }}>{p.descricao}</Text></View>}
          direita={!p.ok && destino[p.codigo] ? <Botao titulo="Resolver" variante="secundario" onPress={() => irPara(destino[p.codigo]!)} estilo={{ minHeight: 38 }} /> : undefined} />
      ))}
      <Erro texto={erro} />
      {dados.fechado ? (
        <MensagemLuis texto={`${nomePeriodo(periodo)} está fechado. Os lançamentos ficam bloqueados e a empresa foi avisada.`} />
      ) : (
        <Botao titulo={`Fechar ${nomePeriodo(periodo)}`} desativado={!dados.podeFechar}
          onPress={async () => { try { await api.fecharPeriodo(id, periodo); recarregar(); } catch (e) { setErro((e as Error).message); } }} />
      )}
      {!dados.podeFechar && !dados.fechado ? <Texto sec tamanho={12}>Resolva os passos assinalados para poder fechar o período.</Texto> : null}
    </Cartao>
  );
}
