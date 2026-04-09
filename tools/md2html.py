#!/usr/bin/env python3
"""Convert markdown files to standalone HTML5 with embedded styling."""

import sys
import markdown
from pathlib import Path

HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<style>
  :root {{
    --bg: #ffffff;
    --fg: #1a1a2e;
    --code-bg: #f4f4f8;
    --border: #e0e0e6;
    --accent: #4a6fa5;
    --link: #4a6fa5;
    --table-stripe: #f8f8fc;
    --heading: #16213e;
    --blockquote-border: #4a6fa5;
    --blockquote-bg: #f0f4fa;
  }}
  @media (prefers-color-scheme: dark) {{
    :root {{
      --bg: #1a1a2e;
      --fg: #e0e0e6;
      --code-bg: #16213e;
      --border: #2a2a4a;
      --accent: #7ba0d4;
      --link: #7ba0d4;
      --table-stripe: #16213e;
      --heading: #e0e0e6;
      --blockquote-border: #7ba0d4;
      --blockquote-bg: #16213e;
    }}
  }}
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans SC", sans-serif;
    background: var(--bg);
    color: var(--fg);
    line-height: 1.8;
    padding: 2rem 1rem;
    max-width: 960px;
    margin: 0 auto;
  }}
  h1 {{ font-size: 2rem; color: var(--heading); margin: 2.5rem 0 1rem; padding-bottom: 0.4rem; border-bottom: 2px solid var(--accent); }}
  h2 {{ font-size: 1.5rem; color: var(--heading); margin: 2rem 0 0.8rem; padding-bottom: 0.3rem; border-bottom: 1px solid var(--border); }}
  h3 {{ font-size: 1.25rem; color: var(--heading); margin: 1.5rem 0 0.6rem; }}
  h4 {{ font-size: 1.1rem; color: var(--heading); margin: 1.2rem 0 0.5rem; }}
  p {{ margin: 0.8rem 0; }}
  a {{ color: var(--link); text-decoration: none; border-bottom: 1px dotted var(--link); }}
  a:hover {{ border-bottom-style: solid; }}
  code {{
    font-family: "JetBrains Mono", "Fira Code", "SF Mono", Consolas, monospace;
    font-size: 0.9em;
    background: var(--code-bg);
    padding: 0.15em 0.4em;
    border-radius: 4px;
    border: 1px solid var(--border);
  }}
  pre {{
    background: var(--code-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem 1.2rem;
    overflow-x: auto;
    margin: 1rem 0;
    line-height: 1.5;
  }}
  pre code {{
    background: none;
    border: none;
    padding: 0;
    font-size: 0.88em;
  }}
  table {{
    width: 100%;
    border-collapse: collapse;
    margin: 1rem 0;
    font-size: 0.95em;
  }}
  th, td {{
    border: 1px solid var(--border);
    padding: 0.6rem 0.8rem;
    text-align: left;
  }}
  th {{
    background: var(--accent);
    color: #fff;
    font-weight: 600;
  }}
  tr:nth-child(even) {{ background: var(--table-stripe); }}
  blockquote {{
    border-left: 4px solid var(--blockquote-border);
    background: var(--blockquote-bg);
    padding: 0.6rem 1rem;
    margin: 1rem 0;
    border-radius: 0 8px 8px 0;
  }}
  ul, ol {{ margin: 0.6rem 0 0.6rem 1.5rem; }}
  li {{ margin: 0.3rem 0; }}
  hr {{ border: none; border-top: 1px solid var(--border); margin: 2rem 0; }}
  img {{ max-width: 100%; height: auto; border-radius: 8px; }}
  .container {{ animation: fadeIn 0.3s ease-in; }}
  @keyframes fadeIn {{ from {{ opacity: 0; }} to {{ opacity: 1; }} }}
</style>
</head>
<body>
<div class="container">
{content}
</div>
</body>
</html>
"""

def convert(md_path: str):
    src = Path(md_path)
    content = src.read_text(encoding="utf-8")
    title = src.stem.replace("-", " ").replace("_", " ").title()

    # Extract first H1 as title if present
    for line in content.splitlines():
        if line.startswith("# "):
            title = line.lstrip("# ").strip()
            break

    html_body = markdown.markdown(
        content,
        extensions=["tables", "fenced_code", "codehilite", "toc"],
        extension_configs={"codehilite": {"guess_lang": False, "css_class": "highlight"}},
    )

    out = src.with_suffix(".html")
    out.write_text(HTML_TEMPLATE.format(title=title, content=html_body), encoding="utf-8")
    print(f"  {src.name} -> {out.name}")

if __name__ == "__main__":
    for f in sys.argv[1:]:
        convert(f)
