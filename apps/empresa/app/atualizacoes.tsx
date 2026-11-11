import { dataPT, taxasEm } from "@contabia/shared";
import { Cartao, Chip, Ecra, Linha, MensagemLuis, Texto, Titulo, cor, useDados, useSessao } from "@contabia/ui";

export default function Atualizacoes() {
  const { api, sessao, ultimoEvento } = useSessao();
  const { dados } = useDados(async () => {
    const [regras, eu] = await Promise.all([api.regras(), api.eu()]);
    return { regras, empresa: eu.empresa! };
  }, [sessao!.id]);
  if (!dados) return <Ecra><Texto sec>A carregar…</Texto></Ecra>;
  const hoje = new Date().toISOString().slice(0, 10);
  const t = taxasEm(dados.regras, dados.empresa.regiao, hoje);
  return (
    <Ecra>
      <Titulo sub={`Regras v${dados.regras.versao} · publicadas a ${dataPT(dados.regras.publicadaEm)}`}>Atualizações fiscais</Titulo>
      <Cartao estilo={{ backgroundColor: cor.verdeClaro, borderColor: "#B9DDD0" }}>
        <Texto forte cor={cor.verdeEscuro}>Atualização automática ativa</Texto>
        <Texto cor="#1D4B40">As novas regras entram em vigor sozinhas na data legal. O seu contabilista é informado.</Texto>
      </Cartao>
      {ultimoEvento?.tipo === "regras.atualizadas" ? <MensagemLuis texto="Acabou de chegar uma atualização fiscal. Já está aplicada." /> : null}
      <Cartao estilo={{ paddingVertical: 4 }}>
        <Texto forte estilo={{ paddingTop: 12 }}>Em vigor para a sua empresa</Texto>
        <Linha esquerda="Taxas de IVA" sub={`Reduzida ${t.reduzida}% · intermédia ${t.intermedia}% · normal ${t.normal}%`} direita={<Chip texto={dados.empresa.regiao === "PT" ? "Continente" : dados.empresa.regiao === "PT-MA" ? "Madeira" : "Açores"} tipo="bom" />} />
        <Linha esquerda="Faturas em PDF sem assinatura" sub={`Aceites até ${dataPT(dados.regras.pdfSemAssinaturaAceiteAte)}; depois, assinatura digital qualificada`} direita={<Chip texto="Agendada" tipo="aviso" />} />
        <Linha esquerda="SAF-T da contabilidade" sub={`Obrigatório para o exercício de ${dados.regras.saftContabilidadeObrigatorioDesde}`} direita={<Chip texto="Aplicada" tipo="bom" />} />
        {dados.regras.prorrogacoes.map((p, i) => (
          <Linha key={i} esquerda={`Prorrogação: ${p.obrigacao} (${p.periodo})`} sub={`Novo prazo ${dataPT(p.novoPrazo)} · ${p.fonte}`} direita={<Chip texto="Aplicada" tipo="bom" />} />
        ))}
      </Cartao>
    </Ecra>
  );
}
