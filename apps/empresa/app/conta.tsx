import { useState } from "react";
import { View } from "react-native";
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
