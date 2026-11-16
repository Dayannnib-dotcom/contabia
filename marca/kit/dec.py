import json,base64,sys,glob,os
f=sorted(glob.glob('/tmp/claude-tool-results/*/mcp-Claude_Docs-export-*.txt'),key=os.path.getmtime)[-1]
d=json.load(open(f))['data']
open(sys.argv[1],'wb').write(base64.b64decode(d['bytes_b64'])); print(d['name'],d['pages'],'pág.',d['notes'])
