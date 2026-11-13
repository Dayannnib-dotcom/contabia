import { EspacoServicosVista, Ecra, Titulo, useSessao } from "@contabia/ui";

export default function ServicosEmpresa() {
  const { sessao } = useSessao();
  return (
    <Ecra>
      <Titulo sub="Reuniões e serviços que o seu contabilista registou, com o tempo de cada um.">Serviços e reuniões</Titulo>
      <EspacoServicosVista empresaId={sessao!.id} papel="empresa" />
    </Ecra>
  );
}
