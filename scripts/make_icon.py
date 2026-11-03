# 產生程式圖示：陸海空三色徽章（戰鬥機、船錨、陸軍星）＋立體「三軍」棋子＋戴軍帽的小柯機器人
import math
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = 1024


def font(size):
    for f in ('C:/Windows/Fonts/kaiu.ttf', 'C:/Windows/Fonts/msjhbd.ttc', '/System/Library/Fonts/Supplemental/Songti.ttc'):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def layer():
    return Image.new('RGBA', (S, S), (0, 0, 0, 0))


def star(d, cx, cy, R, fill):
    pts = []
    for k in range(10):
        a = -math.pi / 2 + k * math.pi / 5
        r = R if k % 2 == 0 else R * 0.42
        pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
    d.polygon(pts, fill=fill)


img = layer()

# ---- 三色徽章：上方天空（空軍）、左下海洋（海軍）、右下陸地（陸軍）----
ecx, ecy, ER = 430, 420, 360
sh = layer()
ImageDraw.Draw(sh).ellipse((ecx - ER + 10, ecy - ER + 24, ecx + ER + 10, ecy + ER + 24), fill=(0, 0, 0, 140))
img = Image.alpha_composite(img, sh.filter(ImageFilter.GaussianBlur(26)))
em = layer()
e = ImageDraw.Draw(em)
box = (ecx - ER, ecy - ER, ecx + ER, ecy + ER)
e.pieslice(box, 210, 330, fill=(88, 182, 240, 255))    # 天空
e.pieslice(box, 90, 210, fill=(24, 92, 168, 255))      # 海洋
e.pieslice(box, -30, 90, fill=(108, 140, 58, 255))     # 陸地
# 分隔線
for a in (90, 210, 330):
    r = math.radians(a)
    e.line((ecx, ecy, ecx + math.cos(r) * ER, ecy + math.sin(r) * ER), fill=(255, 236, 170, 255), width=14)
e.ellipse(box, outline=(240, 196, 60, 255), width=30)
e.ellipse((ecx - ER + 34, ecy - ER + 34, ecx + ER - 34, ecy + ER - 34), outline=(255, 240, 190, 200), width=6)
# 戰鬥機（天空）
px, py = ecx - 10, ecy - 220
plane = [(px, py - 95), (px + 16, py - 40), (px + 16, py - 10), (px + 120, py + 40), (px + 120, py + 62), (px + 16, py + 34), (px + 12, py + 82),
         (px + 46, py + 104), (px + 46, py + 120), (px, py + 106), (px - 46, py + 120), (px - 46, py + 104), (px - 12, py + 82), (px - 16, py + 34),
         (px - 120, py + 62), (px - 120, py + 40), (px - 16, py - 10), (px - 16, py - 40)]
e.polygon(plane, fill=(255, 255, 255, 255))
# 船錨（海洋）
ax, ay = ecx - 185, ecy + 40
w = (255, 255, 255, 255)
e.ellipse((ax - 26, ay - 132, ax + 26, ay - 80), outline=w, width=14)
e.line((ax, ay - 80, ax, ay + 96), fill=w, width=22)
e.line((ax - 60, ay - 44, ax + 60, ay - 44), fill=w, width=18)
e.arc((ax - 100, ay - 20, ax + 100, ay + 112), 20, 160, fill=w, width=20)
e.polygon([(ax - 108, ay + 30), (ax - 84, ay + 66), (ax - 120, ay + 70)], fill=w)
e.polygon([(ax + 108, ay + 30), (ax + 84, ay + 66), (ax + 120, ay + 70)], fill=w)
# 陸軍：金色大星
star(e, ecx + 175, ecy + 115, 92, (255, 214, 70, 255))
img = Image.alpha_composite(img, em)

# ---- 立體「三軍」棋子 ----
sh = layer()
ImageDraw.Draw(sh).rounded_rectangle((70, 620, 560, 960), 60, fill=(0, 0, 0, 150))
img = Image.alpha_composite(img, sh.filter(ImageFilter.GaussianBlur(24)))
tile = layer()
d = ImageDraw.Draw(tile)
d.rounded_rectangle((56, 630, 556, 950), 60, fill=(150, 24, 30, 255))
d.rounded_rectangle((56, 604, 556, 900), 60, fill=(198, 40, 40, 255))
d.rounded_rectangle((40, 578, 540, 862), 56, fill=(252, 247, 232, 255))
d.rounded_rectangle((70, 606, 510, 834), 38, outline=(198, 40, 40, 255), width=13)
d.text((290, 722), '三軍', font=font(196), fill=(198, 40, 40, 255), anchor='mm', stroke_width=6, stroke_fill=(198, 40, 40, 255))
tile = tile.rotate(-5, resample=Image.BICUBIC, center=(300, 760))
img = Image.alpha_composite(img, tile)

# ---- 小柯機器人（戴軍帽、敬禮）----
rb = layer()
r = ImageDraw.Draw(rb)
cx, cy = 512, 560
r.rounded_rectangle((cx - 262, cy - 60, cx - 210, cy + 90), 22, fill=(40, 120, 220, 255))
r.rounded_rectangle((cx + 210, cy - 60, cx + 262, cy + 90), 22, fill=(40, 120, 220, 255))
r.ellipse((cx - 230, cy - 200, cx + 230, cy + 230), fill=(70, 150, 240, 255))
r.ellipse((cx - 214, cy - 186, cx + 214, cy + 210), fill=(240, 246, 255, 255))
r.rounded_rectangle((cx - 170, cy - 90, cx + 170, cy + 110), 90, fill=(24, 36, 64, 255))
for ex in (cx - 72, cx + 72):
    r.arc((ex - 46, cy - 30, ex + 46, cy + 50), 200, 340, fill=(90, 230, 255, 255), width=22)
r.arc((cx - 50, cy + 30, cx + 50, cy + 90), 20, 160, fill=(90, 230, 255, 255), width=14)
r.ellipse((cx - 160, cy + 60, cx - 110, cy + 100), fill=(255, 140, 160, 200))
r.ellipse((cx + 110, cy + 60, cx + 160, cy + 100), fill=(255, 140, 160, 200))
# 軍帽（深藍海軍色帽頂＋金邊）
r.ellipse((cx - 250, cy - 330, cx + 250, cy - 120), fill=(30, 52, 96, 255))
r.rounded_rectangle((cx - 200, cy - 250, cx + 200, cy - 120), 40, fill=(40, 66, 118, 255))
r.rounded_rectangle((cx - 210, cy - 150, cx + 210, cy - 108), 20, fill=(240, 196, 60, 255))
r.pieslice((cx - 170, cy - 150, cx + 170, cy - 40), 0, 180, fill=(20, 28, 48, 255))
r.ellipse((cx - 56, cy - 282, cx + 56, cy - 170), fill=(240, 196, 60, 255), outline=(255, 240, 180, 255), width=6)
r.text((cx, cy - 226), '柯', font=font(70), fill=(120, 70, 10, 255), anchor='mm')
r.rounded_rectangle((cx + 190, cy - 180, cx + 290, cy - 90), 30, fill=(70, 150, 240, 255))
sh2 = layer()
ImageDraw.Draw(sh2).ellipse((cx - 230, cy - 170, cx + 250, cy + 270), fill=(0, 0, 0, 120))
rb = Image.alpha_composite(sh2.filter(ImageFilter.GaussianBlur(24)), rb)
k = 0.72
rb = rb.resize((int(S * k), int(S * k)), Image.LANCZOS)
img.alpha_composite(rb, (int(800 - 512 * k), int(640 - 560 * k)))

os.makedirs(os.path.join(ROOT, 'build'), exist_ok=True)
img.save(os.path.join(ROOT, 'build', 'icon.png'))
img.save(os.path.join(ROOT, 'build', 'icon.ico'), sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
img.resize((256, 256), Image.LANCZOS).save(os.path.join(ROOT, 'assets', 'icon-256.png'))
print('ok')
