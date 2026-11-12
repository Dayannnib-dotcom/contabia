import { useState } from "react";
import { Linking, Platform, Pressable, View } from "react-native";
import {
  DIMENSOES, erroCAE, normalizarCAE, seccaoDoCAE, URL_SICAE,
  type ApoioCompativel, type Dimensao, type PedidoEstudo,
} from "@contabia/shared";
import { Botao, Campo, Cartao, Chip, Erro, MensagemLuis, Texto } from "./componentes";
import { useDados, useSessao } from "./sessao";
import { cor, raio } from "./tema";

const abrir = (url: string) => (Platform.OS === "web" ? void window.open(url, "_blank", "noopener") : void Linking.openURL(url));
const dataPT = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const ESTADO_ESTUDO: Record<PedidoEstudo["estado"], string> = { recebido: "Recebido", em_contacto: "Em contacto", concluido: "Concluído" };

function prazo(a: ApoioCompativel) {
  if (a.apoio.estado === "previsto") return { texto: "Previsto", tipo: "neutro" as const };
  if (a.diasParaFim === null) return { texto: "Aberto", tipo: "bom" as const };
  const d = a.diasParaFim;
  return { texto: d <= 0 ? `Fecha hoje às ${a.apoio.fim!.slice(11, 16)}` : `Aberto · ${d === 1 ? "falta 1 dia" : `faltam ${d} dias`}`, tipo: d <= 10 ? ("aviso" as const) : ("bom" as const) };
}

/**
 * Apoios europeus pelo CAE da empresa e pedido de estudo de viabilidade económica.
 * A empresa (gestor) e o contabilista indicam o CAE; só a empresa pede o estudo.
 */
export function Apoios({ empresaId, papel }: { empresaId: string; papel: "empresa" | "contabilista" }) {
  const { api, sessao } = useSessao();
  const { dados, erro: erroCarregar, recarregar } = useDados(async () => {
    const [a, estudos] = await Promise.all([api.apoios(empresaId), api.estudos(empresaId)]);
    return { ...a, estudos };
  }, [empresaId]);
  const podeEditar = papel === "contabilista" || sessao?.perfil !== "colaborador";
  const [editar, setEditar] = useState(false);
  const [cae, setCae] = useState("");
  const [secundarios, setSecundarios] = useState("");
  const [dimensao, setDimensao] = useState<Dimensao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aGuardar, setAGuardar] = useState(false);
  const [pedirPara, setPedirPara] = useState<string | null | undefined>(undefined); // undefined = formulário fechado; null = estudo geral
  const [enviado, setEnviado] = useState<string | null>(null);

  const perfil = dados?.perfil;
  const mostrarFormulario = podeEditar && (editar || (perfil && !perfil.cae));

  function comecarEdicao() {
    setCae(perfil?.cae ?? "");
    setSecundarios((perfil?.caesSecundarios ?? []).join(", "));
    setDimensao(perfil?.dimensao ?? null);
    setErro(null);
    setEditar(true);
  }

  async function guardar() {
    setErro(null);
    const principal = normalizarCAE(cae || perfil?.cae || "");
    const outros = secundarios.split(/[,;\s]+/).map(normalizarCAE).filter(Boolean);
    const mau = erroCAE(principal) ?? outros.map((c) => erroCAE(c) && `CAE secundário ${c}: ${erroCAE(c)}`).find(Boolean) ?? null;
    if (mau) return setErro(mau);
    setAGuardar(true);
    try {
      await api.definirPerfilApoios(empresaId, { cae: principal, caesSecundarios: outros, dimensao: dimensao ?? perfil?.dimensao ?? null });
      setEditar(false);
      await recarregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setAGuardar(false);
    }
  }

  const s = perfil?.cae ? seccaoDoCAE(perfil.cae) : undefined;
  const dimEscolhida = dimensao ?? (editar ? null : perfil?.dimensao ?? null);
  const apoios = dados?.apoios ?? [];
  const abertos = apoios.filter((a) => a.apoio.estado === "aberto");

  const luis = !dados ? "A procurar avisos para a sua empresa…"
    : !perfil?.cae ? "Diga-me o CAE da empresa e eu procuro os apoios europeus a que se pode candidatar. Atualizo a lista sempre que abre um aviso novo."
    : abertos.length ? `Encontrei ${abertos.length === 1 ? "1 aviso aberto" : `${abertos.length} avisos abertos`} que podem servir à ${papel === "empresa" ? "sua empresa" : "empresa"}${apoios.length > abertos.length ? ` e ${apoios.length - abertos.length} previsto${apoios.length - abertos.length === 1 ? "" : "s"}` : ""}.${papel === "empresa" ? " Se quiser avançar, pedimos-lhe um estudo de viabilidade económica." : ""}`
    : apoios.length ? "Não há avisos abertos para esta atividade agora, mas há avisos previstos. Aviso-o quando abrirem."
    : "Neste momento não encontrei avisos abertos para esta atividade e região. Continuo atento.";

  return (
    <View style={{ gap: 12 }}>
      <MensagemLuis texto={luis} />
      <Erro texto={erroCarregar} />

      <Cartao>
        <Texto forte tamanho={15}>Atividade da empresa</Texto>
        {mostrarFormulario ? (
          <View style={{ gap: 12 }}>
            <Campo rotulo="CAE principal" placeholder="5 algarismos" keyboardType="number-pad" maxLength={7} value={cae} onChangeText={setCae}
              ajuda="5 algarismos (CAE Rev. 4, em vigor desde 2025)." />
            <Campo rotulo="CAE secundários (opcional)" placeholder="Ex.: 47250, 56301" value={secundarios} onChangeText={setSecundarios} ajuda="Separe por vírgulas. Um CAE secundário também pode dar acesso a apoios." />
            <View style={{ gap: 6 }}>
              <Texto forte tamanho={13}>Dimensão da empresa</Texto>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {DIMENSOES.map((d) => {
                  const on = dimEscolhida === d.id;
                  return (
                    <Pressable key={d.id} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`${d.nome}: ${d.ajuda}`} onPress={() => setDimensao(d.id)}
                      style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: raio.pill, borderWidth: 1.5, borderColor: on ? cor.verde : cor.bordaForte, backgroundColor: on ? cor.verdeClaro : cor.cartao }}>
                      <Texto forte={on} cor={on ? cor.verdeEscuro : cor.texto} tamanho={14}>{d.nome}</Texto>
                    </Pressable>
                  );
                })}
              </View>
              <Texto sec tamanho={12}>{DIMENSOES.find((d) => d.id === dimEscolhida)?.ajuda ?? "Muitos avisos são só para PME (micro, pequenas e médias)."}</Texto>
            </View>
            <Pressable accessibilityRole="link" onPress={() => abrir(URL_SICAE)}>
              <Texto tamanho={13} cor={cor.verde}>Não sabe o CAE? Está na certidão permanente ou pode confirmá-lo pelo NIF em sicae.pt ›</Texto>
            </Pressable>
            <Erro texto={erro} />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Botao titulo="Procurar apoios" onPress={guardar} carregando={aGuardar} estilo={{ flexGrow: 1 }} />
              {editar && perfil?.cae ? <Botao titulo="Cancelar" variante="secundario" onPress={() => setEditar(false)} /> : null}
            </View>
          </View>
        ) : perfil?.cae ? (
          <View style={{ gap: 6 }}>
            <Texto>CAE {perfil.cae}{s ? ` · ${s.nome}` : ""}</Texto>
            {perfil.caesSecundarios.length ? <Texto sec tamanho={13}>Secundários: {perfil.caesSecundarios.join(", ")}</Texto> : null}
            <Texto sec tamanho={13}>{perfil.dimensao ? `Empresa ${DIMENSOES.find((d) => d.id === perfil.dimensao)!.nome.toLowerCase()}` : "Dimensão por indicar"} · {({ PT: "Continente", "PT-MA": "Madeira", "PT-AC": "Açores" } as const)[perfil.regiao]}</Texto>
            {podeEditar ? (
              <Pressable accessibilityRole="button" onPress={comecarEdicao}><Texto forte tamanho={13} cor={cor.verde}>Alterar CAE ou dimensão ›</Texto></Pressable>
            ) : null}
          </View>
        ) : (
          <Texto sec>O gestor da empresa ainda não indicou o CAE.</Texto>
        )}
      </Cartao>

      {perfil?.cae && apoios.length ? <Texto forte tamanho={15}>Apoios que podem servir</Texto> : null}
      {(perfil?.cae ? apoios : []).map((a) => {
        const p = prazo(a);
        return (
          <Cartao key={a.apoio.id} destaque={a.apoio.estado === "aberto" && a.compatibilidade === "provavel"}>
            <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
              <Chip texto={p.texto} tipo={p.tipo} />
              <Chip texto={a.compatibilidade === "provavel" ? "Compatível" : "A confirmar"} tipo={a.compatibilidade === "provavel" ? "bom" : "aviso"} />
            </View>
            <Texto forte tamanho={16}>{a.apoio.nome}</Texto>
            <Texto sec tamanho={12}>{a.apoio.programa} · {a.apoio.codigo}{a.apoio.fim ? ` · até ${dataPT(a.apoio.fim)} ${a.apoio.fim.slice(11, 16)}` : ""}</Texto>
            <Texto>{a.apoio.resumo}</Texto>
            {a.apoio.apoio ? <Texto forte tamanho={13}>{a.apoio.apoio}</Texto> : null}
            <View style={{ gap: 4, backgroundColor: cor.linha, borderRadius: raio.s, padding: 10 }}>
              <Texto forte tamanho={12}>Porque aparece</Texto>
              {a.motivos.map((m) => <Texto key={m} tamanho={13}>• {m}</Texto>)}
              {a.apoio.nota ? <Texto sec tamanho={12}>{a.apoio.nota}</Texto> : null}
            </View>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              {papel === "empresa" ? <Botao titulo="Pedir estudo de viabilidade" onPress={() => { setEnviado(null); setPedirPara(a.apoio.id); }} estilo={{ flexGrow: 1 }} /> : null}
              <Botao titulo="Ver aviso oficial" variante="secundario" onPress={() => abrir(a.apoio.ligacao)} estilo={{ flexGrow: 1 }} />
            </View>
            {pedirPara === a.apoio.id ? <PedidoEstudoForm empresaId={empresaId} apoioId={a.apoio.id} apoioNome={a.apoio.nome} onFechar={() => setPedirPara(undefined)} onEnviado={async (m) => { setPedirPara(undefined); setEnviado(m); await recarregar(); }} /> : null}
          </Cartao>
        );
      })}

      {enviado ? <MensagemLuis texto={enviado} /> : null}

      {papel === "empresa" ? (
        <Cartao>
          <Texto forte tamanho={15}>Estudo de viabilidade económica</Texto>
          <Texto sec>Antes de investir ou de se candidatar, a nossa equipa analisa se o projeto se paga: investimento, receitas, custos, financiamento e o apoio possível. Explicamos o âmbito e o orçamento antes de começar.</Texto>
          {pedirPara === null ? (
            <PedidoEstudoForm empresaId={empresaId} apoioId={null} onFechar={() => setPedirPara(undefined)} onEnviado={async (m) => { setPedirPara(undefined); setEnviado(m); await recarregar(); }} />
          ) : (
            <Botao titulo="Pedir um estudo" variante="secundario" onPress={() => { setEnviado(null); setPedirPara(null); }} />
          )}
        </Cartao>
      ) : null}

      {dados?.estudos.length ? (
        <Cartao>
          <Texto forte tamanho={15}>{papel === "empresa" ? "Os seus pedidos de estudo" : "Estudos pedidos pela empresa"}</Texto>
          {dados.estudos.map((e) => (
            <View key={e.id} style={{ flexDirection: "row", justifyContent: "space-between", gap: 8, paddingVertical: 6, borderTopWidth: 1, borderTopColor: cor.linha }}>
              <View style={{ flex: 1 }}>
                <Texto tamanho={14}>{e.apoioNome ?? "Estudo geral"}</Texto>
                <Texto sec tamanho={12}>{dataPT(e.criadoEm)} · {e.nome}</Texto>
              </View>
              <Chip texto={ESTADO_ESTUDO[e.estado]} tipo={e.estado === "concluido" ? "bom" : "neutro"} />
            </View>
          ))}
        </Cartao>
      ) : null}

      {dados ? (
        <Texto sec tamanho={12}>
          Informação indicativa, verificada a {dataPT(dados.verificadoEm)} nos sites oficiais dos programas. A elegibilidade final depende das regras de cada aviso e da análise da candidatura; confirme sempre no aviso oficial.
        </Texto>
      ) : null}
    </View>
  );
}

function PedidoEstudoForm({ empresaId, apoioId, apoioNome, onFechar, onEnviado }: {
  empresaId: string; apoioId: string | null; apoioNome?: string; onFechar: () => void; onEnviado: (mensagem: string) => void;
}) {
  const { api, sessao } = useSessao();
  const [nome, setNome] = useState(sessao?.quem ?? "");
  const [email, setEmail] = useState("");
  const [telefone, setTelefone] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [autorizo, setAutorizo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aEnviar, setAEnviar] = useState(false);

  async function enviar() {
    setErro(null);
    if (nome.trim().length < 2) return setErro("Indique o nome de quem devemos contactar.");
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setErro("O e-mail não parece válido.");
    if (!autorizo) return setErro("Para lhe ligarmos, autorize o contacto.");
    setAEnviar(true);
    try {
      await api.pedirEstudo(empresaId, { apoioId, nome: nome.trim(), email: email.trim(), telefone: telefone.trim() || undefined, mensagem: mensagem.trim() || undefined, autorizoContacto: true });
      onEnviado(`Pedido recebido${apoioNome ? ` para «${apoioNome}»` : ""}. A nossa equipa de estudos vai contactá-lo por e-mail${telefone.trim() ? " ou telefone" : ""}.`);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setAEnviar(false);
    }
  }

  return (
    <View style={{ gap: 10, borderTopWidth: 1, borderTopColor: cor.linha, paddingTop: 12 }}>
      <Texto forte>{apoioNome ? "Pedir estudo para este aviso" : "Pedir um estudo"}</Texto>
      <Campo rotulo="Nome para contacto" value={nome} onChangeText={setNome} autoComplete="name" />
      <Campo rotulo="E-mail para contacto" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
      <Campo rotulo="Telefone (opcional)" value={telefone} onChangeText={setTelefone} keyboardType="phone-pad" autoComplete="tel" />
      <Campo rotulo="O que quer fazer? (opcional)" value={mensagem} onChangeText={setMensagem} multiline numberOfLines={3} placeholder="Ex.: renovar a cozinha do restaurante e abrir uma esplanada" style={{ minHeight: 80, textAlignVertical: "top" }} />
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: autorizo }} onPress={() => { setAutorizo((v) => !v); setErro(null); }} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
        <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: autorizo ? cor.verde : cor.bordaForte, backgroundColor: autorizo ? cor.verde : cor.cartao, alignItems: "center", justifyContent: "center" }}>
          {autorizo ? <Texto forte cor="#FFFFFF" tamanho={14}>✓</Texto> : null}
        </View>
        <Texto tamanho={13} estilo={{ flex: 1 }}>Autorizo a Contabia a contactar-me sobre este estudo e a usar os dados da empresa (CAE, região, dimensão) para o preparar.</Texto>
      </Pressable>
      <Erro texto={erro} />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Botao titulo="Enviar pedido" onPress={enviar} carregando={aEnviar} estilo={{ flexGrow: 1 }} />
        <Botao titulo="Cancelar" variante="secundario" onPress={onFechar} />
      </View>
    </View>
  );
}
