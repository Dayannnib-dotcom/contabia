"""Gera web/site/termos.html a partir de web/legal/termos.md (texto aprovado). Correr após editar o .md."""
import pathlib, markdown
raiz = pathlib.Path(__file__).resolve().parent.parent
md = (raiz / "web/legal/termos.md").read_text(encoding="utf-8")
corpo = markdown.markdown(md, extensions=["tables"])
# índice a partir dos ##
import re
seccoes = re.findall(r"<h2>(.*?)</h2>", corpo)
corpo = re.sub(r"<h2>(.*?)</h2>", lambda m: f'<h2 id="c{seccoes.index(m.group(1)) + 1}">{m.group(1)}</h2>', corpo)
indice = "".join(f'<li><a href="#c{i + 1}">{s}</a></li>' for i, s in enumerate(seccoes))
html = f"""<!doctype html>
<html lang="pt-PT"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Termos e Condições — Contabia</title>
<meta name="description" content="Termos e Condições de Utilização da Contabia, a ferramenta de apoio à gestão contabilística das empresas em Portugal.">
<link rel="icon" href="/site/img/contabia-simbolo.svg">
<style>
@font-face{{font-family:"Space Grotesk";src:url(/site/fonts/SpaceGrotesk-Bold.woff2) format("woff2");font-weight:700;font-display:swap}}
@font-face{{font-family:"IBM Plex Sans";src:url(/site/fonts/IBMPlexSans-Regular.woff2) format("woff2");font-weight:400;font-display:swap}}
@font-face{{font-family:"IBM Plex Sans";src:url(/site/fonts/IBMPlexSans-SemiBold.woff2) format("woff2");font-weight:600;font-display:swap}}
:root{{--ink:#12232E;--muted:#4B5A63;--primary:#0B6E5B;--mint:#3CC6A0;--line:#E3E8E5;--surface:#F6F7F5}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--surface);color:var(--ink);font:400 16px/1.65 "IBM Plex Sans",system-ui,sans-serif}}
header{{background:var(--ink);color:#fff}}header .in{{max-width:860px;margin:auto;padding:18px 20px;display:flex;justify-content:space-between;align-items:center;gap:12px}}
header a{{color:#fff;text-decoration:none;font:700 20px "Space Grotesk",system-ui,sans-serif}}header span{{color:var(--mint);font-weight:600;font-size:14px}}
.aviso{{background:#FDF1DC;color:#7A4B0C;text-align:center;font-size:14px;padding:8px 16px}}
main{{max-width:860px;margin:auto;padding:32px 20px 80px}}
h1{{font:700 34px/1.15 "Space Grotesk",system-ui,sans-serif;margin:0 0 6px}}
h2{{font:700 21px/1.3 "Space Grotesk",system-ui,sans-serif;margin:40px 0 10px;padding-top:12px;border-top:1px solid var(--line);scroll-margin-top:16px}}
a{{color:var(--primary)}}nav.indice{{background:#fff;border:1px solid var(--line);border-radius:16px;padding:16px 20px;margin:24px 0}}
nav.indice ol{{columns:2;column-gap:28px;margin:0;padding:0;list-style:none;font-size:14px;line-height:1.9}}@media(max-width:640px){{nav.indice ol{{columns:1}}}}
table{{border-collapse:collapse;width:100%;font-size:14px;background:#fff;border-radius:12px;overflow:hidden}}th,td{{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top}}th{{background:#EEF3F0}}
footer{{max-width:860px;margin:auto;padding:0 20px 40px;color:var(--muted);font-size:14px}}
@media print{{header,.aviso,nav.indice{{display:none}}body{{background:#fff}}}}
</style></head><body>
<div class="aviso">Versão de testes: use apenas dados fictícios.</div>
<header><div class="in"><a href="/">contabia</a><span>A maré certa.</span></div></header>
<main>
{corpo[:corpo.index("<h2")]}
<nav class="indice" aria-label="Índice"><ol>{indice}</ol></nav>
{corpo[corpo.index("<h2"):]}
</main>
<footer>Dúvidas sobre estes Termos: [e-mail]. <a href="/">Voltar ao início</a> · <a href="javascript:print()">Imprimir</a></footer>
</body></html>"""
(raiz / "web/site/termos.html").write_text(html, encoding="utf-8")
print("ok", len(seccoes), "cláusulas")
