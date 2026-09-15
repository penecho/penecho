"""Build two self-contained Canvas review documents. No product runtime changes."""
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "preview.html"
source = SOURCE.read_text()
for theme in ("a", "b"):
    html = source.replace("__THEME__", theme)
    (HERE / f"echoes-{theme}.html").write_text(html)
    print(f"echoes-{theme}.html: {len(html)} characters")
