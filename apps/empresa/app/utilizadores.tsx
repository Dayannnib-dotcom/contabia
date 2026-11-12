import { useState } from "react";
import { View } from "react-native";
import { Botao, Campo, Cartao, Chip, Ecra, Erro, MensagemLuis, RegistoAtividade, Texto, Titulo, useDados, useSessao } from "@contabia/ui";

/** Gestor: quem pode usar a app em nome da empresa, e o registo de tudo o que é feito. */
export default function Utilizadores() {
  const { api, sessao } = useSessao();
  const id = sessao!.id;
  const { dados, recarregar } = useDados(() => api.colaboradores(id), [id]);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [mostrar, setMostrar] = useState(false);

  async function adicionar() {
    setErro(null);
    setOcupado("novo");
    try {
      const c = await api.adicionarColaborador(id, { nome, email, senha });
      setAviso(`${c.nome} já pode entrar na app Contabia (empresa) com o e-mail ${c.email} e a senha que definiu. Diga-lhe para a guardar.`);
      setNome(""); setEmail(""); setSenha(""); setMostrar(false);
      await recarregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  return (
    <Ecra>
      <Titulo sub="Os colaboradores registam faturas e fotografam documentos. Só o gestor gere a ligação ao contabilista, o banco e os utilizadores.">Utilizadores</Titulo>
      {aviso ? <MensagemLuis texto={aviso} /> : null}
      {(dados ?? []).map((c) => (
        <Cartao key={c.id}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
            <View style={{ flex: 1 }}><Texto forte>{c.nome}</Texto><Texto sec tamanho={12}>{c.email}</Texto></View>
            <Chip texto={c.ativo ? "Ativo" : "Desativado"} tipo={c.ativo ? "bom" : "neutro"} />
          </View>
          <Botao titulo={c.ativo ? "Desativar acesso" : "Reativar acesso"} variante="secundario" carregando={ocupado === c.id}
            onPress={async () => { setOcupado(c.id); try { await api.ativarColaborador(id, c.id, !c.ativo); await recarregar(); } catch (e) { setErro((e as Error).message); } finally { setOcupado(null); } }} />
        </Cartao>
      ))}
      {!mostrar ? (
        <Botao titulo="Adicionar colaborador" onPress={() => { setMostrar(true); setAviso(null); }} />
      ) : (
        <Cartao>
          <Texto forte tamanho={15}>Novo colaborador</Texto>
          <Campo rotulo="Nome do colaborador" value={nome} onChangeText={setNome} />
          <Campo rotulo="E-mail do colaborador" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoCorrect={false} />
          <Campo rotulo="Senha inicial" value={senha} onChangeText={setSenha} secureTextEntry ajuda="Mínimo de 8 caracteres. Entregue-a ao colaborador." />
          <Erro texto={erro} />
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Botao titulo="Cancelar" variante="secundario" onPress={() => setMostrar(false)} estilo={{ flex: 1 }} />
            <Botao titulo="Adicionar" onPress={adicionar} carregando={ocupado === "novo"} desativado={nome.trim().length < 2 || !/^\S+@\S+\.\S+$/.test(email) || senha.length < 8} estilo={{ flex: 2 }} />
          </View>
        </Cartao>
      )}
      {!mostrar ? <Erro texto={erro} /> : null}
      <View style={{ height: 8 }} />
      <Texto forte tamanho={16}>Registo de atividade</Texto>
      <RegistoAtividade empresaId={id} />
    </Ecra>
  );
}
