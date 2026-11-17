"""Convert the legal Word files in docs/legal into the content both frontends render.

    python scripts/convert_legal_docs.py      (needs python-docx: pip install python-docx)

Run it after replacing a Word file; it rewrites professional/ and partner/ frontend
src/features/legal/content/{terms,privacy}.js. The wording is copied exactly; nothing is
replaced. The structure comes from the Word styles:
  Heading 1                     the title
  first two paragraphs after it  "CREWNBUILD · crewnbuild.com" and
                                 "Effective date: … · Version: … · Last updated: …"
  Heading 2                     a section ("1. Acceptance and Eligibility", "At a Glance")
  a numbered or bulleted para   a list item (a "1." list is kept ordered)
  any other paragraph           a paragraph
Bold runs stay bold. Each document is
{ id, title, company, site, effectiveDate, version, lastUpdated, sections: [{ id, number,
title, blocks: [{ type: 'p', parts } | { type: 'list', ordered, items: [parts] }] }] },
where parts is a list of strings and { b: string } for bold text.

The version printed in a document is the version an account accepts: when it changes, set
TERMS_VERSION / PRIVACY_VERSION in professional/backend/app/core/legal.py and
partner/backend/app/core/legal.py to match, in the same commit.
"""

import json
import re
from pathlib import Path

import docx

ROOT = Path(__file__).resolve().parents[1]
SOURCES = {
    'terms': ROOT / 'docs/legal/CREWNBUILD_Terms_and_Conditions.docx',
    'privacy': ROOT / 'docs/legal/CREWNBUILD_Privacy_Policy.docx',
}
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
PLACEHOLDER = re.compile(r'\[[^\[\]]+\]')


def list_formats(document) -> dict[str, str]:
    """numId -> the numFmt of its first level ('bullet', 'decimal', …)."""
    numbering = document.part.numbering_part.element
    abstract = {
        node.get(W + 'abstractNumId'): node.find(W + 'lvl').find(W + 'numFmt').get(W + 'val')
        for node in numbering.findall(W + 'abstractNum')
    }
    return {
        node.get(W + 'numId'): abstract.get(node.find(W + 'abstractNumId').get(W + 'val'), 'bullet')
        for node in numbering.findall(W + 'num')
    }


def list_format(paragraph, formats: dict[str, str]) -> str | None:
    properties = paragraph._p.pPr
    if properties is not None and properties.numPr is not None and properties.numPr.numId is not None:
        return formats.get(str(properties.numPr.numId.val), 'bullet')
    return 'bullet' if paragraph.style.name == 'List Paragraph' else None


def parts_of(paragraph) -> list:
    """The paragraph's runs, adjacent runs of the same weight merged; bold as { b }."""
    merged: list[list] = []
    for run in paragraph.runs:
        if not run.text:
            continue
        bold = bool(run.bold)
        if merged and merged[-1][1] == bold:
            merged[-1][0] += run.text
        else:
            merged.append([run.text, bold])
    if merged:
        merged[0][0] = merged[0][0].lstrip()
        merged[-1][0] = merged[-1][0].rstrip()
    return [{'b': text} if bold else text for text, bold in merged if text]


def plain(parts) -> str:
    return ''.join(part if isinstance(part, str) else part['b'] for part in parts)


def slug(title: str) -> str:
    text = re.sub(r'^\d+\.\s*', '', title).lower()
    return re.sub(r'[^a-z0-9]+', '-', text).strip('-')


def convert(key: str, path: Path) -> dict:
    document = docx.Document(str(path))
    formats = list_formats(document)
    result: dict = {'id': key, 'sections': []}
    header: list[str] = []
    section = None
    for paragraph in document.paragraphs:
        text = paragraph.text.strip()
        if not text:
            continue
        style = paragraph.style.name
        if style == 'Heading 1':
            result['title'] = text
            continue
        if style == 'Heading 2':
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
            header.append(text)
            continue
        parts = parts_of(paragraph)
        kind = list_format(paragraph, formats)
        if kind is None:
            section['blocks'].append({'type': 'p', 'parts': parts})
            continue
        ordered = kind == 'decimal'
        last = section['blocks'][-1] if section['blocks'] else None
        if last and last['type'] == 'list' and last['ordered'] == ordered:
            last['items'].append(parts)
        else:
            section['blocks'].append({'type': 'list', 'ordered': ordered, 'items': [parts]})

    if len(header) != 2:
        raise SystemExit(f'{key}: expected the company line and the dates line before the first section, got {header}')
    result['company'], result['site'] = [piece.strip() for piece in header[0].split('·')]
    fields = {
        name.strip(): value.strip() for name, value in (piece.split(':', 1) for piece in header[1].split('·'))
    }
    result['effectiveDate'] = fields['Effective date']
    result['version'] = fields['Version']
    result['lastUpdated'] = fields['Last updated']
    flat = json.dumps(result, ensure_ascii=False)
    if 'harbanao' in flat.lower():
        raise SystemExit(f'{key}: an old brand name is in the document')
    order = ['id', 'title', 'company', 'site', 'effectiveDate', 'version', 'lastUpdated', 'sections']
    return {name: result[name] for name in order}


HEADER = """// Generated from docs/legal/{source} by scripts/convert_legal_docs.py, word for word.
// Replace the Word file and rerun the script rather than editing this by hand.
"""

if __name__ == '__main__':
    for key, path in SOURCES.items():
        content = convert(key, path)
        body = json.dumps(content, ensure_ascii=False, indent=2)
        module = HEADER.format(source=path.name) + f'const {key} = {body}\n\nexport default {key}\n'
        for app in ['professional', 'partner']:
            target = ROOT / app / 'frontend/src/features/legal/content' / f'{key}.js'
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(module, encoding='utf-8', newline='\n')
        blocks = [block for section in content['sections'] for block in section['blocks']]
        lists = [block for block in blocks if block['type'] == 'list']
        texts = [plain(block['parts']) for block in blocks if block['type'] == 'p']
        texts += [plain(item) for block in lists for item in block['items']]
        placeholders = sorted({found for text in texts for found in PLACEHOLDER.findall(text)})
        print(
            f"{key}: '{content['title']}' version {content['version']}, effective {content['effectiveDate']}, "
            f"{len(content['sections'])} sections, {len(blocks)} blocks ({len(lists)} lists, "
            f"{sum(block['ordered'] for block in lists)} numbered), placeholders: {placeholders or 'none'}"
        )
