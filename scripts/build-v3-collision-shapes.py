from pathlib import Path
from PIL import Image
import hashlib, json, math

root = Path('dist/v3')
contacts = {}
# The bottommost opaque row is the first visible part to enter the sack.
# Coordinates use each item's rendered size, excluding transparent padding.
for kind, width, height in [('coffee', 128, 128), ('sandwich', 100, 100), ('hotdog', 100, 100), ('red', 60, 60)]:
    path = root / 'assets' / f'item-{kind}.webp'
    image = Image.open(path).convert('RGBA')
    alpha = image.getchannel('A').load()
    for y in range(image.height - 1, -1, -1):
        xs = [x for x in range(image.width) if alpha[x, y] >= 24]
        if xs:
            contacts[kind] = {
                'x': round(((min(xs) + max(xs) + 1) / 2 / image.width - .5) * width, 3),
                'y': math.ceil(((y + 1) / image.height - .5) * height * 2 - 1e-8) / 2,
                'source': str(path.relative_to(root)),
                'sourceSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            }
            break
(root / 'collision-shapes.mjs').write_text(
    '// Leading visible contact points generated from the shipped 2× item sprites.\n'
    'export const ITEM_CONTACTS = ' + json.dumps(contacts, separators=(',', ':')) + ';\n'
)
print(contacts)
