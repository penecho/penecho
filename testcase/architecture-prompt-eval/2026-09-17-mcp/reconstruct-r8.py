"""Reproduce the recorded R8 JSON envelope recovery without editing patch values."""
from pathlib import Path
import hashlib
import json
import re

root = Path(__file__).resolve().parent
run = root / 'runs/mcp-r8-geometry-repair'
raw = (run / 'response.txt').read_text()
body = re.fullmatch(r'```json\s*\n([\s\S]*?)\n```', raw.strip()).group(1)
try:
    json.loads(body)
except json.JSONDecodeError as error:
    assert error.pos == len(body) and body.endswith('}]')
else:
    raise ValueError('Expected the recorded missing outer-object terminator')
patch = json.loads(body + '}')
assert set(patch) == {'replacements'} and len(patch['replacements']) == 4
original = (root / 'runs/mcp-r8-visual-repair/response.html').read_text()
sha = lambda text: hashlib.sha256(text.encode()).hexdigest()
assert sha(original) == 'daa90e4299ff6caf816b68e828760d157e44f0556acc4ed9124f870a0fddeba3'
html = original
for item in patch['replacements']:
    assert set(item) == {'old', 'new'}
    assert isinstance(item['old'], str) and item['old'] and isinstance(item['new'], str)
    assert html.count(item['old']) == 1
    html = html.replace(item['old'], item['new'], 1)
output = root / 'runs/mcp-r8-geometry-reconstructed'
output.mkdir(exist_ok=False)
(output / 'normalized-patches.json').write_text(json.dumps(patch, ensure_ascii=False, indent=2))
(output / 'response.html').write_text(html)
(output / 'metadata.json').write_text(json.dumps({
    'kind':'model repair with explicit transport-only normalization',
    'inputResponse':'../mcp-r8-geometry-repair/response.txt',
    'normalization':'Remove transport Markdown fence; append one outer JSON closing brace at EOF. No patch value changed.',
    'rawResponseSha256':sha(raw), 'baseHtmlSha256':sha(original),
    'htmlSha256':sha(html), 'replacementsApplied':len(patch['replacements']),
    'htmlBytes':len(html.encode()),
    'handAuthoredHtmlChanges':False, 'independentFreshGeneration':False
}, ensure_ascii=False, indent=2)+'\n')
print(output)
