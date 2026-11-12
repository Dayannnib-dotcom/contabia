import * as LocalAuthentication from "expo-local-authentication";

/**
 * Confirma com Face ID / impressão digital. Sem sensor ou sem biometria
 * registada (navegador, emulador), segue com a sessão já autenticada.
 */
export async function confirmarBiometria(motivo: string): Promise<boolean> {
  try {
    const tem = await LocalAuthentication.hasHardwareAsync();
    const registada = tem && (await LocalAuthentication.isEnrolledAsync());
    if (!registada) return true;
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: motivo, cancelLabel: "Cancelar" });
    return r.success;
  } catch {
    return true;
  }
}
