"""Produce a single offline HTML file from the shared P01 source files."""
from pathlib import Path
import base64
import re

ROOT=Path(__file__).resolve().parents[1]
design=ROOT/'design'
source=(design/'preview/index.html').read_text()
css=(design/'styles/brand.generated.css').read_text()+'\n'+(design/'styles/components.css').read_text()
for font in (design/'fonts').glob('*.woff'):
    encoded=base64.b64encode(font.read_bytes()).decode()
    css=css.replace('../fonts/'+font.name,'data:font/woff;base64,'+encoded)
source=re.sub(r'<link rel="stylesheet"[^>]*>','',source)
source=re.sub(r'<script defer[^>]*></script>','',source)
source=source.replace('</head>','<style>'+css+'</style></head>')
for asset in (design/'assets').glob('*.svg'):
    uri='data:image/svg+xml;base64,'+base64.b64encode(asset.read_bytes()).decode()
    source=source.replace('../assets/'+asset.name,uri)
js=(design/'brand.generated.js').read_text()+'\n'+(design/'components.js').read_text()
source=source.replace('</body>','<script>'+js+'</script></body>')
(design/'Nobteek_P01_Preview.html').write_text(source)
print('Built offline HTML preview with embedded fonts and vector marks')
