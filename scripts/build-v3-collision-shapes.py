from pathlib import Path
from PIL import Image
import hashlib, json, math

root = Path('dist/v3')
contacts = {}
# Visible row spans let an item's edge touch the opening without counting its
# transparent image padding. Coordinates use the rendered logical screen size.
for kind, width, height in [('coffee', 128, 128), ('sandwich', 100, 100), ('hotdog', 100, 100), ('red', 60, 60)]:
    path = root / 'assets' / f'item-{kind}.webp'
    image = Image.open(path).convert('RGBA')
    alpha = image.getchannel('A').load()
    rows = {}
    for y in range(image.height):
        xs = [x for x in range(image.width) if alpha[x, y] >= 24]
        if not xs:
            continue
        left = math.floor(((min(xs) / image.width - .5) * width - .5) * 2) / 2
        right = math.ceil((((max(xs) + 1) / image.width - .5) * width + .5) * 2) / 2
        top = math.floor((y / image.height - .5) * height * 2 + 1e-8)
        bottom = math.ceil(((y + 1) / image.height - .5) * height * 2 - 1e-8)
        for row in range(top, bottom):
            old = rows.get(row, [left, right])
            rows[row] = [min(old[0], left), max(old[1], right)]
    bands = []
    for row, (left, right) in sorted(rows.items()):
        top, bottom = row / 2, (row + 1) / 2
        if bands and bands[-1][0] == left and bands[-1][2] == right and bands[-1][3] == top:
            bands[-1][3] = bottom
        else:
            bands.append([left, top, right, bottom])
    for y in range(image.height - 1, -1, -1):
        xs = [x for x in range(image.width) if alpha[x, y] >= 24]
        if xs:
            contacts[kind] = {
                'x': round(((min(xs) + max(xs) + 1) / 2 / image.width - .5) * width, 3),
                'y': math.ceil(((y + 1) / image.height - .5) * height * 2 - 1e-8) / 2,
                'bands': bands,
                'bounds': [min(b[0] for b in bands), min(b[1] for b in bands), max(b[2] for b in bands), max(b[3] for b in bands)],
                'source': str(path.relative_to(root)),
                'sourceSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            }
            break
(root / 'collision-shapes.mjs').write_text(
    '// Visible row spans generated from the shipped 2× item sprites.\n'
    'export const ITEM_CONTACTS = ' + json.dumps(contacts, separators=(',', ':')) + ';\n'
)
print(contacts)
