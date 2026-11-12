import { Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import type { Anexo, ApiContabia } from "@contabia/shared";

export interface Ficheiro { uri: string; tipo: string }

/** Reduz a foto a 1600 px e JPEG 70 %: legível para a AT e leve (~250 KB). */
async function comprimir(uri: string): Promise<Ficheiro> {
  const r = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1600 } }], { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG });
  return { uri: r.uri, tipo: "image/jpeg" };
}

export async function fotografar(): Promise<Ficheiro | null> {
  if (Platform.OS !== "web") {
    const p = await ImagePicker.requestCameraPermissionsAsync();
    if (!p.granted) throw new Error("Sem acesso à câmara. Autorize nas definições do telemóvel.");
  }
  const r = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], allowsEditing: true, quality: 1 });
  if (r.canceled || !r.assets[0]) return null;
  return comprimir(r.assets[0].uri);
}

export async function escolherDaGaleria(): Promise<Ficheiro | null> {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, quality: 1 });
  if (r.canceled || !r.assets[0]) return null;
  return comprimir(r.assets[0].uri);
}

export async function escolherPDF(): Promise<Ficheiro | null> {
  const r = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
  if (r.canceled || !r.assets[0]) return null;
  if ((r.assets[0].size ?? 0) > 10 * 1024 * 1024) throw new Error("O PDF tem mais de 10 MB. Envie uma versão mais pequena.");
  return { uri: r.assets[0].uri, tipo: "application/pdf" };
}

/** Envia o ficheiro para a nuvem. Devolve o anexo guardado. */
export async function enviarAnexo(api: ApiContabia, empresaId: string, documentoId: string, f: Ficheiro): Promise<Anexo> {
  const url = api.urlEnvioAnexo(empresaId, documentoId);
  const headers = { authorization: `Bearer ${api.token ?? ""}`, "content-type": f.tipo };
  let estado: number;
  let texto: string;
  if (Platform.OS === "web") {
    const blob = await (await fetch(f.uri)).blob();
    const r = await fetch(url, { method: "POST", headers, body: blob });
    estado = r.status;
    texto = await r.text();
  } else {
    const r = await FileSystem.uploadAsync(url, f.uri, { httpMethod: "POST", headers, uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT });
    estado = r.status;
    texto = r.body;
  }
  const json = (() => { try { return JSON.parse(texto); } catch { return null; } })();
  if (estado >= 400) throw new Error(json?.mensagem ?? "Não foi possível enviar o ficheiro. Tente de novo.");
  return json as Anexo;
}
