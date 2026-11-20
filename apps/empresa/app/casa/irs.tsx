import { useState } from "react";
import { PRECO_IRS_CASA, dataPT, euros } from "@contabia/shared";
import { Botao, Cartao, Ecra, Erro, MensagemLuis, Texto, Titulo, useDados, useSessao } from "@contabia/ui";

/** Serviço de IRS: um Contabilista Certificado revê e entrega a declaração (preços aprovados a 20/11/2026). */
export default function ServicoIRS() {
  const { api } = useSessao();
  const { dados, recarregar } = useDados(() => api.casa(), []);
  const [erro, setErro] = useState<string | null>(null);
  const [aEnviar, setAEnviar] = useState<string | null>(null);
  const pedido = dados?.agregado.servicoIRS;
  const titulares = dados?.membros.filter((m) => m.ativo && m.tipo === "titular").length ?? 1;
  const dependentes = dados?.membros.filter((m) => m.ativo && m.tipo === "dependente").length ?? 0;
  const sugerido = titulares > 1 || dependentes > 0 ? "familia" : "individual";

  async function pedir(tipo: "individual" | "familia") {
    setAEnviar(tipo); setErro(null);
    try { await api.casaPedirIRS(tipo); recarregar(); } catch (e) { setErro((e as Error).message); } finally { setAEnviar(null); }
  }

  return (
    <Ecra>
      <Titulo sub="Com um Contabilista Certificado">Serviço de IRS</Titulo>
      <MensagemLuis escuro texto={pedido
        ? `Pedido registado a ${dataPT(pedido.pedidoEm.slice(0, 10))}. Um contabilista vai contactá-lo para combinar a revisão e a entrega.`
        : "As suas faturas já ficam organizadas aqui. Se quiser, um Contabilista Certificado revê tudo e entrega a declaração por si."} />
      <Cartao>
        <Texto forte tamanho={15}>O que inclui</Texto>
        <Texto tamanho={13}>Revisão das faturas e deduções, comparação entre entregar em conjunto ou em separado, entrega da declaração entre 1 de abril e 30 de junho e resposta a dúvidas sobre a liquidação.</Texto>
      </Cartao>
      {(["individual", "familia"] as const).map((t) => (
        <Cartao key={t} destaque={t === sugerido && !pedido}>
          <Texto forte tamanho={15}>{t === "individual" ? "Declaração individual" : "Declaração de família"}</Texto>
          <Texto tamanho={13} sec>{t === "individual" ? "Uma pessoa, sem dependentes." : "Casal ou com dependentes."}</Texto>
          <Texto forte tamanho={22}>{euros(PRECO_IRS_CASA[t])}</Texto>
          <Botao titulo={pedido?.tipo === t ? "Pedido enviado" : "Pedir este serviço"} desativado={!!pedido} carregando={aEnviar === t} onPress={() => pedir(t)} />
        </Cartao>
      ))}
      <Erro texto={erro} />
      <Texto sec tamanho={12}>A app do Plano Casa é grátis. O serviço de IRS paga-se à parte, depois de combinado com o contabilista.</Texto>
    </Ecra>
  );
}
