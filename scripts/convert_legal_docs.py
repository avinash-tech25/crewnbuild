"""Convert the legal PDFs in docs/legal into the content both frontends render.

    python scripts/convert_legal_docs.py      (needs PyMuPDF: pip install pymupdf)

Run it after replacing a PDF; it rewrites professional/ and partner/ frontend
src/features/legal/content/{terms,privacy}.js and prints every [placeholder] left.

The PDFs carry their structure in type, not tags, so it is read from the layout:
  21pt bold      the title
  9.5pt          the company / site line under it
  13pt bold      a section heading ("1. Acceptance and Eligibility", "At a Glance")
  10.2pt         a numbered clause ("1.1 …"); kept as a paragraph, its number in bold
  9pt            an item (definitions, the at-a-glance points, contact lines); kept as a list item
  7.5pt          the running header and page number on every page; dropped
A new paragraph starts after a gap wider than the line spacing, on a change of size, or
on a new page after a line that ended a sentence. Each document is
{ id, title, company, site, effectiveDate, version, lastUpdated, sections: [{ id, number,
title, blocks: [{ type: 'p', parts } | { type: 'list', items: [parts] }] }] }, where parts
is a list of strings and { b: string } for bold text.

The PDFs carry no effective date or version: VERSIONS below is the version published
with each PDF (raise it whenever a PDF changes, together with TERMS_VERSION /
PRIVACY_VERSION in professional/backend/app/core/legal.py and partner/backend/app/core/legal.py),
and the effective / last-updated dates stay a placeholder until legal review sets them.
"""

import json
import re
from pathlib import Path

import fitz  # PyMuPDF

ROOT = Path(__file__).resolve().parents[1]
SOURCES = {
    'terms': ROOT / 'docs/legal/CrewnBuild_Terms_and_Conditions.pdf',
    'privacy': ROOT / 'docs/legal/CrewnBuild_Privacy_Policy.pdf',
}
VERSIONS = {'terms': '1.1', 'privacy': '1.1'}
DATE_PLACEHOLDER = '[DD Month YYYY]'
REPLACEMENTS = [
    ('GharBanao Technologies Pvt. Ltd.', '[Company legal name]'),
    ('dpdp@gharbanao.in', '[privacy contact email]'),
    ('gharbanao.in', 'crewnbuild.com'),
    ('GharBanao', 'CREWNBUILD'),
]
PLACEHOLDER = re.compile(r'\[[^\[\]]+\]')
PARAGRAPH_GAP = 16  # points between line tops; lines of one paragraph are ~13 apart


def brand(text: str) -> str:
    for old, new in REPLACEMENTS:
        text = text.replace(old, new)
    return text


def kind_of(size: float) -> str | None:
    if size >= 18:
        return 'title'
    if size >= 12:
        return 'heading'
    if size >= 10:
        return 'clause'
    if size >= 9.3:
        return 'subtitle'
    if size >= 8.5:
        return 'item'
    return None  # running header / page number


def span_text(span: dict) -> str:
    # The PDFs set the rupee sign in a symbol font whose text layer reads "I" ("I2,999").
    if span['font'].startswith('ZapfDingbats') and span['text'] == 'I':
        return '₹'
    return span['text']


def lines_of(path: Path):
    """Every text line in reading order: (page, top, kind, text)."""
    document = fitz.open(str(path))
    for page_number, page in enumerate(document):
        for block in page.get_text('dict')['blocks']:
            for line in block.get('lines', []):
                spans = [span for span in line['spans'] if span['text'].strip()]
                if not spans:
                    continue
                kind = kind_of(spans[0]['size'])
                if kind is None:
                    continue
                text = ''.join(span_text(span) for span in line['spans']).strip()
                yield page_number, line['bbox'][1], kind, text


def join(previous: str, text: str) -> str:
    # A word broken with a hyphen at the end of a line is not split in these PDFs; a
    # hyphen at the end belongs to a compound ("e-" never occurs), so keep it and join.
    return previous + text if previous.endswith('-') else f'{previous} {text}'


def starts_labelled_line(kind: str, so_far: str, text: str) -> bool:
    """Contact lines ("Legal and compliance: …", "Registered office: …") sit closer than
    paragraphs do; a short "Label: " line after a finished value starts a new one."""
    return (
        kind == 'item'
        and re.match(r'^[A-Z][A-Za-z ]{1,30}: ', text) is not None
        and so_far.rstrip().endswith(('.com', '.in', ']', ')'))
    )


def paragraphs_of(path: Path):
    """Lines grouped into paragraphs: (kind, text)."""
    current = None
    last = None  # (page, top)
    for page, top, kind, text in lines_of(path):
        new_paragraph = (
            current is None
            or kind != current[0]
            or kind in ('title', 'heading', 'subtitle')
            or (page == last[0] and top - last[1] > PARAGRAPH_GAP)
            or (page != last[0] and current[1].rstrip().endswith(('.', ':', ';')))
            or starts_labelled_line(kind, current[1], text)
        )
        if new_paragraph:
            if current:
                yield tuple(current)
            current = [kind, text]
        else:
            current[1] = join(current[1], text)
        last = (page, top)
    if current:
        yield tuple(current)


def slug(title: str) -> str:
    text = re.sub(r'^\d+\.\s*', '', title).lower()
    return re.sub(r'[^a-z0-9]+', '-', text).strip('-')


def clause_parts(text: str) -> list:
    """A numbered clause with its number in bold ("1.1 …"); other text as it is."""
    match = re.match(r'^(\d+\.\d+)\s+(.*)$', text)
    return [{'b': match.group(1)}, ' ' + match.group(2)] if match else [text]


def plain(parts) -> str:
    return ''.join(part if isinstance(part, str) else part['b'] for part in parts)


def starts_list_item(blocks: list, text: str) -> bool:
    """Whether a body-size paragraph is a list item. The PDFs draw no bullets, so:
    an item opens a section, follows a clause that introduces a list (ends with ':' or is
    a short lead such as "2.2 Homeowners."), or continues a list; a capitalised
    paragraph after a list of lower-case items ends that list (a closing sentence)."""
    if not blocks:
        return True
    previous = blocks[-1]
    if previous['type'] == 'list':
        last_item = plain(previous['items'][-1]).rstrip()
        if last_item.endswith((';', ' and', ' or', ',')):
            return True  # the list goes on ("…; and" / "GST, income-tax …")
        first_item = plain(previous['items'][0])
        return not (first_item[:1].islower() and text[:1].isupper())
    lead = plain(previous['parts']).strip()
    if lead.endswith(':'):
        return True  # any paragraph introducing a list ("… are solely responsible for:")
    return bool(re.match(r'^\d+\.\d+ ', lead)) and lead.endswith('.') and len(lead) < 80


def convert(key: str, path: Path):
    result = {'id': key, 'sections': []}
    section = None
    placeholders = []
    for kind, raw in paragraphs_of(path):
        text = brand(raw)
        if kind == 'title':
            result['title'] = text
            continue
        if kind == 'subtitle' and section is None:
            company, site = [piece.strip() for piece in text.split('·')]
            result['company'], result['site'] = company, site
            for found in PLACEHOLDER.findall(text):
                placeholders.append((found, 'Header'))
            continue
        if kind == 'heading':
            match = re.match(r'^(\d+)\.\s*(.*)$', text)
            section = {
                'id': slug(text),
                'number': match.group(1) if match else None,
                'title': match.group(2) if match else text,
                'blocks': [],
            }
            result['sections'].append(section)
            continue
        if section is None:
            raise SystemExit(f'{key}: text before the first heading: {text[:60]!r}')
        if kind == 'clause':
            section['blocks'].append({'type': 'p', 'parts': clause_parts(text)})
        elif starts_list_item(section['blocks'], text):
            if section['blocks'] and section['blocks'][-1]['type'] == 'list':
                section['blocks'][-1]['items'].append([text])
            else:
                section['blocks'].append({'type': 'list', 'items': [[text]]})
        else:  # a plain paragraph in the body size (a closing sentence, contact lines)
            section['blocks'].append({'type': 'p', 'parts': [text]})
        where = f"{section['number'] + '. ' if section['number'] else ''}{section['title']}"
        for found in PLACEHOLDER.findall(text):
            placeholders.append((found, where))

    result.update({'effectiveDate': DATE_PLACEHOLDER, 'version': VERSIONS[key], 'lastUpdated': DATE_PLACEHOLDER})
    placeholders.append((DATE_PLACEHOLDER, 'Header (effective date, last updated; not in the PDF)'))
    flat = json.dumps(result, ensure_ascii=False)
    if 'harbanao' in flat.lower():
        raise SystemExit(f'{key}: the old brand is left over')
    ordered = {name: result[name] for name in ['id', 'title', 'company', 'site', 'effectiveDate', 'version', 'lastUpdated', 'sections']}
    return ordered, placeholders


HEADER = """// Generated from docs/legal/{source} by scripts/convert_legal_docs.py (brand names
// replaced). Replace the PDF and rerun the script rather than editing by hand;
// docs/legal/README.md lists the [placeholders] still waiting for legal review.
"""

if __name__ == '__main__':
    for key, path in SOURCES.items():
        content, placeholders = convert(key, path)
        body = json.dumps(content, ensure_ascii=False, indent=2)
        module = HEADER.format(source=path.name) + f'const {key} = {body}\n\nexport default {key}\n'
        for app in ['professional', 'partner']:
            target = ROOT / app / 'frontend/src/features/legal/content' / f'{key}.js'
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(module, encoding='utf-8', newline='\n')
        seen = {}
        for found, where in placeholders:
            seen.setdefault(found, [])
            if where not in seen[found]:
                seen[found].append(where)
        blocks = sum(len(section['blocks']) for section in content['sections'])
        print(f"{key}: '{content['title']}' v{content['version']}, {len(content['sections'])} sections, {blocks} blocks, {len(seen)} placeholders")
        for found, wheres in seen.items():
            print(f'   {found}  ({"; ".join(wheres)})')
