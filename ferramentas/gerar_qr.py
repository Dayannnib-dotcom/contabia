"""Gera o código QR do site que abre a app da empresa. Correr de novo se o domínio mudar (ex.: contabia.pt)."""
import pathlib, sys, segno
url = sys.argv[1] if len(sys.argv) > 1 else "https://contabia-eu.onrender.com/empresa/"
dest = pathlib.Path(__file__).resolve().parent.parent / "web/site/img/qr-app.svg"
segno.make(url, error="m").save(str(dest), kind="svg", scale=6, border=2, dark="#12232E", light="#FFFFFF", xmldecl=False, svgns=True, title="Abrir a Contabia")
print("ok", url)
