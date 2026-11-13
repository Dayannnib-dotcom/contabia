import { useState } from "react";
import { Switch, View } from "react-native";
import { formatarNIF } from "@contabia/shared";
import { Botao, Campo, Cartao, Ecra, Erro, Linha, MensagemLuis, Texto, Titulo, confirmarBiometria, cor, useDados, useSessao } from "@contabia/ui";

/**
 * Conta e segurança. Terminar a sessão NUNCA apaga dados: tudo vive na nuvem.
 * O botão fica aqui, longe do painel, e pede dupla confirmação para não ser tocado sem querer.
 */
export default function Conta() {
  const { api, sessao, sair } = useSessao();
  const { dados } = useDados(async () => {
    const [eu, docs, ligs] = await Promise.all([api.eu(), api.documentos(sessao!.id), api.ligacoes()]);
    return { empresa: eu.empresa!, docs: docs.length, cc: ligs.find((l) => l.estado === "ativa")?.contabilista?.nome };
  }, [sessao!.id]);
  const [passo, setPasso] = useState<0 | 1>(0);
  const [email, setEmail] = useState("");
  const [erroEmail, setErroEmail] = useState<string | null>(null);
  const [emailGuardado, setEmailGuardado] = useState<string | null>(null);
  const gestor = sessao!.perfil !== "colaborador";
  const [tel, setTel] = useState<string | null>(null);
  const [nomeContacto, setNomeContacto] = useState<string | null>(null);
  const [erroContacto, setErroContacto] = useState<string | null>(null);
  const [contactoOk, setContactoOk] = useState(false);
  const [dicas, setDicas] = useState<boolean | null>(null);
  const [wa, setWa] = useState<boolean | null>(null);
  const [erroWa, setErroWa] = useState<string | null>(null);
  async function guardarContacto() {
    setErroContacto(null); setContactoOk(false);
    try {
      await api.definirContacto(sessao!.id, { telefone: tel ?? dados?.empresa.telefone ?? null, contactoNome: nomeContacto ?? dados?.empresa.contactoNome ?? null });
      setContactoOk(true);
    } catch (e) { setErroContacto((e as Error).message); }
  }
  async function guardarEmail() {
    setErroEmail(null);
    try { setEmailGuardado((await api.definirEmail(email)).email ?? email); setEmail(""); } catch (e) { setErroEmail((e as Error).message); }
  }

  async function terminar() {
    if (!(await confirmarBiometria("Confirmar saída deste dispositivo"))) return;
    await sair(); // os ecrãs com sessão fecham-se sozinhos e volta-se à entrada
  }

  return (
    <Ecra>
      <Titulo sub="Tudo o que carrega fica guardado na nuvem da Contabia, não no telemóvel.">Conta e segurança</Titulo>
      {dados ? (
        <Cartao estilo={{ paddingVertical: 4 }}>
          <Linha esquerda="Empresa" direita={<Texto>{dados.empresa.nome}</Texto>} />
          <Linha esquerda="Utilizador" direita={<Texto>{dados.empresa.utilizador}</Texto>} />
          <Linha esquerda="NIF" direita={<Texto>{formatarNIF(dados.empresa.nif)}</Texto>} />
          <Linha esquerda="Documentos na nuvem" direita={<Texto forte>{String(dados.docs)}</Texto>} />
          <Linha esquerda="Contabilista" direita={<Texto>{dados.cc ?? "—"}</Texto>} />
        </Cartao>
      ) : null}

      {gestor && dados ? (
        <Cartao>
          <Texto forte tamanho={15}>E-mail para recuperar a senha</Texto>
          {emailGuardado ?? dados.empresa.email ? (
            <Texto>{emailGuardado ?? dados.empresa.email}</Texto>
          ) : (
            <Texto tamanho={13} cor={cor.ambarTexto}>Ainda não tem e-mail: se esquecer a senha, não a poderá recuperar.</Texto>
          )}
          <Campo rotulo={dados.empresa.email || emailGuardado ? "Mudar o e-mail" : "E-mail do gestor"} value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" />
          <Erro texto={erroEmail} />
          <Botao titulo="Guardar e-mail" variante="secundario" onPress={guardarEmail} desativado={!/^\S+@\S+\.\S+$/.test(email.trim())} />
        </Cartao>
      ) : null}

      {gestor && dados ? (
        <Cartao>
          <Texto forte tamanho={15}>Contacto para o seu contabilista</Texto>
          <Texto sec tamanho={13}>Com o telemóvel, o contabilista responde-lhe pelo WhatsApp num toque.</Texto>
          <Campo rotulo="Nome de quem trata das contas" value={nomeContacto ?? dados.empresa.contactoNome ?? ""} onChangeText={(v) => { setNomeContacto(v); setContactoOk(false); }} autoComplete="name" />
          <Campo rotulo="Telemóvel (WhatsApp)" value={tel ?? dados.empresa.telefone ?? ""} onChangeText={(v) => { setTel(v); setContactoOk(false); }} keyboardType="phone-pad" placeholder="912 345 678" autoComplete="tel" />
          <Erro texto={erroContacto} />
          {contactoOk ? <Texto tamanho={13} cor={cor.verde}>Contacto guardado.</Texto> : null}
          <Botao titulo="Guardar contacto" variante="secundario" onPress={guardarContacto} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 8 }}>
            <View style={{ flex: 1 }}>
              <Texto forte>Lembretes por WhatsApp</Texto>
              <Texto sec tamanho={13}>Prazos e pedidos do seu contabilista, do número oficial da Contabia. Pode parar a qualquer momento, aqui ou respondendo PARAR.</Texto>
            </View>
            <Switch accessibilityLabel="Lembretes por WhatsApp" value={wa ?? dados.empresa.whatsappLembretes ?? false}
              onValueChange={async (v) => { setErroWa(null); setWa(v); try { await api.lembretesWhatsApp(sessao!.id, v); } catch (e) { setWa(!v); setErroWa((e as Error).message); } }} trackColor={{ true: cor.verde, false: cor.bordaForte }} />
          </View>
          <Erro texto={erroWa} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 8 }}>
            <View style={{ flex: 1 }}>
              <Texto forte>Dicas do Luís por e-mail</Texto>
              <Texto sec tamanho={13}>Os avisos de prazos chegam sempre; isto são só dicas para tirar partido da app.</Texto>
            </View>
            <Switch accessibilityLabel="Dicas do Luís por e-mail" value={dicas ?? dados.empresa.emailsDicas ?? true}
              onValueChange={async (v) => { setDicas(v); try { await api.preferenciasEmail(sessao!.id, v); } catch { setDicas(!v); } }} trackColor={{ true: cor.verde, false: cor.bordaForte }} />
          </View>
        </Cartao>
      ) : null}

      <Cartao>
        <Texto forte tamanho={15}>Os seus dados estão protegidos</Texto>
        <Texto>• Nenhum documento pode ser apagado: só anulado, e apenas com a confirmação do seu contabilista.</Texto>
        <Texto>• Tudo fica guardado durante 10 anos, como a lei exige.</Texto>
        <Texto>• Se perder ou trocar de telemóvel, entra noutro e encontra tudo igual.</Texto>
      </Cartao>

      <View style={{ height: 24 }} />
      <Texto sec tamanho={12}>Sair só é preciso se o telemóvel ou computador for usado por outra pessoa, ou se o vai vender ou emprestar. Sair não apaga nada.</Texto>
      {passo === 0 ? (
        <Botao titulo="Sair deste dispositivo" variante="secundario" onPress={() => setPasso(1)} />
      ) : (
        <Cartao>
          <MensagemLuis texto="Tem a certeza? Para voltar a entrar vai precisar do utilizador e da senha da empresa. Os seus dados ficam todos na nuvem." />
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Botao titulo="Ficar" onPress={() => setPasso(0)} estilo={{ flex: 1 }} />
            <Botao titulo="Sim, sair" variante="perigo" onPress={terminar} estilo={{ flex: 1 }} />
          </View>
        </Cartao>
      )}
      <Texto sec tamanho={11} cor={cor.textoSec}>A sessão continua aberta durante 30 dias de uso, mesmo que feche a app.</Texto>
    </Ecra>
  );
}
