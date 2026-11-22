/**
 * Tipografia da marca (Guia 2 e Guia 5): Space Grotesk nos títulos, IBM Plex Sans no texto
 * e IBM Plex Mono nos valores. Todas com licença SIL OFL. Carregadas uma vez, na raiz de cada app.
 */
import { useEffect, useState } from "react";
import { useFonts } from "expo-font";
// Importar cada peso pelo seu caminho: assim a exportação web leva só estas 6 fontes.
import { SpaceGrotesk_500Medium } from "@expo-google-fonts/space-grotesk/500Medium";
import { SpaceGrotesk_700Bold } from "@expo-google-fonts/space-grotesk/700Bold";
import { IBMPlexSans_400Regular } from "@expo-google-fonts/ibm-plex-sans/400Regular";
import { IBMPlexSans_500Medium } from "@expo-google-fonts/ibm-plex-sans/500Medium";
import { IBMPlexSans_600SemiBold } from "@expo-google-fonts/ibm-plex-sans/600SemiBold";
import { IBMPlexMono_500Medium } from "@expo-google-fonts/ibm-plex-mono/500Medium";

export const fonte = {
  titulo: "SpaceGrotesk_700Bold",
  tituloMedio: "SpaceGrotesk_500Medium",
  texto: "IBMPlexSans_400Regular",
  textoMedio: "IBMPlexSans_500Medium",
  textoForte: "IBMPlexSans_600SemiBold",
  numero: "IBMPlexMono_500Medium",
} as const;

/**
 * Devolve `true` quando as fontes estão prontas, falharam ou demoram mais de 4 s
 * (rede lenta): nesses casos usa-se a do sistema e a app abre na mesma.
 */
export function useFontesContabia() {
  const [prontas, erro] = useFonts({
    SpaceGrotesk_500Medium, SpaceGrotesk_700Bold,
    IBMPlexSans_400Regular, IBMPlexSans_500Medium, IBMPlexSans_600SemiBold,
    IBMPlexMono_500Medium,
  });
  const [esgotado, setEsgotado] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setEsgotado(true), 4000);
    return () => clearTimeout(t);
  }, []);
  return prontas || !!erro || esgotado;
}
