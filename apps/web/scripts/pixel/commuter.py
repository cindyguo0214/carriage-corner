# 角色設定頁的全身預覽：四套穿搭 × 男女，64×64 透明 PNG（四分之三側面朝右，大頭短身）
# 上班族是母版：每個角色的臉、髮型、站姿都沿用母版，只換服裝與配件。
# 頭頂在第 4 列、腳底在第 61 列，男女、各穿搭同一套置中與基準線，切換時像在原地換衣服。
import sys
from PIL import Image, ImageColor, ImageDraw

PAL = {
    'o': '#2f2724',  # 描邊
    'h': '#4b3830', 'H': '#3a2b25', 'j': '#62493d',  # 頭髮、暗、亮
    's': '#efcfb0', 'S': '#d9ad8c', 'b': '#e0a495', 'e': '#2f2724', 'm': '#a8675c',
    'J': '#6d7083', 'K': '#575a6b', 'L': '#858a9e',  # 灰藍西裝外套
    'w': '#eee3cf', 'W': '#d5c6ad', 'n': '#8f8577',  # 米白襯衫、扣子
    'p': '#47403f', 'P': '#36302f',  # 深灰裙／褲
    'f': '#4a362c', 'F': '#2f2724',  # 鞋
    'g': '#7d5b45', 'G': '#614535', 'y': '#c9a46a',  # 棕色肩背包、扣環
    't': '#5c4234',  # 背帶
    'k': '#e9e1d3', 'x': '#b9b0a3',  # 球鞋、鞋底
}

def grid(rows, w=None):
    w = w or len(rows[0])
    for i, r in enumerate(rows):
        assert len(r) == w, (i, r, len(r), w)
    return rows

def paste(img, rows, x0, y0, pal=None):
    pal = {**PAL, **(pal or {})}
    px = img.load()
    for y, r in enumerate(rows):
        for x, c in enumerate(r):
            if c != '.':
                px[x0 + x, y0 + y] = ImageColor.getrgb(pal[c]) + (255,)

HEAD_M = grid([
#    0123456789012345678901
    '......oooooooooo......',
    '....oohhhhhjjhhhoo....',
    '...ohhhhhhjjhhhhhho...',
    '..ohhHhhhjjhhhhhhhho..',
    '.oHhhHhhhhhHhhhhhhhho.',
    '.oHhhhHhhhhhHhhhhhhhho',
    'oHHhhhhHhhhhhHhhhhHhho',
    'oHHhhhhhHhhhhhHhhhhHho',
    'oHHhhhhhhhhhhhhhhhhhho',
    'oHHhhhhhhhhhhhhhhhhhho',
    'oHHhhhhhhhshhhhshhhhho',
    'oHHhhhhhhssshhssshhsso',
    'oHHhhhhoSseesssseessso',
    'oHHhhhhoSseesssseessso',
    'oHHhhhhoSseesssseessso',
    '.oHhhhhoSbbssssssssss o'.replace(' ', ''),
    '.oHHhhoSSssssssmsssso.',
    '..oHHooSssssssssssso..',
    '......oSSsssssssoo....',
    '.......ooooooooo......',
])

# 女生頭：左側多 4 欄放低馬尾；側瀏海往右斜，右側一撮髮絲垂到臉頰
HEAD_F = grid([
#    01234567890123456789012345
    '..........oooooooooo......',
    '........oohhhhhhjhhhoo....',
    '.......ohhhhhhjjhhhhhho...',
    '......ohhhhhhjjhhhhhhhho..',
    '.....oHhhhhhhhhhhhhhhhhho.',
    '.....oHhhhhhhhhhhhhhhhhhho',
    '....oHHhhhhhhhhhhhhhhhhhho',
    '....oHHhhhhhhhhhhhhhhhhhho',
    '....oHHhhhhhhhhhhhhhhhhhho',
    '....oHHhhhhhhssHhhhhhhhhho',
    '....oHHhhhhhhssssHhhhhhhho',
    '....oHHhhhhhhssssssHhhhhho',
    '....oHHhhhhhSsoossssoosHho',
    '....oHHhhhhhSseesssseesHho',
    '..ooHHHhhhhhSseesssseesHho',
    '.oHHoHHhhhhhSseesssseesHho',
    'oHhHHoHhhhhhSbbsssssssshho',
    'oHhhHHhhhhhhSssssssmsssHo.',
    'oHhhhoHhhhhoSssssssssssoo.',
    '.oHhhoooooooSSsssssssoo...',
    '.oHhho.....ooooooooooo....',
    '..oHo.....................',
    '...o......................',
])

TORSO = grid([
#    0123456789012345678901
    '.....oooooowSSwoooo...',
    '...ooJJJtJowwwwoJJJoo.',
    '..oKJJJJtJJowwWoJJJLo.',
    '.oKJJJJJtJJowwwoKJJLLo',
    '.oKJJJJotooJwwwoKJJLLo',
    '.oKJJJossssoownoKJJLLo',
    '.oKJJKLSsssoowwoKJJoLo',
    '.oKJKLJoSSoJowwoKJJoLo',
    '.oKKLJJJooJJowwoKJJoLo',
    '.oKLJJJJoJJJownoKJJoLo',
    '.oKLJJJJoJJJowwoKJJoLo',
    '.oKKKKKKoJJJowwoKJJoLo',
    'oooooooooJJJowwoKJJoLo',
    'ogggggggoJJJownoKJJoLo',
    'ogggggggoJJJowwoKJJoLo',
    'oGGGyGGGoJJJowwoKJJoso',
    'ogggggggoJJJowwoKJJoso',
    'ogggggggoJJJownoKJJoSo',
    'oGGGGGGGoKKKoWWoKKKooo',
    'oooooooooooooooooooo..',
])

# 男生：深灰長褲＋深色鞋
LEGS_M = grid([
#    012345678901234
    '.opppppppppppo.',
    '.opppppppPpppo.',
    '.oppppPoppppPo.',
    '.oppppPoppppPo.',
    '.oppppPoppppPo.',
    '.oppppPoppppPo.',
    '.oppppPoppppPo.',
    '.oppppPoppppPo.',
    '.oppppPoppppPo.',
    '.oppppPoppppPo.',
    '.oppppPoppppPo.',
    '.oppppPoppppPo.',
    '.oppppPoppppPo.',
    '.oppppPoppppPo.',
    '.offffo.offffo.',
    '.offfffoofffffo',
    '.offfffoofffffo',
    '..ooooo..oooooo',
])

# 女生：深灰裙＋腿＋深色鞋
LEGS_F = grid([
#    012345678901234
    '.opppppppppppo.',
    '.opppppppPpppo.',
    '.opppppppPpppo.',
    '.opppppppPpppo.',
    '.opppppppPpppo.',
    '.opppppppPpppo.',
    '..oppppppPppo..',
    '..oppppppPppo..',
    '..ooooooooooo..',
    '...ossSoossSo..',
    '...ossSoossSo..',
    '...ossSoossSo..',
    '...ossSoossSo..',
    '...ossSoossSo..',
    '...ossSoossSo..',
    '...offfoofffo..',
    '...offffooffffo'[:15],
    '....oooo..ooooo'[:15],
])

DX = 1  # 讓角色置中

# ── 學生：米白襯衫＋燕麥色針織背心、背在背上的磚紅圓角書包（手抓的是書包背帶） ──
TORSO_STUDENT = grid([
#    0123456789012345678901
    '.....oooooowSSwoooo...',
    '...oowwwtwowwwwowwwoo.',
    '..oWwwwwtwvowwWovvowo.',
    '.oWwwwwwtwvowwwovvvowo',
    '.oWwwwwotoovowovvvvowo',
    '.oWwwwossssovovvvvvowo',
    '.oWwwWwSsssovvvvvvvowo',
    '.oWwWwwoSSovvvvvvvvowo',
    '.oWWwwwwoovvvvvvvvvowo',
    '.oWwwwwwovvvvvvvvvvowo',
    '.oWwwwwwovvvvvvvvvvowo',
    '.oWWWWWWovvvvvvvvvvowo',
    '.oooooooovvvvvvvvvvowo',
    '..ovvvvvvvvvvvvvvvvowo',
    '..oVvvvvvvvvvvvvvvvowo',
    '..oVvvvvvvvvvvvvvvvoso',
    '..ouuuuuuuuuuuuuuuuoso',
    '..ouuuuuuuuuuuuuuuuoSo',
    '..owwwwwwwwwwwwwwwwooo',
    '..oooooooooooooooooo..',
])

# 背上的圓角書包：畫在身體後面，從背側（畫面左邊）露出輪廓
BACKPACK = grid([
#    012345678
    '..ooooo..',
    '.oqgggggo',
    'oqgggggGo',
    'oggggggGo',
    'oGGGGGGGo',
    'ogggyggGo',
    'oGggggggo',
    'oGggggggo',
    'oGggggggo',
    'oGggggggo',
    'oGggggggo',
    'oGggggggo',
    'oGGgggggo',
    '.oGGGGGo.',
    '..ooooo..',
])
# 背心側面與中線的織紋
TORSO_STUDENT = [r[:13] + ('V' if 4 <= i <= 15 and r[13] == 'v' and i % 2 == 0 else r[13]) + r[14:17]
                 + ('V' if r[17] == 'v' else r[17]) + r[18:] for i, r in enumerate(TORSO_STUDENT)]

# 女生學生：深灰百褶裙、短襪、樂福鞋
LEGS_F_STUDENT = grid([
#    012345678901234
    '.opppppppppppo.',
    '.oppPppPppPppo.',
    '.oppPppPppPppo.',
    '.oppPppPppPppo.',
    '.oppPppPppPppo.',
    'opPppPppPppPppo',
    'opPppPppPppPppo',
    'ooooooooooooooo',
    '...ossSoossSo..',
    '...ossSoossSo..',
    '...ossSoossSo..',
    '...ossSoossSo..',
    '...ossSoossSo..',
    '...owwWoowwWo..',
    '...owwWoowwWo..',
    '...offfoofffo..',
    '...offffooffffo',
    '....oooo..ooooo',
])

# ── 連帽外套：灰綠套頭帽 T（帽子放下堆在頸後）、帆布托特包 ──
TORSO_HOODIE = grid([
#    0123456789012345678901
    '....ooQQQQoSSoQQQo....',
    '...oJQQQtQQQQQQQQJJoo.',
    '..oKJJJJtJQQwQwQJJJLo.',
    '.oKJJJJJtJJJwJwJKJJLLo',
    '.oKJJJJotooJwJwJKJJLLo',
    '.oKJJJossssowJwJKJJLLo',
    '.oKJJKLSsssowJwJKJJoLo',
    '.oKJKLJoSSoJJJJJKJJoLo',
    '.oKKLJJJooJJJJJJKJJoLo',
    '.oKLJJJJoJJJJJJJKJJoLo',
    '.oKLJJJJoJKKKKKKKJJoLo',
    '.oKKKKKKoJKJJJJJKJJoLo',
    'oooooooooJKJJJJJKJJoLo',
    'ogggggggoJKJJJJJKJJoLo',
    'ogggggggoJKKKKKKKJJoro',
    'oyyyyyyyoJJJJJJJKJJoso',
    'ogggggggoJJJJJJJKJJoso',
    'ogggggggorrrrrrrrrroSo',
    'oGGGGGGGoRRRRRRRRRRooo',
    'oooooooooooooooooooo..',
])

# 垂在後頸與肩上的帽兜：畫在身體後面，從背側露出圓弧輪廓與深色內裡
HOOD = grid([
#    012345678
    '..ooooo..',
    '.oQQQQQo.',
    'oJQQQQQJo',
    'oLJQQQJJo',
    'oLJJJJJJo',
    'oLJJJJJJo',
    'oKJJJJJJo',
    '.oKJJJJo.',
    '.oKJJJJo.',
    '..oKKJo..',
    '...ooo...',
])

# ── 耳機族：陶土色輕便外套、米白條紋 T、深灰綠斜背包 ──
TORSO_HEADPHONES = [
    r if i < 2 else r.replace('n', 'w').replace('w', 'z' if i % 2 else 'w')
    for i, r in enumerate(TORSO)
]

# 長褲＋球鞋（連帽外套、耳機族男女共用）
LEGS_PANTS = grid(LEGS_M[:14] + [
#    012345678901234
    '.okkkko.okkkko.',
    '.okkkkkookkkkko',
    '.oxxxxxooxxxxxo',
    '..ooooo..oooooo',
])

def headphones(head_w, dx):
    """包耳式耳機：近側耳罩蓋在耳朵上，頭帶越過頭頂往遠側收進頭後（dx：女生頭左側多出的欄數）"""
    band = [(7, 9), (7, 8), (7, 7), (8, 6), (8, 5), (9, 4), (10, 3), (11, 2), (12, 2), (13, 1), (14, 1),
            (15, 1), (16, 1), (17, 2), (18, 2), (19, 3), (20, 4)]
    cup = {(x, y) for x in range(5, 9) for y in range(11, 16)}
    cells = {}
    for x, y in band:
        cells[(x, y)] = 'a'
    for x, y in cup:
        cells[(x, y)] = 'C' if x == 8 or y == 15 else 'c'
    cells[(5, 11)] = 'A'  # 耳罩高光
    out = dict(cells)
    for x, y in cells:
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if (nx, ny) not in cells and 0 <= nx < 22 and 0 <= ny < 20:
                out[(nx, ny)] = 'o'
    for corner in ((4, 10), (9, 10), (4, 16), (9, 16)):
        out.pop(corner, None)
    rows = [['.'] * head_w for _ in range(20)]
    for (x, y), c in out.items():
        rows[y][x + dx] = c
    return [''.join(r) for r in rows]

PANTS = {'p': '#8a8178', 'P': '#746c64'}
OUTFITS = {
    'office': dict(torso=TORSO, legs={'f': LEGS_F, 'm': LEGS_M}),
    'student': dict(torso=TORSO_STUDENT, legs={'f': LEGS_F_STUDENT, 'm': LEGS_M}, pal={
        'v': '#b9a78c', 'V': '#a39177', 'u': '#a8967c',
        'g': '#9c6b5f', 'G': '#7f5549', 'q': '#b28377', 'y': '#d1b27a', 't': '#7f5549',
    }, back=(BACKPACK, 16, 25)),
    'hoodie': dict(torso=TORSO_HOODIE, legs={'f': LEGS_PANTS, 'm': LEGS_PANTS}, pal={
        'J': '#7d8877', 'K': '#677161', 'L': '#95a08d', 'Q': '#5f6a5b', 'r': '#6f7a69', 'R': '#5c6657',
        'g': '#cdbb9c', 'G': '#b09d7f', 'y': '#8f8a73', 't': '#a8957a', **PANTS,
    }, back=(HOOD, 16, 23)),
    'headphones': dict(torso=TORSO_HEADPHONES, legs={'f': LEGS_PANTS, 'm': LEGS_PANTS}, phones=True, pal={
        'J': '#ad806b', 'K': '#926957', 'L': '#c2957f', 'z': '#7a8290',
        'g': '#636b66', 'G': '#4f5652', 'y': '#a9b0a8', 't': '#4f5652',
        'p': '#5f6b7a', 'P': '#4f5a68', 'k': '#5a5655', 'x': '#e9e1d3',
        'a': '#bcb8b2', 'A': '#f6f0e4', 'c': '#ddd1bd', 'C': '#b9ab95',
    }),
}
HEADS = {'f': (HEAD_F, 17, 4), 'm': (HEAD_M, 21, 0)}  # 頭的字元圖、左上角 x、左側多出的欄數

def build(outfit, gender):
    o = OUTFITS[outfit]
    head, hx, extra = HEADS[gender]
    pal = o.get('pal')
    img = Image.new('RGBA', (64, 64), (0, 0, 0, 0))
    legs = o['legs'][gender]
    paste(img, legs, 24 + DX, 64 - 2 - len(legs), pal)
    if o.get('back'):  # 背在身後的書包、帽兜
        back, bx, by = o['back']
        paste(img, back, bx + DX, by, pal)
    paste(img, o['torso'], 20 + DX, 24, pal)
    paste(img, head, hx + DX, 4, pal)
    if o.get('phones'):
        paste(img, headphones(len(head[0]), extra), hx + DX, 4, pal)
    return img

EYE_TOP, HEAD_TOP, FEET = 16, 4, 62

def preview(rows, path, k=6, gap=12):
    """每列一個角色、四套穿搭並排；淡線標出頭頂、眼睛上緣與腳底，檢查高度與大小一致"""
    w = 64 * k
    cols = max(len(r) for r in rows)
    out = Image.new('RGBA', (cols * (w + gap) - gap, len(rows) * (w + gap) - gap), '#f8f3ea')
    draw = ImageDraw.Draw(out)
    for j, row in enumerate(rows):
        y0 = j * (w + gap)
        for y in (HEAD_TOP, EYE_TOP, FEET):
            draw.line([(0, y0 + y * k), (out.width, y0 + y * k)], fill='#e3b8a8', width=1)
        for i, im in enumerate(row):
            out.alpha_composite(im.resize((w, w), Image.NEAREST), (i * (w + gap), y0))
    out.save(path)

if __name__ == '__main__':
    # 用法：python commuter.py <輸出資料夾> [放大預覽.png]
    out = sys.argv[1]
    names = {'f': 'female', 'm': 'male'}
    rows = []
    for g in ('f', 'm'):
        row = []
        for outfit in OUTFITS:
            im = build(outfit, g)
            im.save(f'{out}/commuter-{outfit}-{names[g]}.png')
            row.append(im)
        rows.append(row)
    if len(sys.argv) > 2:
        preview(rows, sys.argv[2])
