import { useState } from "react";
import { Botao, Campo, Ecra, Erro, MensagemLuis, Titulo } from "./componentes";
import { useSessao } from "./sessao";

/** «Esqueci-me da senha»: pede a ligação por e-mail. */
export function EcraRecuperar({ papel, aoVoltar }: { papel: "empresa" | "contabilista"; aoVoltar: () => void }) {
  const { api } = useSessao();
  const [ident, setIdent] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aEnviar, setAEnviar] = useState(false);
  async function enviar() {
    setAEnviar(true);
    setErro(null);
    try {
      setMsg((await api.recuperarSenha(papel, ident.trim())).mensagem);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setAEnviar(false);
    }
  }
  return (
    <Ecra>
      <Titulo sub={papel === "empresa" ? "Escreva o utilizador da empresa ou o seu e-mail. Enviamos uma ligação para criar uma nova senha." : "Escreva o seu e-mail profissional. Enviamos uma ligação para criar uma nova senha."}>Esqueci-me da senha</Titulo>
      {msg ? (
        <>
          <MensagemLuis texto={msg} />
          <Botao titulo="Voltar a entrar" onPress={aoVoltar} />
        </>
      ) : (
        <>
          <Campo rotulo={papel === "empresa" ? "Utilizador ou e-mail da conta a recuperar" : "E-mail da conta a recuperar"} value={ident} onChangeText={setIdent} autoCapitalize="none" autoCorrect={false} keyboardType={papel === "empresa" ? "default" : "email-address"} />
          <Erro texto={erro} />
          <Botao titulo="Enviar ligação" onPress={enviar} carregando={aEnviar} desativado={!ident.trim()} />
          <Botao titulo="Voltar" variante="secundario" onPress={aoVoltar} />
        </>
      )}
    </Ecra>
  );
}

/** Página aberta a partir do e-mail: escolher a nova senha. */
export function EcraRedefinir({ token, aoTerminar }: { token?: string; aoTerminar: () => void }) {
  const { api } = useSessao();
  const [senha, setSenha] = useState("");
  const [repetir, setRepetir] = useState("");
  const [ok, setOk] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(token ? null : "Ligação incompleta. Abra outra vez a ligação do e-mail.");
  const [aEnviar, setAEnviar] = useState(false);
  async function guardar() {
    if (senha !== repetir) return setErro("As duas senhas não são iguais.");
    setAEnviar(true);
    setErro(null);
    try {
      setOk((await api.redefinirSenha(token!, senha)).mensagem);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setAEnviar(false);
    }
  }
  return (
    <Ecra>
      <Titulo sub="Escolha uma senha nova com pelo menos 8 caracteres. Por segurança, as sessões abertas noutros aparelhos terminam.">Nova senha</Titulo>
      {ok ? (
        <>
          <MensagemLuis texto={ok} />
          <Botao titulo="Entrar" onPress={aoTerminar} />
        </>
      ) : (
        <>
          <Campo rotulo="Nova senha" value={senha} onChangeText={setSenha} secureTextEntry ajuda="Mínimo de 8 caracteres." />
          <Campo rotulo="Repita a nova senha" value={repetir} onChangeText={setRepetir} secureTextEntry />
          <Erro texto={erro} />
          <Botao titulo="Guardar nova senha" onPress={guardar} carregando={aEnviar} desativado={!token || senha.length < 8 || !repetir} />
        </>
      )}
    </Ecra>
  );
}
