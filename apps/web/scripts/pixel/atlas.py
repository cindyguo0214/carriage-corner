# 遊戲內的角色圖集：照角色設定頁全身預覽圖（commuter.py）的畫風重畫正面與背面的所有動作。
# 6 種角色（4 套穿搭＋長者、家長）× 男女 × 正面／背面 = 24 列，每列 17 幀，每格 64×64。
# 列與欄的順序要和 apps/web/src/game/characters.ts 的 ALL_AVATARS、GENDERS、VIEWS、FRAMES 一致。
# 用法：python atlas.py <輸出 atlas.png> [放大預覽.png]
import sys
from PIL import Image, ImageColor, ImageDraw
from commuter import PAL as BASE_PAL, grid

CELL = 64
AVATARS = ['office', 'student', 'hoodie', 'headphone', 'elder', 'parent']
GENDERS = ['m', 'f']
VIEWS = ['front', 'back']
FRAMES = [('idle', 2), ('music', 2), ('read', 3), ('sleep', 4), ('stand', 2), ('walk', 2), ('hang', 2)]
STANDING = {'stand', 'walk', 'hang'}

X0 = 21  # 頭、軀幹、腿字元圖（22 欄寬）的左緣

class Cell:
    """一格 64×64：用字元繪圖，最後依色票上色"""
    def __init__(self):
        self.px = {}

    def paste(self, rows, x0, y0):
        for y, r in enumerate(rows):
            for x, c in enumerate(r):
                if c != '.' and 0 <= x0 + x < CELL and 0 <= y0 + y < CELL:
                    self.px[(x0 + x, y0 + y)] = c

    def put(self, x, y, c):
        if 0 <= x < CELL and 0 <= y < CELL:
            self.px[(x, y)] = c

    def clear(self, x, y):
        self.px.pop((x, y), None)

    def image(self, pal):
        img = Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0))
        for (x, y), c in self.px.items():
            img.putpixel((x, y), ImageColor.getrgb(pal[c]) + (255,))
        return img

def outlined(cell, pixels):
    """畫一組像素，並在外圍自動補上一圈描邊"""
    for (x, y), c in pixels.items():
        cell.put(x, y, c)
    for (x, y) in pixels:
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if (nx, ny) not in pixels:
                cell.put(nx, ny, 'o')

# ───────────────────────── 頭 ─────────────────────────

HEAD_M_FRONT = grid([
#    0123456789012345678901
    '......oooooooooo......',
    '....oohhhhhjjhhhoo....',
    '...ohhhhhhjjhhhhhho...',
    '..ohhHhhhjjhhhhhhhho..',
    '.oHhhhHhhhhHhhhhhhhHo.',
    '.oHhhhhHhhhhHhhhhhhHo.',
    'oHHhhhhhHhhhhHhhhhhHHo',
    'oHHhhhhhhhhhhhhhhhhHHo',
    'oHHhhhhhhhhhhhhhhhhHHo',
    'oHHhhhhhhhshhhhshhhHHo',
    'oHhhssshssssshhssshhHo',
    'oHhsssssssssssssssshHo',
    'ohSsssseesssseessssSho',
    'ohSsssseesssseessssSho',
    'ohSsssseesssseessssSho',
    'ohSsbbssssssssssbbsSho',
    '.oSssssssssmsssssssSo.',
    '..oSssssssssssssssSo..',
    '...ooSSssssssssSSoo...',
    '.....oooooooooooo.....',
])

HEAD_F_FRONT = grid([
#    0123456789012345678901
    '......oooooooooo......',
    '....oohhhhhhjhhhoo....',
    '...ohhhhhhhjjhhhhho...',
    '..ohhhhhhhjjhhhhhhho..',
    '.ohhhhhhhhhhhhhhhhhho.',
    '.oHhhhhhhhhhhhhhhhhHo.',
    'oHHhhhhhhhhhhhhhhhhHHo',
    'oHHhhhhhhhhhhhhhhhhHHo',
    'oHHhhhhhhhhhhhhhhhhHHo',
    'oHHhsshhhhhhhhhhhhhHHo',
    'oHHssssshhhhhhhhhhhHHo',
    'oHhsssssssssssHhhhhhHo',
    'oHhssssoossssoossshhHo',
    'oHhsssseesssseessshhHo',
    'oHhsssseesssseessshhHo',
    'oHhsssseesssseessshhHo',
    'oHhsbbssssssssbbsshhHo',
    'oHhssssssmsssssssshhHo',
    'oHHoSssssssssssssoHHHo',
    '.ooo.oooooooooooo.ooo.',
])

HEAD_M_BACK = grid([
#    0123456789012345678901
    '......oooooooooo......',
    '....oohhhhhjjhhhoo....',
    '...ohhhhhhjjhhhhhho...',
    '..ohhhhhhjjhhhhhhhho..',
    '.ohhhhhhhhhhhhhhhhhho.',
    '.oHhhhhhhhhhhhhhhhhHo.',
    'oHHhhhhhhhhhhhhhhhhHHo',
    'oHHhhhhhhhhhhhhhhhhHHo',
    'oHHhhhhhhhhhhhhhhhhHHo',
    'oHHhhhhhhhhhhhhhhhhHHo',
    'oHHhhhhhhhhhhhhhhhhHHo',
    'oHHhhhhhhhhhhhhhhhhHHo',
    'oSHhhhhhhhhhhhhhhhhHSo',
    'oSHhhhhhhhhhhhhhhhhHSo',
    'oSHHhhhhhhhhhhhhhhHHSo',
    '.oHHHhhhhhhhhhhhhHHHo.',
    '..oHHHHhhhhhhhhHHHHo..',
    '...ooHHHHHHHHHHHHoo...',
    '.....ooSSSSSSSSoo.....',
    '.......oSSSSSSo.......',
])

# 女生背面：低馬尾垂在後頸（比頭多 4 列，畫在軀幹上面）
HEAD_F_BACK = grid([
#    0123456789012345678901
    '......oooooooooo......',
    '....oohhhhhjjhhhoo....',
    '...ohhhhhhjjhhhhhho...',
    '..ohhhhhhjjhhhhhhhho..',
    '.ohhhhhhhhhhhhhhhhhho.',
    '.oHhhhhhhhhhhhhhhhhHo.',
    'oHHhhhhhhhHhhhhhhhhHHo',
    'oHHhhhhhhhHhhhhhhhhHHo',
    'oHHhhhhhhhHhhhhhhhhHHo',
    'oHHhhhhhhhHhhhhhhhhHHo',
    'oHHhhhhhhhHhhhhhhhhHHo',
    'oHHhhhhhhhhHhhhhhhhHHo',
    'oHHHhhhhhhhHhhhhhhHHHo',
    'oHHHhhhhhhhhhhhhhhHHHo',
    '.oHHHhhhhhhhhhhhhHHHo.',
    '..oHHHHhhhhhhhhHHHHo..',
    '...ooHHHHooooHHHHoo...',
    '......oooHHHHooo......',
    '........oHhhHo........',
    '........ohhhHo........',
    '........oHhhHo........',
    '........ohhHHo........',
    '.........oHHo.........',
    '..........oo..........',
])

# 長者：阿公戴鴨舌帽（灰白短髮）、阿嬤灰白燙捲
CAP_FRONT = grid([
#    0123456789012345678901
    '.....oooooooooooo.....',
    '...ooccccccccccccoo...',
    '..occCcccccccccccCco..',
    '.occccccccccccccccco..'[:22],
    '.oCCCCCCCCCCCCCCCCCCo.',
    'oooooooooooooooooooooo',
])
CAP_BACK = grid([
#    0123456789012345678901
    '.....oooooooooooo.....',
    '...ooccccccccccccoo...',
    '..occccccccccccccccco.'[:22],
    '.occcccccCCcccccccco..'[:22],
    '.oCCCCCCCCCCCCCCCCCCo.',
    '.oooooooooooooooooooo.',
])
PERM_FRONT = grid([
#    0123456789012345678901
    '....oo.oo.oo.oo.oo....',
    '...ohhohhohhohhohho...',
    '..ohhhhhhhhhhhhhhhho..',
    '.ohhjhhhhhjhhhhhjhhho.',
    'ohhhhhhhhhhhhhhhhhhhho',
    'ohHhhhHhhhhHhhhhHhhhho',
    'ohhhhhhhhhhhhhhhhhhhho',
    'oHhhhhhhhhhhhhhhhhhhHo',
    'oHhhsshhhsshhhhsshhhHo',
])
PERM_BACK = grid([
#    0123456789012345678901
    '....oo.oo.oo.oo.oo....',
    '...ohhohhohhohhohho...',
    '..ohhhhhhhhhhhhhhhho..',
    '.ohhjhhhhhjhhhhhjhhho.',
    'ohhhhhhhhhhhhhhhhhhhho',
    'ohHhhhHhhhhHhhhhHhhhho',
    'ohhhhhhhhhhhhhhhhhhhho',
    'oHhhhHhhhhhHhhhhHhhhHo',
    'oHhhhhhhhhhhhhhhhhhhHo',
    'oHHhHhhhHhhhhHhhhHhHHo',
    'oHHhhhhhhhhhhhhhhhhHHo',
    'oHHHhHhhhHhhhhHhhHHHHo',
    'oSHHhhhhhhhhhhhhhhHHSo',
    'oSHHHhHhhhHhhhHhHHHHSo',
    '.oHHHHhhhhhhhhhhHHHHo.',
    '..ooHHHHhHHhHHHHHoo...',
    '....oooooooooooooo....',
])

def head_rows(avatar, gender, view):
    if avatar == 'elder' and gender == 'f':
        if view == 'front':
            base = list(HEAD_M_FRONT)
            return PERM_FRONT + base[len(PERM_FRONT):], 0
        return list(PERM_BACK) + list(HEAD_M_BACK[len(PERM_BACK):]), 0
    if gender == 'f' and avatar != 'elder':
        return (HEAD_F_FRONT if view == 'front' else HEAD_F_BACK), 0
    return (HEAD_M_FRONT if view == 'front' else HEAD_M_BACK), 0

def set_eyes(rows, eyes):
    """眼睛：open 原樣；down／closed 改成眼睛最下一列的一條線（女生的睫毛線也收掉）"""
    if eyes == 'open':
        return rows
    rows = [list(r) for r in rows]
    eye_rows = [y for y, r in enumerate(rows) if 'e' in r]
    if not eye_rows:
        return [''.join(r) for r in rows]
    top, bottom = eye_rows[0], eye_rows[-1]
    for y in eye_rows:
        for x, c in enumerate(rows[y]):
            if c == 'e':
                rows[y][x] = 's'
                if y == bottom:
                    rows[y][x] = 'e'
    # 睫毛線（眼睛上一列的 o）也收掉
    lash = top - 1
    for x, c in enumerate(rows[lash]):
        if c == 'o' and rows[top][x] == 's' and 2 < x < 19:
            rows[lash][x] = 's'
    return [''.join(r) for r in rows]

def elder_wrinkles(rows):
    rows = [list(r) for r in rows]
    for y, r in enumerate(rows):
        if 'e' in ''.join(r):
            xs = [x for x, c in enumerate(r) if c == 'e']
            rows[y + 1][xs[0] - 1] = 'S'
            rows[y + 1][xs[-1] + 1] = 'S'
            break
    return [''.join(r) for r in rows]

def draw_head(cell, avatar, gender, view, y, dx, eyes):
    rows, _ = head_rows(avatar, gender, view)
    if view == 'front':
        rows = set_eyes(rows, eyes)
        if avatar == 'elder':
            rows = elder_wrinkles(rows)
    cell.paste(rows, X0 + dx, y)
    if avatar == 'elder' and gender == 'm':
        cell.paste(CAP_FRONT if view == 'front' else CAP_BACK, X0 + dx, y - 1)

def draw_phones(cell, y, dx):
    """包耳式耳機：淺灰頭帶越過頭頂，米白耳罩蓋在兩側（頭的中心在 x=31.5，右半邊鏡射）"""
    half = [(x, -1) for x in range(27, 32)] + [(26, 0), (25, 1), (24, 2), (23, 3)] + [(22, yy) for yy in range(4, 9)]
    band = {}
    for x, yy in half:
        band[(x + dx, y + yy)] = '7'
        band[(63 - x + dx, y + yy)] = '7'
    outlined(cell, band)
    for x0, outer in ((19, 19), (41, 44)):
        cup = {}
        for x in range(x0, x0 + 4):
            for yy in range(y + 9, y + 15):
                cup[(x + dx, yy)] = '9' if yy == y + 14 or x == 63 - outer else '8'
        cup[(outer + dx, y + 9)] = '0'
        outlined(cell, cup)

# ───────────────────────── 軀幹（站姿，手自然垂下） ─────────────────────────
# 第 15～16 列是手；坐姿只取到第 15 列，接著是腿。

TORSO = {}
TORSO['office', 'front'] = grid([
#    0123456789012345678901
    '....ooooowSSwooooo....',
    '..ooJJJJowwwwoJJJJoo..',
    '.oKJJJJJowwwwoJJJJJKo.',
    'oKJoJJJLowwwwoLJJJoJKo',
    'oKJoJJJLownwwoLJJJoJKo',
    'oKJoJJJJowwwwoJJJJoJKo',
    'oKJoJJJJowwwwoJJJJoJKo',
    'oKJoJJJJownwwoJJJJoJKo',
    'oKJoJJJJowwwwoJJJJoJKo',
    'oKJoJJJJowwwwoJJJJoJKo',
    'oKJoJJJJownwwoJJJJoJKo',
    'oKJoJJJJowwwwoJJJJoJKo',
    'oKJoJJJJowwwwoJJJJoJKo',
    'oKJoJJJJownwwoJJJJoJKo',
    'oKKoJJJJowwwwoJJJJoKKo',
    'osSoJJJJowwwwoJJJJoSso',
    'osSoKKKKoWWWWoKKKKoSso',
    '.oooKKKKoWWWWoKKKKooo.',
    '...oooooooooooooooo...',
])
TORSO['office', 'back'] = grid([
#    0123456789012345678901
    '....oooooooooooooo....',
    '..ooJJJJJJKJJJJJJJoo..',
    '.oKJJJJJJJKJJJJJJJJKo.',
    'oKJoJJJJJJKJJJJJJJoJKo',
    'oKJoJJJJJJKJJJJJJJoJKo',
    'oKJoJJJJJJKJJJJJJJoJKo',
    'oKJoJJJJJJKJJJJJJJoJKo',
    'oKJoJJJJJJKJJJJJJJoJKo',
    'oKJoJJJJJJKJJJJJJJoJKo',
    'oKJoJJJJJJKJJJJJJJoJKo',
    'oKJoJJJJJJKJJJJJJJoJKo',
    'oKJoJJJJJJKJJJJJJJoJKo',
    'oKJoJJJJJJKJJJJJJJoJKo',
    'oKJoJJJJJJKJJJJJJJoJKo',
    'oKKoJJJJJJKJJJJJJJoKKo',
    'osSoJJJJJJKJJJJJJJoSso',
    'osSoKKKKKKoKKKKKKKoSso',
    '.oooKKKKKKoKKKKKKKooo.',
    '...oooooooooooooooo...',
])
TORSO['student', 'front'] = grid([
#    0123456789012345678901
    '....ooooowSSwooooo....',
    '..oowtwwwwwwwwwwtwoo..',
    '.oWwvtvvVwwwwVvvtvwWo.',
    'oWwovtvvvVwwVvvvtvowWo',
    'oWwovtvvvvVVvvvvtvowWo',
    'oWwovtvvvvvvvvvvtvowWo',
    'oWwovtvvvvVvvvvvtvowWo',
    'oWwovtvvvvvvvvvvtvowWo',
    'oWwovtvvvvVvvvvvtvowWo',
    'oWwovtvvvvvvvvvvtvowWo',
    'oWwovtvvvvVvvvvvtvowWo',
    'oWwovvvvvvvvvvvvvvowWo',
    'oWwovvvvvvVvvvvvvvowWo',
    'oWwovvvvvvvvvvvvvvowWo',
    'oWWovvvvvvvvvvvvvvoWWo',
    'osSouuuuuuuuuuuuuuoSso',
    'osSouuuuuuuuuuuuuuoSso',
    '.ooowwwwwwwwwwwwwwooo.',
    '...oooooooooooooooo...',
])
TORSO['student', 'back'] = grid([
#    0123456789012345678901
    '....oooooooooooooo....',
    '..oowtwwwwwwwwwwtwoo..',
    '.oWwwvvvvvvvvvvvvwwWo.',
    'oWwovvvvvvvvvvvvvvowWo',
    'oWwovvvvvvvvvvvvvvowWo',
    'oWwovvvvvvvvvvvvvvowWo',
    'oWwovvvvvvvvvvvvvvowWo',
    'oWwovvvvvvvvvvvvvvowWo',
    'oWwovvvvvvvvvvvvvvowWo',
    'oWwovvvvvvvvvvvvvvowWo',
    'oWwovvvvvvvvvvvvvvowWo',
    'oWwovvvvvvvvvvvvvvowWo',
    'oWwovvvvvvvvvvvvvvowWo',
    'oWwovvvvvvvvvvvvvvowWo',
    'oWWovvvvvvvvvvvvvvoWWo',
    'osSouuuuuuuuuuuuuuoSso',
    'osSouuuuuuuuuuuuuuoSso',
    '.ooowwwwwwwwwwwwwwooo.',
    '...oooooooooooooooo...',
])
TORSO['hoodie', 'front'] = grid([
#    0123456789012345678901
    '....ooQQQoSSoQQQoo....',
    '..ooJQQQQQooQQQQQJoo..',
    '.oKJJJQQQQQQQQQQJJJKo.',
    'oKJoJJJJwJJJJwJJJJoJKo',
    'oKJoJJJJwJJJJwJJJJoJKo',
    'oKJoJJJJwJJJJwJJJJoJKo',
    'oKJoJJJJwJJJJwJJJJoJKo',
    'oKJoJJJJJJJJJJJJJJoJKo',
    'oKJoJJJJJJJJJJJJJJoJKo',
    'oKJoJJJJJJJJJJJJJJoJKo',
    'oKJoJJKKKKKKKKKKJJoJKo',
    'oKJoJJKJJJJJJJJKJJoJKo',
    'oKJoJJKJJJJJJJJKJJoJKo',
    'oKJoJJKJJJJJJJJKJJoJKo',
    'orroJJJJJJJJJJJJJJorro',
    'osSoJJJJJJJJJJJJJJoSso',
    'osSorrrrrrrrrrrrrroSso',
    '.oooRRRRRRRRRRRRRRooo.',
    '...oooooooooooooooo...',
])
TORSO['hoodie', 'back'] = grid([
#    0123456789012345678901
    '....ooJJJJJJJJJJoo....',
    '..ooJoLJJJJJJJJJoJoo..',
    '.oKJJoLJJJJJJJJJoJJKo.',
    'oKJoJoLJJJJJJJJJoJoJKo',
    'oKJoJoJJJJJJJJJJoJoJKo',
    'oKJoJoKJJJJJJJJKoJoJKo',
    'oKJoJJoKJJJJJJKoJJoJKo',
    'oKJoJJJooooooooJJJoJKo',
    'oKJoJJJJJJJJJJJJJJoJKo',
    'oKJoJJJJJJJJJJJJJJoJKo',
    'oKJoJJJJJJJJJJJJJJoJKo',
    'oKJoJJJJJJJJJJJJJJoJKo',
    'oKJoJJJJJJJJJJJJJJoJKo',
    'oKJoJJJJJJJJJJJJJJoJKo',
    'orroJJJJJJJJJJJJJJorro',
    'osSoJJJJJJJJJJJJJJoSso',
    'osSorrrrrrrrrrrrrroSso',
    '.oooRRRRRRRRRRRRRRooo.',
    '...oooooooooooooooo...',
])
# 耳機族：陶土色輕便外套＋米白條紋 T（外套結構同上班族，T 恤沒有扣子、一列米白一列條紋）
def striped(rows):
    out = []
    for i, r in enumerate(rows):
        if i < 2:
            out.append(r)
        else:
            out.append(r.replace('n', 'w').replace('W', 'w').replace('w', 'z' if i % 2 else 'w'))
    return out
TORSO['headphone', 'front'] = striped(TORSO['office', 'front'])
TORSO['headphone', 'back'] = TORSO['office', 'back']
# 長者：針織開襟外套（同上班族的結構，換色）；家長：圓領上衣
TORSO['elder', 'front'] = TORSO['office', 'front']
TORSO['elder', 'back'] = TORSO['office', 'back']
TORSO['parent', 'front'] = grid([
#    0123456789012345678901
    '....oooooSSSSooooo....',
    '..ooJJJJoSSSSoJJJJoo..',
    '.oKJJJJJJooooJJJJJJKo.',
    'oKJoJJJJJJJJJJJJJJoJKo',
    'oKJoJJJJJJJJJJJJJJoJKo',
    'oKJoJJJJJJJJJJJJJJoJKo',
    'oKJoJJJJJJJJJJJJJJoJKo',
    'oKJoJJJJJJJJJJJJJJoJKo',
    'oKJoJJJJJJJJJJJJJJoJKo',
    'oKJoJJJJJJJJJJJJJJoJKo',
    'oKJoJJJJJJJJJJJJJJoJKo',
    'oKJoJJJJJJJJJJJJJJoJKo',
    'oKJoJJJJJJJJJJJJJJoJKo',
    'oKJoJJJJJJJJJJJJJJoJKo',
    'oKKoJJJJJJJJJJJJJJoKKo',
    'osSoJJJJJJJJJJJJJJoSso',
    'osSoKKKKKKKKKKKKKKoSso',
    '.oooKKKKKKKKKKKKKKooo.',
    '...oooooooooooooooo...',
])
TORSO['parent', 'back'] = grid([
#    0123456789012345678901
    '....oooooooooooooo....',
    '..ooJJJJJJJJJJJJJJoo..',
    '.oKJJJJJJJJJJJJJJJJKo.',
] + TORSO['parent', 'front'][3:])

def arm_codes(avatar):
    """舉手拉吊環時袖子的顏色（主色、暗色）"""
    return {'student': ('w', 'W')}.get(avatar, ('J', 'K'))

# ───────────────────────── 腿 ─────────────────────────

def legs_standing(kind, lift=(0, 0)):
    """站姿的腿：22 欄寬、22 列（y=40～61，最上面幾列藏在軀幹後面）"""
    rows = [['.'] * 22 for _ in range(22)]
    def put(x, y, c):
        if 0 <= y < 22:
            rows[y][x] = c
    if kind in ('skirt', 'pleats'):
        for y in range(0, 12):
            w0, w1 = (4, 17) if y < 9 else (3, 18)
            put(w0, y, 'o'); put(w1, y, 'o')
            for x in range(w0 + 1, w1):
                pleat = kind == 'pleats' and y >= 3 and x in (6, 9, 12, 15)
                put(x, y, 'P' if pleat or (kind == 'skirt' and x == 11 and y >= 4) else 'p')
        for x in range(3, 19):
            put(x, 12, 'o')
        for side, (x0, l) in enumerate(((6, lift[0]), (13, lift[1]))):
            for y in range(13, 18 - l):
                sock = kind == 'pleats' and y >= 15 - l
                put(x0 - 1, y, 'o'); put(x0 + 3, y, 'o')
                for x in range(x0, x0 + 3):
                    put(x, y, ('w' if x < x0 + 2 else 'W') if sock else ('s' if x < x0 + 2 else 'S'))
            shoe(put, x0 - 1, 18 - l, 'f', 'F', 5)
    else:
        for y in range(0, 6):
            put(4, y, 'o'); put(17, y, 'o')
            for x in range(5, 17):
                put(x, y, 'P' if y >= 4 and x in (10, 11) else 'p')
        for side, (x0, l) in enumerate(((5, lift[0]), (12, lift[1]))):
            for y in range(6, 18 - l):
                put(x0 - 1, y, 'o'); put(x0 + 5, y, 'o')
                for x in range(x0, x0 + 5):
                    put(x, y, 'P' if x == (x0 + 4 if side == 0 else x0) else 'p')
            shoe(put, x0 - 1, 18 - l, 'k' if kind == 'sneakers' else 'f', 'x' if kind == 'sneakers' else 'F', 7)
    return [''.join(r) for r in rows]

def shoe(put, x0, y0, c, sole, w):
    """正面的鞋：w 欄寬（含描邊）、4 列"""
    for x in range(x0, x0 + w):
        put(x, y0, 'o')
        put(x, y0 + 3, 'o' if x0 < x < x0 + w - 1 else '.')
    for y in (y0 + 1, y0 + 2):
        put(x0, y, 'o'); put(x0 + w - 1, y, 'o')
        for x in range(x0 + 1, x0 + w - 1):
            put(x, y, sole if y == y0 + 2 else c)

def legs_seated(kind):
    """坐姿正面：大腿往前（y=44～50）、小腿垂下（y=51～58）、鞋（y=59～61）"""
    skirt = kind in ('skirt', 'pleats')
    rows = []
    for y in range(7):
        if y == 6:
            rows.append('.' + 'o' * 20 + '.')
            continue
        r = ['.', 'o'] + ['p'] * 18 + ['o', '.']
        if y == 5:
            r = ['.', 'o'] + ['P'] * 18 + ['o', '.']
        elif kind == 'pleats':
            for x in (5, 8, 13, 16):
                r[x] = 'P'
        elif not skirt:
            r[10] = r[11] = 'P'
        rows.append(''.join(r))
    for y in range(8):
        if skirt:
            sock = kind == 'pleats' and y >= 5
            leg = ('ow' + 'wW' + 'o') if sock else 'ossSo'
            rows.append('....' + leg + '....' + leg + '....')
        else:
            rows.append('...oppppPo..oPppppo...')
    c, sole = ('k', 'x') if kind == 'sneakers' else ('f', 'F')
    if skirt:
        rows += ['...offffo....offffo...'.replace('f', c), '...o' + sole * 4 + 'o....o' + sole * 4 + 'o...', '....oooo......oooo....']
    else:
        rows += ['...o' + c * 5 + 'o..o' + c * 5 + 'o...', '...o' + sole * 5 + 'o..o' + sole * 5 + 'o...', '....ooooo....ooooo....']
    return grid(rows)

def bottom_kind(avatar, gender):
    if gender == 'f' and avatar == 'office':
        return 'skirt'
    if gender == 'f' and avatar == 'student':
        return 'pleats'
    if avatar in ('hoodie', 'headphone'):
        return 'sneakers'
    return 'pants'

# ───────────────────────── 配件 ─────────────────────────

def shoulder_bag(cell, view, ty, kind):
    """肩背包、托特包：正面掛在畫面左側肩上，背面在畫面右側"""
    left = view == 'front'
    sx = 26 if left else 37
    for y in range(ty + 1, ty + 11):
        cell.put(sx, y, 't')
    bx = 16 if left else 39
    bag = {}
    for x in range(bx, bx + 9):
        for y in range(ty + 11, ty + 19):
            edge_shade = (x == bx + 8) if left else (x == bx)
            c = 'G' if edge_shade or y == ty + 18 else 'g'
            if kind == 'satchel' and y == ty + 13:
                c = 'G'
            if kind == 'satchel' and y == ty + 14 and x == bx + 4:
                c = 'y'
            if kind == 'tote' and y == ty + 15:
                c = 'y'
            bag[(x, y)] = c
    outlined(cell, bag)

def sling_bag(cell, view, ty):
    """耳機族的斜背包：背帶從一側肩膀斜到另一側腰間"""
    pts = [(39 - i, ty + 1 + i) for i in range(13)] if view == 'front' else [(24 + i, ty + 1 + i) for i in range(13)]
    for x, y in pts:
        cell.put(x, y, 't')
        cell.put(x, y + 1, 't')
    bx = 20 if view == 'front' else 37
    bag = {}
    for x in range(bx, bx + 8):
        for y in range(ty + 13, ty + 19):
            bag[(x, y)] = 'G' if y == ty + 18 else ('y' if y == ty + 15 and bx + 1 <= x <= bx + 6 else 'g')
    outlined(cell, bag)

def backpack(cell, view, ty):
    """學生的圓角書包：背面整個露出來；正面只看到兩條背帶（已畫在軀幹上）"""
    if view != 'back':
        return
    rows = grid([
        '..oooooooooo..',
        '.oqqggggggggo.',
        'oqgggggggggggo',
        'ogggggggggggGo',
        'oGGGGGGGGGGGGo',
        'ogggggyygggggo',
        'ogggggggggggGo',
        'ogggggggggggGo',
        'ogggggggggggGo',
        'ogggggggggggGo',
        'ogggggggggggGo',
        'oGgggggggggGGo',
        '.oGGGGGGGGGGo.',
        '..oooooooooo..',
    ])
    cell.paste(rows, X0 + 4, ty + 2)

def basket(cell, view, ty, standing):
    """長者的菜籃：站著拎在畫面左手邊，坐著放在腿上（背面坐姿看不到）"""
    if standing:
        x0, y0 = 13, ty + 14
    elif view == 'front':
        x0, y0 = 25, 40
    else:
        return
    px = {}
    for x in range(x0, x0 + 13):
        for y in range(y0 + 4, y0 + 11):
            px[(x, y)] = '2' if y in (y0 + 6, y0 + 9) or x == x0 + 6 else '1'
    for x, y in ((x0 + 3, y0 + 1), (x0 + 3, y0 + 2), (x0 + 4, y0), (x0 + 5, y0), (x0 + 6, y0), (x0 + 7, y0), (x0 + 8, y0),
                 (x0 + 9, y0 + 1), (x0 + 9, y0 + 2)):
        px[(x, y)] = '2'
    for x, y in ((x0 + 4, y0 + 2), (x0 + 4, y0 + 3), (x0 + 5, y0 + 3), (x0 + 7, y0 + 1), (x0 + 7, y0 + 2), (x0 + 7, y0 + 3), (x0 + 8, y0 + 3)):
        px[(x, y)] = '3'
    outlined(cell, px)

CHILD_FRONT = grid([
#    012345678901
    '...oooooo...',
    '..ohhhjhho..',
    '.ohhhhhhhho.',
    '.ohhhhhhhho.',
    '.ohssssssho.',
    '.osesssseso.',
    '.osesssseso.',
    '.osbssssbso.',
    '..ossmssso..',
    '...oooooo...',
    '..oyyyyyyo..',
    '.oyyyyyyyyo.',
    'osoyyyyyyoo.',
    'osoyyyyyyo..',
    'oooyyyyyyo..',
    '..oyyyyyyo..',
    '..oooooooo..',
    '..oppooppo..',
    '..oppooppo..',
    '..oppooppo..',
    '..oppooppo..',
    '..oppooppo..',
    '..offooffo..',
    '..oooooooo..',
])
CHILD_BACK = grid([
#    012345678901
    '...oooooo...',
    '..ohhhjhho..',
    '.ohhhhhhhho.',
    '.ohhhhhhhho.',
    '.ohhhhhhhho.',
    '.ohhhhhhhho.',
    '.oHhhhhhhHo.',
    '.oHHhhhhHHo.',
    '..oHHHHHHo..',
    '...oSSSSo...',
] + CHILD_FRONT[10:])
CHILD_LAP = grid([
#    0123456789012
    '....ooooo....',
    '...ohhhhho...',
    '..ohhhhhhho..',
    '..ohssssshoo.',
    '..osesssesoo.',
    '..osbsssbso..',
    '...osssssoo..',
    '..ooooooooo..',
    '.osoyyyyyoso.',
    '.osoyyyyyoso.',
    '.oooyyyyyooo.',
    '..ooyyyyyoo..',
    '...oooooooo..',
])

def child(cell, view, anim, frame, standing, eyes):
    if standing:
        bob = 1 if anim == 'walk' and frame == 1 else 0
        cell.paste(CHILD_FRONT if view == 'front' else CHILD_BACK, 7, 38 + bob)
        # 舉起的手牽著大人的手（大人的手在 x≈22、y≈39）
        arm = {(x, y + bob): 'y' for x, y in ((17, 47), (18, 46), (18, 45), (19, 44), (19, 43), (20, 42))}
        arm[(20, 41 + bob)] = 's'
        arm[(21, 41 + bob)] = 's'
        outlined(cell, arm)
    elif view == 'front':
        rows = CHILD_LAP if eyes == 'open' else set_eyes(CHILD_LAP, 'closed')
        cell.paste(rows, 25, 34)
    else:
        # 從背後看：小朋友的頭從大人肩膀旁冒出來
        cell.paste(grid([
            '..oooooo..',
            '.ohhhjhho.',
            'ohhhhhhhho',
            'ohhhhhhhho',
            'oHhhhhhhHo',
            'oHHhhhhHHo',
            '.oHHHHHHo.',
            '..oooooo..',
        ]), 41, 25 + (2 if anim == 'sleep' else 0))

# ───────────────────────── 組合一格 ─────────────────────────

def pose(anim, f):
    """回傳（軀幹位移、頭位移、頭左右位移、眼睛）"""
    return {
        'idle': (f, f, 0, 'open'),
        'music': (0, f, 0, 'closed'),
        'read': (1 if f == 1 else 0, 2, 0, 'down'),
        'sleep': (1 if f in (1, 2) else 0, [1, 2, 4, 2][f], 1 if f == 2 else 0, 'closed'),
        'stand': (f, f, 0, 'open'),
        'walk': (-1 + f, -1 + f, 0, 'open'),
        'hang': (-2, -2 + f, 0, 'open'),
    }[anim]

def build_cell(avatar, gender, view, anim, frame):
    c = Cell()
    standing = anim in STANDING
    body, head, hdx, eyes = pose(anim, frame)
    kind = bottom_kind(avatar, gender)
    torso = TORSO[avatar, view]
    if standing:
        ty, hy = 24 + body, 4 + head
        lift = ((2, 0), (0, 2))[frame] if anim == 'walk' else (0, 0)
        c.paste(legs_standing(kind, lift), X0, 40)
    else:
        ty, hy = 28 + body, 8 + head
        if view == 'front':
            c.paste(legs_seated(kind), X0, 44)
    if avatar == 'hoodie' and view == 'front':
        # 正面看得到帽兜從肩膀後面探出來
        c.paste(['..oooo........oooo....'[:22], '.oJJJJo......oJJJJo...'[:22]], X0, ty - 1)
    if not standing and view == 'front':
        torso = torso[:16]
    c.paste(torso, X0, ty)

    # 舉手拉吊環：畫面右側的手臂往上伸到吊環（x≈42～44、y≈1～3）
    if anim == 'hang':
        for y in range(ty + 2, ty + 18):
            for x in (X0 + 19, X0 + 20, X0 + 21):
                c.clear(x, y)
            c.put(X0 + 18, y, 'o')
        main, lo = arm_codes(avatar)
        arm = {}
        for y in range(3, ty + 3):
            arm[(42, y)] = lo
            arm[(43, y)] = main
            arm[(44, y)] = main
        for y in range(0, 3):
            for x in (42, 43, 44):
                arm[(x, y)] = 's' if x < 44 else 'S'
        outlined(c, arm)

    # 走路時手臂前後擺動
    if anim == 'walk':
        s = 1 if frame == 0 else -1
        for x0, d in ((X0, s), (X0 + 19, -s)):
            col = {(x, y): c.px.get((x, y)) for x in range(x0, x0 + 3) for y in range(ty + 3, ty + 18)}
            for (x, y) in col:
                c.clear(x, y)
            for (x, y), v in col.items():
                if v:
                    c.put(x, y + d, v)

    # 看書：雙手捧著書在胸前（正面）
    if anim == 'read' and view == 'front':
        for y in range(ty + 11, ty + 16):
            for x in (X0, X0 + 1, X0 + 2, X0 + 19, X0 + 20, X0 + 21):
                c.clear(x, y)
        book = {}
        for x in range(X0 + 3, X0 + 19):
            for y in range(ty + 6, ty + 16):
                book[(x, y)] = '4' if x in (X0 + 3, X0 + 18) or y == ty + 15 else ('5' if x in (X0 + 10, X0 + 11) else '6')
        for x in range(X0 + 5, X0 + 17, 2):
            if x not in (X0 + 9, X0 + 11):
                for yy in (ty + 9, ty + 12):
                    book[(x, yy)] = '5'
        if frame == 2:
            for x in range(X0 + 12, X0 + 17):
                for yy in range(ty + 3, ty + 7):
                    book[(x, yy)] = '6'
        outlined(c, book)
        for hx in (X0 + 1, X0 + 18):
            c.paste(['oso' if hx < 30 else 'oso', 'oso', 'ooo'], hx, ty + 12)

    if avatar == 'office' and view == 'front' or avatar == 'office' and view == 'back':
        if standing:
            shoulder_bag(c, view, ty, 'satchel')
    if avatar == 'hoodie' and standing:
        shoulder_bag(c, view, ty, 'tote')
    if avatar == 'headphone' and (standing or view == 'back'):
        sling_bag(c, view, ty)
    if avatar == 'student':
        backpack(c, view, ty)
    if avatar == 'elder' and anim != 'read':
        basket(c, view, ty, standing)

    draw_head(c, avatar, gender, view, hy, hdx, eyes)
    if anim == 'music' or avatar == 'headphone':
        draw_phones(c, hy, hdx)
    if avatar == 'parent':
        child(c, view, anim, frame, standing, eyes)
    return c

# ───────────────────────── 色票 ─────────────────────────

PANTS = {'p': '#47403f', 'P': '#36302f'}
COMMON = {**BASE_PAL,
          '1': '#c9a46a', '2': '#a8875a', '3': '#7fa98a',  # 菜籃、藤編、青菜
          '4': '#b97a6f', '5': '#d8ccb8', '6': '#f3e9da',  # 書封、書頁線、書頁
          '7': '#bcb8b2', '8': '#ddd1bd', '9': '#b9ab95', '0': '#f6f0e4'}  # 耳機頭帶、耳罩、耳罩暗、高光
OUTFIT_PAL = {
    'office': {},
    'student': {'v': '#b9a78c', 'V': '#a39177', 'u': '#a8967c', 'g': '#9c6b5f', 'G': '#7f5549', 'q': '#b28377',
                'y': '#d1b27a', 't': '#7f5549'},
    'hoodie': {'J': '#7d8877', 'K': '#677161', 'L': '#95a08d', 'Q': '#5f6a5b', 'r': '#6f7a69', 'R': '#5c6657',
               'g': '#cdbb9c', 'G': '#b09d7f', 'y': '#8f8a73', 't': '#a8957a', 'p': '#8a8178', 'P': '#746c64'},
    'headphone': {'J': '#ad806b', 'K': '#926957', 'L': '#c2957f', 'z': '#7a8290', 'g': '#636b66', 'G': '#4f5652',
                  'y': '#a9b0a8', 't': '#4f5652', 'p': '#5f6b7a', 'P': '#4f5a68', 'k': '#5a5655', 'x': '#e9e1d3'},
}
ELDER_PAL = {
    'm': {'J': '#8c9180', 'K': '#767b6b', 'L': '#a3a896', 'h': '#c9c3bc', 'H': '#aaa39b', 'j': '#ddd8d2',
          'c': '#6e6a64', 'C': '#57534e', 'p': '#5f6064', 'P': '#4d4e52'},
    'f': {'J': '#9a8494', 'K': '#82707e', 'L': '#b09aaa', 'h': '#d3cdc6', 'H': '#b3aca4', 'j': '#e6e1db',
          'p': '#6e6a70', 'P': '#5b575d'},
}
PARENT_PAL = {
    'm': {'J': '#7f98a6', 'K': '#68808e', 'L': '#97aeba', 'y': '#e3c27a'},
    'f': {'J': '#c49a8e', 'K': '#a9827a', 'L': '#d4ada2', 'y': '#e3c27a'},
}

def palette(avatar, gender):
    if avatar == 'elder':
        return {**COMMON, **ELDER_PAL[gender]}
    if avatar == 'parent':
        return {**COMMON, **PARENT_PAL[gender]}
    return {**COMMON, **OUTFIT_PAL[avatar]}

def build_atlas():
    cols = sum(n for _, n in FRAMES)
    atlas = Image.new('RGBA', (CELL * cols, CELL * len(AVATARS) * len(GENDERS) * len(VIEWS)), (0, 0, 0, 0))
    row = 0
    for avatar in AVATARS:
        for gender in GENDERS:
            pal = palette(avatar, gender)
            for view in VIEWS:
                col = 0
                for anim, n in FRAMES:
                    for f in range(n):
                        atlas.alpha_composite(build_cell(avatar, gender, view, anim, f).image(pal), (col * CELL, row * CELL))
                        col += 1
                row += 1
    return atlas

def preview(atlas, path, k=3):
    big = atlas.resize((atlas.width * k, atlas.height * k), Image.NEAREST)
    out = Image.new('RGBA', big.size, '#f3ece1')
    d = ImageDraw.Draw(out)
    for y in range(0, big.height, CELL * k):
        d.line([(0, y), (big.width, y)], fill='#e0d5c4')
    out.alpha_composite(big)
    out.save(path)

if __name__ == '__main__':
    atlas = build_atlas()
    atlas.save(sys.argv[1], optimize=True)
    if len(sys.argv) > 2:
        preview(atlas, sys.argv[2])
