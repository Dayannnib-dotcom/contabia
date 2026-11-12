import { Apoios, Ecra, Titulo, useSessao } from "@contabia/ui";

export default function ApoiosEmpresa() {
  const { sessao } = useSessao();
  return (
    <Ecra>
      <Titulo sub="Avisos do Portugal 2030 e do PRR que podem servir à sua atividade, pelo CAE.">Apoios europeus</Titulo>
      <Apoios empresaId={sessao!.id} papel="empresa" />
    </Ecra>
  );
}
