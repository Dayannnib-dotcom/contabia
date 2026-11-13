import { useEffect, useMemo, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import {
  MODELOS_RESPOSTA, gerarResposta, ligacaoEmail, ligacaoWhatsApp, telefoneInternacional,
  type ContextoResposta, type IdResposta,
} from "@contabia/shared";
import { Botao, Campo, Erro, Texto } from "./componentes";
import { Icone } from "./icones";
import { partilhar } from "./partilhar";
import { useSessao } from "./sessao";
import { cor, raio } from "./tema";

const abrir = (url: string) => {
  if (Platform.OS === "web") {
    if (url.startsWith("mailto:")) window.location.href = url;
    else window.open(url, "_blank", "noopener");
  } else void Linking.openURL(url);
};

/**
 * Resposta rápida ao cliente: escolhe-se o modelo, revê-se o texto e um toque abre o WhatsApp
 * ou o e-mail do contabilista com tudo escrito. A mensagem sai do número/e-mail que o cliente já conhece.
 */
export function RespostaRapida({ empresaId, contexto, contacto, modelo = "livre", onFeito, onFechar }: {
  empresaId: string;
  contexto: ContextoResposta;
  contacto: { nome: string | null; telefone: string | null; email: string | null } | null;
  modelo?: IdResposta;
  onFeito?: (canal: "whatsapp" | "email" | "partilha") => void;
  onFechar?: () => void;
}) {
  const { api, sessao } = useSessao();
  // o próximo prazo da empresa entra sozinho nos modelos que falam de prazos
  const [proximo, setProximo] = useState<{ prazo: string; obrigacao: string } | null>(null);
  useEffect(() => {
    let ativo = true;
    if (!contexto.prazo) api.prazos(empresaId).then((ps) => { if (ativo && ps[0]) setProximo({ prazo: ps[0].prazo, obrigacao: ps[0].descricao }); }).catch(() => undefined);
    return () => { ativo = false; };
  }, [api, empresaId, contexto.prazo]);
  const ctx = useMemo<ContextoResposta>(() => ({
    ...contexto,
    prazo: contexto.prazo ?? proximo?.prazo ?? null,
    obrigacao: contexto.obrigacao ?? proximo?.obrigacao ?? null,
    contacto: contexto.contacto ?? contacto?.nome ?? null,
    contabilista: contexto.contabilista ?? sessao?.nome ?? null,
  }), [contexto, contacto, sessao, proximo]);
  const [id, setId] = useState<IdResposta>(modelo);
  const inicial = useMemo(() => gerarResposta(id, ctx), [id, ctx]);
  const [texto, setTexto] = useState(inicial.texto);
  const [assunto, setAssunto] = useState(inicial.assunto);
  const [telefone, setTelefone] = useState(contacto?.telefone ?? "");
  const [novoTel, setNovoTel] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  function escolher(m: IdResposta) {
    const r = gerarResposta(m, ctx);
    setId(m); setTexto(r.texto); setAssunto(r.assunto); setAviso(null);
  }
  async function guardarTelefone() {
    setErro(null);
    if (!telefoneInternacional(novoTel)) return setErro("O telefone não parece válido. Ex.: 912 345 678");
    try { await api.definirContacto(empresaId, { telefone: novoTel }); setTelefone(novoTel); setNovoTel(""); } catch (e) { setErro((e as Error).message); }
  }

  const wa = ligacaoWhatsApp(telefone, texto);
  const mail = ligacaoEmail(contacto?.email, assunto, texto);
  const temMarcador = /\[[a-z ]+\]/i.test(texto);

  return (
    <View style={{ gap: 12, borderTopWidth: 1, borderTopColor: cor.linha, paddingTop: 12 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Texto forte>Responder a {ctx.contacto ?? ctx.empresa}</Texto>
        {onFechar ? <Pressable accessibilityRole="button" accessibilityLabel="Fechar a resposta" onPress={onFechar} hitSlop={10}><Texto forte cor={cor.textoSec}>✕</Texto></Pressable> : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} accessibilityRole="radiogroup" accessibilityLabel="Modelos de resposta">
        {MODELOS_RESPOSTA.map((m) => {
          const on = m.id === id;
          return (
            <Pressable key={m.id} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => escolher(m.id)}
              style={{ paddingVertical: 7, paddingHorizontal: 12, borderRadius: raio.pill, borderWidth: 1.5, borderColor: on ? cor.verde : cor.bordaForte, backgroundColor: on ? cor.verdeClaro : cor.cartao }}>
              <Texto tamanho={13} forte={on} cor={on ? cor.verdeEscuro : cor.texto}>{m.nome}</Texto>
            </Pressable>
          );
        })}
      </ScrollView>
      <TextInput accessibilityLabel="Texto da resposta" multiline value={texto} onChangeText={setTexto}
        style={{ minHeight: 140, borderWidth: 1.5, borderColor: cor.bordaForte, borderRadius: raio.s, padding: 12, fontSize: 15, lineHeight: 22, color: cor.texto, backgroundColor: cor.cartao, textAlignVertical: "top" }} />
      {temMarcador ? <Texto tamanho={12} cor={cor.ambarTexto}>Complete o que está entre [ ] antes de enviar.</Texto> : null}

      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <Botao titulo="WhatsApp" desativado={!wa} estilo={{ flexGrow: 1, backgroundColor: wa ? "#1F8F5A" : undefined }}
          onPress={() => { if (wa) { abrir(wa); onFeito?.("whatsapp"); } }} />
        <Botao titulo="E-mail" variante="secundario" desativado={!mail} estilo={{ flexGrow: 1 }}
          onPress={() => { if (mail) { abrir(mail); onFeito?.("email"); } }} />
        <Botao titulo={Platform.OS === "web" ? "Copiar" : "Partilhar"} variante="secundario" estilo={{ flexGrow: 1 }}
          onPress={async () => { const r = await partilhar(texto, assunto); if (r !== "cancelado") { setAviso(r === "copiado" ? "Texto copiado." : null); onFeito?.("partilha"); } }} />
      </View>
      {aviso ? <Texto tamanho={13} cor={cor.verde}>{aviso}</Texto> : null}

      {!wa ? (
        <View style={{ gap: 8 }}>
          <Texto tamanho={13} cor={cor.textoSec}>Sem telemóvel do cliente. Acrescente-o para responder por WhatsApp:</Texto>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
            <View style={{ flex: 1 }}><Campo rotulo="Telemóvel do cliente" value={novoTel} onChangeText={setNovoTel} keyboardType="phone-pad" placeholder="912 345 678" /></View>
            <Botao titulo="Guardar" variante="secundario" onPress={guardarTelefone} />
          </View>
        </View>
      ) : null}
      {!mail ? <Texto tamanho={12} cor={cor.textoSec}>O cliente ainda não tem e-mail na Contabia.</Texto> : null}
      <Erro texto={erro} />
      <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
        <Icone nome="conversa" cor={cor.textoSec} tamanho={16} />
        <Texto tamanho={12} cor={cor.textoSec}>Abre o seu WhatsApp ou e-mail com a mensagem pronta: revê e carrega em enviar.</Texto>
      </View>
    </View>
  );
}
