"""Builds apps/legal (privacy, terms, guidelines, support) from docs/legal/*.md.  Run: python tools/build_legal.py
Host it free on Render (render.yaml 'fishing-app-legal'); App Store Connect needs the Privacy Policy and Support URLs."""
import html, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC, OUT = ROOT / "docs" / "legal", ROOT / "apps" / "legal"
PAGES = [("privacy", "PRIVACY_POLICY.md", "Privacy Policy"), ("terms", "TERMS.md", "Terms of Use"), ("guidelines", "COMMUNITY_GUIDELINES.md", "Community Guidelines")]
CSS = """body{margin:0;background:#EEF2F6;color:#0B1B2B;font:16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
header{background:#0B2A40;color:#fff;padding:14px 20px}header a{color:#fff;text-decoration:none;font-weight:800}nav a{color:#CFE3EF;margin-right:14px;font-size:14px}
main{max-width:760px;margin:24px auto;background:#fff;border:1px solid #B9C6D2;border-radius:14px;padding:28px}h1{margin-top:0}h2{border-top:1px solid #DCE3EA;padding-top:16px}
a{color:#0A6E94}li{margin:4px 0}footer{text-align:center;color:#4F6375;font-size:13px;padding:20px}"""

def inline(t: str) -> str:
    t = html.escape(t)
    t = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", t)
    t = re.sub(r"\[(.+?)\]\((https?://[^)]+)\)", r'<a href="\2">\1</a>', t)
    return re.sub(r"`(.+?)`", r"<code>\1</code>", t)

def md(text: str) -> str:
    out, para, in_list = [], [], False
    def flush():
        nonlocal para
        if para: out.append(f"<p>{inline(' '.join(para))}</p>"); para = []
    for line in text.splitlines():
        s = line.rstrip()
        if not s.strip():
            flush()
            if in_list: out.append("</ul>"); in_list = False
            continue
        m = re.match(r"^(#{1,3}) (.*)", s)
        if m:
            flush()
            if in_list: out.append("</ul>"); in_list = False
            n = len(m.group(1)); out.append(f"<h{n}>{inline(m.group(2))}</h{n}>"); continue
        if re.match(r"^\s*[-*] ", s):
            flush()
            if not in_list: out.append("<ul>"); in_list = True
            out.append(f"<li>{inline(re.sub(r'^\s*[-*] ', '', s))}</li>"); continue
        if in_list and s.startswith("  "):
            out[-1] = out[-1][:-5] + " " + inline(s.strip()) + "</li>"; continue
        para.append(s.strip())
    flush()
    if in_list: out.append("</ul>")
    return "\n".join(out)

def page(title: str, body: str, app: str) -> str:
    nav = " ".join(f'<a href="{slug}.html">{t}</a>' for slug, _, t in PAGES) + ' <a href="support.html">Support</a>'
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)} — {html.escape(app)}</title><style>{CSS}</style></head><body><header><a href="index.html">{html.escape(app)}</a><nav>{nav}</nav></header>
<main>{body}</main><footer>© {html.escape(app)}</footer></body></html>"""

def build(app: str = "Your App Name", email: str = "support@example.com"):
    OUT.mkdir(parents=True, exist_ok=True)
    for slug, fn, title in PAGES:
        (OUT / f"{slug}.html").write_text(page(title, md((SRC / fn).read_text()), app))
    support = f"""<h1>Support</h1><p>Questions, bugs, or a spot that looks wrong? Email <a href="mailto:{email}">{email}</a> — we usually reply within a day.</p>
<h2>Delete your account</h2><p>In the app: <b>Me → Delete my account</b>. Or email us from the address on your account and we'll do it for you.</p>
<h2>Safety</h2><p>This app is fishing and navigation assistance only, not a certified chartplotter. In an emergency use VHF channel 16 or call the Coast Guard.</p>"""
    (OUT / "support.html").write_text(page("Support", support, app))
    (OUT / "index.html").write_text(page(app, f"<h1>{html.escape(app)}</h1><p>The Southern California fishing map.</p><ul>" +
        "".join(f'<li><a href="{s}.html">{t}</a></li>' for s, _, t in PAGES) + '<li><a href="support.html">Support</a></li></ul>', app))

if __name__ == "__main__":
    import sys
    build(*(sys.argv[1:3]))
    print("built", OUT)
