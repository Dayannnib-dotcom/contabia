import { useState } from "react";
import { useRouter } from "expo-router";
import { ajudaNIF } from "@contabia/shared";
import { Botao, Campo, Cartao, Ecra, Erro, MensagemLuis, Texto, Titulo, useSessao } from "@contabia/ui";

/** O gestor da empresa ativa a área Família: o IRS e as faturas da casa, separados da empresa. */
export default function AtivarFamilia() {
  const { api } = useSessao();
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [nif, setNif] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [aEnviar, setAEnviar] = useState(false);
  const ajuda = ajudaNIF(nif);

  async function ativar() {
    setAEnviar(true); setErro(null);
    try { await api.casaAtivar({ nome: nome.trim(), nif: nif.replace(/\s/g, "") }); router.replace("/casa"); }
    catch (e) { setErro((e as Error).message); }
    finally { setAEnviar(false); }
  }

  return (
    <Ecra>
      <Titulo sub="O IRS e as faturas da sua casa, na mesma app">Área Família</Titulo>
      <MensagemLuis texto="Guardo as faturas da casa e digo-lhe quanto já conta para o IRS da família. Fica tudo separado da empresa." />
      <Cartao>
        <Texto forte>Separada da empresa</Texto>
        <Texto tamanho={13}>O contabilista da empresa e os colaboradores não veem a área Família. Se quiser, pode convidar um contabilista só para a família.</Texto>
      </Cartao>
      <Campo rotulo="O seu nome" value={nome} onChangeText={setNome} autoComplete="name" />
      <Campo rotulo="O seu NIF pessoal" value={nif} onChangeText={setNif} keyboardType="number-pad" erro={ajuda.estado === "invalido"} ajuda={nif ? ajuda.mensagem : "O seu NIF, não o da empresa."} />
      <Erro texto={erro} />
      <Botao titulo="Ativar a área Família" onPress={ativar} carregando={aEnviar} desativado={nome.trim().length < 2 || ajuda.estado !== "valido"} />
      <Texto sec tamanho={12}>A área Família é grátis. O serviço de IRS com contabilista paga-se à parte (45 € individual, 69 € família).</Texto>
    </Ecra>
  );
}
