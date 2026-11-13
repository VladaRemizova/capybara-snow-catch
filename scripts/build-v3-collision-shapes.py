from pathlib import Path
from PIL import Image
import json,hashlib,math
root=Path('dist/v3'); step=.5

def shape(name,width,height,offset_x,offset_y,pad_x=.5,pad_y=0):
 path=root/'assets'/f'{name}.webp';im=Image.open(path).convert('RGBA');alpha=im.getchannel('A');px=alpha.load();rows={}
 for y in range(im.height):
  xs=[x for x in range(im.width) if px[x,y]>=24]
  if not xs:continue
  left=math.floor((offset_x+min(xs)*width/im.width-pad_x)/step)*step
  right=math.ceil((offset_x+(max(xs)+1)*width/im.width+pad_x)/step)*step
  top=math.floor((offset_y+y*height/im.height-pad_y)/step)
  end=math.ceil((offset_y+(y+1)*height/im.height+pad_y)/step)
  for row in range(top,end):
   old=rows.get(row);rows[row]=[min(left,old[0]) if old else left,max(right,old[1]) if old else right]
 bands=[]
 for row,(left,right) in sorted(rows.items()):
  top=row*step;bottom=top+step
  if bands and bands[-1][0]==left and bands[-1][2]==right and bands[-1][3]==top:bands[-1][3]=bottom
  else:bands.append([left,top,right,bottom])
 bounds=[min(b[0] for b in bands),min(b[1] for b in bands),max(b[2] for b in bands),max(b[3] for b in bands)]
 return {'bounds':bounds,'bands':bands,'source':str(path.relative_to(root)),'sourceSha256':hashlib.sha256(path.read_bytes()).hexdigest()}
shapes={'character':{},'items':{}}
for pose in ['open','left','right']:
 shapes['character'][pose]=shape('capy-'+pose,146.5,217.346862,-73.25,0,pad_y=2.5)
for kind,w,h in [('coffee',128,128),('sandwich',100,100),('hotdog',100,100),('red',60,60)]:
 shapes['items'][kind]=shape('item-'+kind,w,h,-w/2,-h/2)
(root/'collision-shapes.mjs').write_text('// Collision bands come from the visible alpha of the shipped 2× sprites.\n// Half-pixel bands include antialiased edges; vertical padding covers the catch bounce.\nexport const SPRITE_SHAPES = '+json.dumps(shapes,separators=(',',':'))+';\n')
print({group:{key:{'bands':len(v['bands']),'bounds':v['bounds']} for key,v in vals.items()} for group,vals in shapes.items()})
