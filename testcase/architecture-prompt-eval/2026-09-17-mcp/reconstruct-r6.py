"""Reproduce R6 transport-only EOF recovery; never edit model patch values."""
from pathlib import Path
import hashlib
import json

root = Path(__file__).resolve().parent
run = root / 'runs/mcp-r6-model-repair-json'
raw = (run / 'response.txt').read_text()
try:
    json.loads(raw)
except json.JSONDecodeError as error:
    if error.pos != len(raw) or not raw.endswith('}]'):
        raise
else:
    raise ValueError('Expected the recorded missing outer-object terminator')

# The only normalization is one missing JSON envelope character at EOF.
# All old/new strings remain exactly as authored by the model.
patch = json.loads(raw + '}')
assert set(patch) == {'replacements'}
assert len(patch['replacements']) == 22
original = (root / 'runs/mcp-r4/response.html').read_text()
sha = lambda text: hashlib.sha256(text.encode()).hexdigest()
assert sha(original) == '8251167c32bc7431872c882eb29df3a13b5dbc0e84f7c4996e3800828baaf237'
html = original
for item in patch['replacements']:
    assert set(item) == {'old', 'new'}
    assert html.count(item['old']) == 1
    html = html.replace(item['old'], item['new'], 1)

output = root / 'runs/mcp-r6-reconstructed'
output.mkdir(exist_ok=False)
(output / 'normalized-patches.json').write_text(json.dumps(patch, ensure_ascii=False, indent=2))
(output / 'response.html').write_text(html)
(output / 'metadata.json').write_text(json.dumps({
    'kind':'model repair with explicit transport-only normalization',
    'inputResponse':'../mcp-r6-model-repair-json/response.txt',
    'normalization':'Append one missing outer JSON closing brace at EOF; no patch value changed',
    'rawResponseSha256':sha(raw), 'baseHtmlSha256':sha(original),
    'htmlSha256':sha(html), 'replacementsApplied':len(patch['replacements']),
    'handAuthoredHtmlChanges':False, 'independentFreshGeneration':False
}, ensure_ascii=False, indent=2))
print(output)
