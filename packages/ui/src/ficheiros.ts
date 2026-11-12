import { Platform } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";

/** Os bancos e o e-Fatura exportam às vezes em Latin-1: se não for UTF-8 válido, lê como Latin-1. */
export function decodificar(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return s;
  }
}

/** Pede um ficheiro de texto (CSV) e devolve o conteúdo, ou null se cancelar. */
export async function escolherFicheiroTexto(): Promise<{ nome: string; texto: string } | null> {
  const r = await DocumentPicker.getDocumentAsync({ type: ["text/csv", "text/comma-separated-values", "application/vnd.ms-excel", "text/plain", "*/*"], copyToCacheDirectory: true });
  if (r.canceled || !r.assets[0]) return null;
  const { uri, name } = r.assets[0];
  if (/\.xlsx?$/i.test(name)) throw new Error("Este ficheiro é Excel. No homebanking escolha exportar em CSV (ou abra no Excel e «Guardar como» CSV).");
  let bytes: Uint8Array;
  if (Platform.OS === "web") bytes = new Uint8Array(await (await fetch(uri)).arrayBuffer());
  else {
    const bin = globalThis.atob(await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 }));
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  }
  return { nome: name, texto: decodificar(bytes) };
}
