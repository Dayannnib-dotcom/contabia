import { Banco, Ecra, Titulo, useSessao } from "@contabia/ui";

export default function BancoEmpresa() {
  const { sessao } = useSessao();
  return (
    <Ecra>
      <Titulo sub="Cada pagamento do banco fica ligado à sua fatura. O que não tiver fatura, o contabilista pede-lhe.">Banco</Titulo>
      <Banco empresaId={sessao!.id} papel="empresa" />
    </Ecra>
  );
}
