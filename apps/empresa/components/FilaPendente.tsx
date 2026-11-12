import { useState } from "react";
import { View } from "react-native";
import { Botao, Cartao, Chip, Texto, cor, useSessao } from "@contabia/ui";
import { anexarNaFila, descartar, processarFila, useFila } from "../lib/fila";
import { escolherDaGaleria, fotografar } from "../lib/anexar";

/** Documentos guardados no telemóvel à espera de internet (ou recusados pela nuvem). */
export function FilaPendente({ compacto }: { compacto?: boolean }) {
  const { api } = useSessao();
  const fila = useFila();
  const [aTentar, setATentar] = useState(false);
  const [confirmar, setConfirmar] = useState<string | null>(null);
  if (!fila.length) return null;
  const espera = fila.filter((i) => !i.erro).length;

  if (compacto) {
    return (
      <Cartao>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: cor.ambarTexto }} />
          <Texto forte>{fila.length === 1 ? "1 documento guardado no telemóvel" : `${fila.length} documentos guardados no telemóvel`}</Texto>
        </View>
        <Texto sec tamanho={12}>{espera ? "São enviados sozinhos para a nuvem quando houver internet. Não apague a app até lá." : "Precisam da sua atenção em Documentos."}</Texto>
      </Cartao>
    );
  }

  return (
    <View style={{ gap: 10 }}>
      <Texto forte tamanho={16}>À espera de internet ({fila.length})</Texto>
      <Texto sec tamanho={12}>Estes documentos estão guardados só no telemóvel. A app envia-os sozinha quando a rede voltar.</Texto>
      {fila.map((i) => (
        <Cartao key={i.id}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
            <Texto forte>{i.resumo}</Texto>
            <Chip texto={i.erro ? "Recusado" : i.anexo ? "Com foto" : "Sem foto"} tipo={i.erro ? "erro" : i.anexo ? "bom" : "aviso"} />
          </View>
          {i.erro ? <Texto tamanho={13} cor={cor.vermelho}>{i.erro}</Texto> : null}
          {!i.anexo && !i.erro ? (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Botao titulo="Fotografar" variante="secundario" estilo={{ flex: 1 }} onPress={async () => { const f = await fotografar().catch(() => null); if (f) await anexarNaFila(i.id, f); }} />
              <Botao titulo="Galeria" variante="secundario" estilo={{ flex: 1 }} onPress={async () => { const f = await escolherDaGaleria().catch(() => null); if (f) await anexarNaFila(i.id, f); }} />
            </View>
          ) : null}
          {i.erro ? (
            confirmar === i.id ? (
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Botao titulo="Manter" variante="secundario" estilo={{ flex: 1 }} onPress={() => setConfirmar(null)} />
                <Botao titulo="Sim, retirar" variante="perigo" estilo={{ flex: 1 }} onPress={() => descartar(i.id)} />
              </View>
            ) : (
              <Botao titulo="Retirar do telemóvel" variante="secundario" onPress={() => setConfirmar(i.id)} />
            )
          ) : null}
        </Cartao>
      ))}
      {espera ? <Botao titulo="Tentar enviar agora" onPress={async () => { setATentar(true); await processarFila(api).catch(() => 0); setATentar(false); }} carregando={aTentar} /> : null}
    </View>
  );
}
