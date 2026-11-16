# Marca Contabia — ficheiros mestre e kit de marca

Esta pasta guarda tudo o que é preciso para voltar a gerar o **Kit de marca** (a pasta `CONTABIA_Kit_de_Marca_vX.Y` entregue à fundadora).

| Pasta | Conteúdo |
| --- | --- |
| `fontes/guia2` | Logótipos, ícone da app, padrões, maquetas e Luís (SVG e PNG mestre) e os scripts que os geram |
| `fontes/guia4` | Folhas de ícones e grelhas de composição |
| `fontes/guia5` | Abertura animada «A maré a baixar» |
| `fontes/guia6` | Folhas de exemplos de aplicação (`gen.py` gera-as a partir dos ficheiros acima) |
| `kit` | `montar.py` (monta o kit), `leia-me.html` (índice em PDF), `dec.py` (guarda os PDF exportados) |

## Guias (exportar em PDF A4 a partir do Claude Docs)

| N.º | Guia | Documento | Separador |
| --- | --- | --- | --- |
| 1 | Estratégia de marca | `0b1fd36d-b24b-49c1-a22b-60c2394db0c5` | `88b6806c-e105` |
| 2 | Identidade visual | `012c4e74-103c-47cc-b421-e1d8a5f39642` | `c5e4efcd-00ee` |
| 3 | Voz e tom | `0b7a6ea0-3451-46a9-8130-bc6fe98efec9` | `fa3b5b12-1816` |
| 4 | Direção de arte | `b2a6db2e-460b-4d6b-9f82-adfd4fc7b1b9` | `7f0fa5f3-9e32` |
| 5 | Produto digital | `5e26f45a-8bb9-46fe-abb6-85e6abc696da` | `92d04dfb-957a` |
| 6 | Aplicações | `24d3747d-33ed-4e81-b956-60bc10cfe5dc` | `de412d85-afc9` |
| 7 | Governança | `8da8e2d1-3d21-43f3-bfc9-cbddefef44e1` | `a6925ddd-68c2` |

Os PDF ficam em `kit/pdf/guia1.pdf` … `guia7.pdf` e **não entram no Git** (o repositório é público e a Guia 1 tem estratégia comercial).

## Gerar uma nova versão do kit

```bash
pip install playwright && python -m playwright install chromium   # uma vez (ou usar CHROME=/caminho/do/chrome)
python marca/fontes/guia6/gen.py          # só se as folhas de exemplos mudarem
CHROME=/caminho/do/chrome python marca/kit/montar.py 1.1            # cria marca/kit/saida/CONTABIA_Kit_de_Marca_v1.1(.zip)
```

Ao acrescentar a Guia 7: exportar o PDF para `kit/pdf/guia7.pdf`, atualizar a tabela de versões no `leia-me.html` e gerar a versão 1.1.

## Histórico

| Versão | Data | Conteúdo |
| --- | --- | --- |
| 1.1 | 16/11/2026 | Sete guias aprovadas (Guia 7 acrescentada; voz falada do Luís na Guia 3) |
| 1.0 | 16/11/2026 | Guias 1 a 5 aprovadas, Guia 6 em revisão, 203 ficheiros em 9 pastas |
