import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { arred, categoriaCasaSugerida, dataPT, euros, lerQR, qrConsistente, validarNIF, type CategoriaCasa, type DadosQR } from "@contabia/shared";
import { Botao, Campo, Cartao, Ecra, Erro, Linha, Texto, Titulo, cor, useDados, useSessao } from "@contabia/ui";
import { EscolherCategoria } from "../../components/CategoriaCasa";

/** Nova fatura da casa: código QR (telemóvel) ou introdução manual. */
export default function NovaFaturaCasa() {
  const [perm, pedirPerm] = useCameraPermissions();
  const [modo, setModo] = useState<"camara" | "manual">(Platform.OS === "web" ? "manual" : "camara");
  const [lido, setLido] = useState<{ texto: string; dados: DadosQR } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  function aoLer(texto: string) {
    if (lido) return;
    try {
      const d = lerQR(texto);
      if (!qrConsistente(d)) throw new Error("Os valores do código QR não batem certo.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      setLido({ texto, dados: d });
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  if (lido) return <Confirmar qr={lido.texto} dados={lido.dados} outra={() => setLido(null)} />;
  if (modo === "manual") return <Confirmar outra={Platform.OS === "web" ? undefined : () => setModo("camara")} />;
  if (!perm) return null;
  if (!perm.granted) {
    return (
      <Ecra>
        <Titulo>Fotografar fatura</Titulo>
        <Texto>Para ler o código QR das faturas, a Contabia precisa de acesso à câmara.</Texto>
        <Botao titulo="Permitir câmara" onPress={pedirPerm} />
        <Botao titulo="Introduzir à mão" variante="secundario" onPress={() => setModo("manual")} />
      </Ecra>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: "#0C1A22" }}>
      <CameraView style={StyleSheet.absoluteFill} barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={(r) => aoLer(r.data)} />
      <View style={s.moldura} pointerEvents="none" />
      <View style={s.barra}>
        <Text style={s.instr}>Aponte para o código QR da fatura</Text>
        {erro ? <Text style={[s.instr, { color: "#FFB4B4" }]}>{erro}</Text> : null}
        <Pressable accessibilityRole="button" onPress={() => setModo("manual")} style={s.manual}>
          <Text style={{ color: "#FFF", fontWeight: "600" }}>Fatura sem QR? Introduzir à mão</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Confirmar({ qr, dados, outra }: { qr?: string; dados?: DadosQR; outra?: () => void }) {
  const { api } = useSessao();
  const router = useRouter();
  const { dados: casa, recarregar } = useDados(() => api.casa(), []);
  const [emitente, setEmitente] = useState("");
  const [categoria, setCategoria] = useState<CategoriaCasa | null>(null);
  const [membroId, setMembroId] = useState<string | null>(null);
  const [nif, setNif] = useState("");
  const [data, setData] = useState(new Date().toISOString().slice(0, 10));
  const [total, setTotal] = useState("");
  const [iva, setIva] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [aEnviar, setAEnviar] = useState(false);
  const cat = categoria ?? categoriaCasaSugerida(emitente);
  const precisaConsentimento = cat === "saude" && casa && !casa.agregado.consentimentoSaudeEm;
  const t = Number(total.replace(",", ".")) || 0;
  const manualOk = validarNIF(nif) && /^\d{4}-\d{2}-\d{2}$/.test(data) && t > 0;
  const membros = casa?.membros.filter((m) => m.ativo) ?? [];

  async function guardar() {
    setAEnviar(true);
    setErro(null);
    try {
      const comum = { emitente: emitente || undefined, categoria: cat, membroId };
      if (qr) await api.casaNovaDespesa({ qr, ...comum });
      else await api.casaNovaDespesa({ ...comum, nifEmitente: nif.replace(/\s/g, ""), data, total: arred(t), iva: arred(Number(iva.replace(",", ".")) || 0) });
      router.replace("/casa");
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setAEnviar(false);
    }
  }

  return (
    <Ecra>
      <Titulo sub={dados ? "Código QR lido e conferido" : "Para faturas sem código QR"}>{dados ? "Fatura lida" : "Introduzir fatura"}</Titulo>
      {dados ? (
        <Cartao estilo={{ paddingVertical: 4 }}>
          <Linha esquerda="NIF de quem emitiu" direita={<Texto>{dados.nifEmitente}</Texto>} />
          <Linha esquerda="Data" direita={<Texto>{dataPT(dados.data)}</Texto>} />
          <Linha esquerda="IVA" direita={<Texto>{euros(dados.totalImpostos)}</Texto>} />
          <Linha esquerda="Total" direita={<Texto forte>{euros(dados.total)}</Texto>} />
        </Cartao>
      ) : (
        <>
          <Campo rotulo="NIF de quem emitiu a fatura" value={nif} onChangeText={setNif} keyboardType="number-pad" erro={nif.length >= 9 && !validarNIF(nif)} ajuda={nif.length >= 9 ? (validarNIF(nif) ? "✓ NIF válido" : "NIF inválido") : undefined} />
          <Campo rotulo="Data (AAAA-MM-DD)" value={data} onChangeText={setData} />
          <Campo rotulo="Total com IVA (€)" value={total} onChangeText={setTotal} keyboardType="decimal-pad" />
          <Campo rotulo="IVA (€, opcional)" value={iva} onChangeText={setIva} keyboardType="decimal-pad" ajuda="Conta para a exigência de fatura (restaurantes, oficinas, cabeleireiros…)." />
        </>
      )}
      <Campo rotulo="Nome de quem emitiu" value={emitente} onChangeText={setEmitente} placeholder="ex.: Farmácia Central" ajuda="Com o nome, o Luís sugere a categoria." />
      <EscolherCategoria valor={cat} aoMudar={setCategoria} />
      {precisaConsentimento ? (
        <Cartao estilo={{ backgroundColor: cor.ambar, borderColor: cor.ambar }}>
          <Texto forte>Faturas de saúde são dados de saúde</Texto>
          <Texto tamanho={13}>Para as guardar, precisamos do seu consentimento expresso. Pode retirá-lo a qualquer momento em «Agregado familiar».</Texto>
          <Botao titulo="Dou o meu consentimento" onPress={async () => { try { await api.casaConsentirSaude(true); recarregar(); } catch (e) { setErro((e as Error).message); } }} />
        </Cartao>
      ) : null}
      {membros.length > 1 ? (
        <View style={{ gap: 8 }}>
          <Texto forte tamanho={14}>De quem é a despesa?</Texto>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {[{ id: null, nome: "Do agregado" }, ...membros].map((m) => (
              <Botao key={m.id ?? "agregado"} titulo={m.nome.split(" ")[0]} variante={membroId === m.id ? "principal" : "secundario"} onPress={() => setMembroId(m.id)} estilo={{ minHeight: 40, paddingHorizontal: 12 }} />
            ))}
          </View>
        </View>
      ) : null}
      <Erro texto={erro} />
      <Botao titulo="Guardar fatura" onPress={guardar} carregando={aEnviar} desativado={!!precisaConsentimento || (!dados && !manualOk)} />
      {outra ? <Botao titulo={dados ? "Ler outra" : "Voltar à câmara"} variante="secundario" onPress={outra} /> : null}
    </Ecra>
  );
}

const s = StyleSheet.create({
  moldura: { position: "absolute", top: "22%", left: "12%", right: "12%", aspectRatio: 1, borderWidth: 3, borderColor: cor.menta, borderRadius: 20 },
  barra: { position: "absolute", bottom: 40, left: 20, right: 20, gap: 12, alignItems: "center" },
  instr: { color: "#FFF", fontSize: 15, fontWeight: "600", textAlign: "center" },
  manual: { minHeight: 48, paddingHorizontal: 18, borderRadius: 14, backgroundColor: "rgba(31,59,74,0.95)", justifyContent: "center" },
});
