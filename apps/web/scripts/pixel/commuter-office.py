# 角色設定頁的全身預覽：上班族男女 64×64 透明 PNG（四分之三側面朝右，大頭短身）
# 頭頂在第 4 列、腳底在第 61 列，男女同一套置中與基準線；之後的學生、連帽外套、耳機族沿用這個比例。
import sys
from PIL import Image, ImageColor

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
}

def grid(rows, w=None):
    w = w or len(rows[0])
    for i, r in enumerate(rows):
        assert len(r) == w, (i, r, len(r), w)
    return rows

def paste(img, rows, x0, y0):
    px = img.load()
    for y, r in enumerate(rows):
        for x, c in enumerate(r):
            if c != '.':
                px[x0 + x, y0 + y] = ImageColor.getrgb(PAL[c]) + (255,)

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

def build(head, hx, legs):
    img = Image.new('RGBA', (64, 64), (0, 0, 0, 0))
    paste(img, legs, 24 + DX, 64 - 2 - len(legs))
    paste(img, TORSO, 20 + DX, 24)
    paste(img, head, hx + DX, 4)
    return img

def preview(imgs, path, k=10):
    w = 64 * k
    out = Image.new('RGBA', (w * len(imgs) + 20 * (len(imgs) - 1), w + 20), '#f8f3ea')
    for i, im in enumerate(imgs):
        big = im.resize((w, w), Image.NEAREST)
        x = i * (w + 20)
        out.alpha_composite(big, (x, 0))
    out.save(path)

if __name__ == '__main__':
    # 用法：python commuter-office.py <輸出資料夾>；另存一張 8 倍 nearest-neighbor 放大預覽
    out = sys.argv[1]
    f = build(HEAD_F, 17, LEGS_F)
    m = build(HEAD_M, 21, LEGS_M)
    f.save(f'{out}/commuter-office-female.png')
    m.save(f'{out}/commuter-office-male.png')
    if len(sys.argv) > 2:
        preview([f, m], sys.argv[2], 8)
