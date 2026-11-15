"""Depois de `expo export --platform web`: volta a pôr no index.html das apps web
os ícones para o ecrã principal do iPhone (apple-touch-icon) e o favicon da marca.
Uso: python3 ferramentas/pos_export_web.py"""
from pathlib import Path

LINKS = ('<link rel="apple-touch-icon" href="/site/img/apple-touch-icon.png">\n'
         '    <link rel="icon" type="image/png" sizes="32x32" href="/site/img/favicon-32.png">\n'
         '    <meta name="apple-mobile-web-app-title" content="Contabia">')

for app in ("empresa", "contabilista"):
    p = Path(__file__).resolve().parent.parent / "web" / app / "index.html"
    s = p.read_text(encoding="utf-8")
    if "apple-touch-icon" not in s:
        i = s.index("</title>") + len("</title>")
        s = s[:i] + "\n    " + LINKS + s[i:]
        p.write_text(s, encoding="utf-8")
        print("atualizado:", p)
