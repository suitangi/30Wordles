import zlib, struct
from collections import deque

def read_png(path):
    d = open(path, 'rb').read()
    pos = 8; w = h = None; idat = b''; plte = None
    while pos < len(d):
        ln = struct.unpack('>I', d[pos:pos+4])[0]
        typ = d[pos+4:pos+8]; data = d[pos+8:pos+8+ln]
        if typ == b'IHDR':
            w, h, bd, ct, _, _, it = struct.unpack('>IIBBBBB', data)
            assert bd == 8 and it == 0
        elif typ == b'IDAT': idat += data
        elif typ == b'PLTE': plte = data
        elif typ == b'IEND': break
        pos += 12 + ln
    raw = zlib.decompress(idat)
    ch = {0:1, 2:3, 3:1, 4:2, 6:4}[ct]
    stride = w * ch
    out = bytearray(h*stride); prev = bytearray(stride); p = 0
    for y in range(h):
        f = raw[p]; p += 1
        line = bytearray(raw[p:p+stride]); p += stride
        if f == 1:
            for i in range(ch, stride): line[i] = (line[i]+line[i-ch]) & 255
        elif f == 2:
            for i in range(stride): line[i] = (line[i]+prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                a = line[i-ch] if i >= ch else 0
                line[i] = (line[i] + ((a+prev[i])>>1)) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i-ch] if i >= ch else 0
                b = prev[i]; c = prev[i-ch] if i >= ch else 0
                pa = abs(b-c); pb = abs(a-c); pc = abs(a+b-2*c)
                pr = a if (pa<=pb and pa<=pc) else (b if pb<=pc else c)
                line[i] = (line[i]+pr) & 255
        out[y*stride:(y+1)*stride] = line; prev = line
    rgb = bytearray(w*h*3)
    if ct == 2: rgb = out
    elif ct == 6:
        for i in range(w*h): rgb[i*3:i*3+3] = out[i*4:i*4+3]
    elif ct == 3:
        for i in range(w*h):
            idx = out[i]; rgb[i*3:i*3+3] = plte[idx*3:idx*3+3]
    return w, h, rgb

PX, PY, HY = 52.8, 61.0, 30.5

def blobs_with_area(w, h, rgb):
    def cls(r, g, b):
        if b > 150 and b > r + 30 and g > 100: return 'B'
        if r > 200 and 120 < g < 200 and b < 80: return 'O'
        if abs(r-g) < 20 and abs(g-b) < 20 and 60 < r < 130: return 'G'
        return None
    grid = [[None]*w for _ in range(h)]
    for y in range(h):
        row = y*w*3
        for x in range(w):
            grid[y][x] = cls(rgb[row+x*3], rgb[row+x*3+1], rgb[row+x*3+2])
    seen = [[False]*w for _ in range(h)]
    comps = []
    for y in range(h):
        for x in range(w):
            if grid[y][x] and not seen[y][x]:
                c = grid[y][x]
                q = deque([(x,y)]); seen[y][x] = True; pts = []
                while q:
                    px_, py_ = q.popleft(); pts.append((px_, py_))
                    for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
                        nx, ny = px_+dx, py_+dy
                        if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and grid[ny][nx] == c:
                            seen[ny][nx] = True; q.append((nx, ny))
                if len(pts) > 300:
                    comps.append((c, sum(p[0] for p in pts)/len(pts), sum(p[1] for p in pts)/len(pts), len(pts)))
    return comps

def fit_single(comps):
    # use ONLY single-hex blobs for the fit (area < 3300)
    singles = [c for c in comps if c[3] < 3300]
    c0 = singles[0]
    best = None
    for par0 in (0, 1):
        assigns = []
        for (c, x, y, a) in singles:
            dq = round((x - c0[1]) / PX)
            if abs(x - c0[1] - PX*dq) > 3: continue
            ybase = y - HY*((dq + par0) & 1)
            assigns.append((x, dq, ybase))
        # y0 = mode of (ybase mod PY)
        from collections import Counter
        cnt = Counter(round(v % PY, 0) for (_, _, v) in assigns)
        y0 = cnt.most_common(1)[0][0]
        tot = 0
        for (x, dq, ybase) in assigns:
            r = round((ybase - y0) / PY)
            tot += abs(ybase - y0 - PY*r)
        x0 = c0[1] % PX
        if best is None or tot < best[0]:
            best = (tot, x0, y0, par0)
    return best

def sample(px, x, y):
    xi = max(0, min(px[0]-1, int(round(x)))); yi = max(0, min(px[1]-1, int(round(y))))
    o = (yi*px[0] + xi)*3
    return px[2][o], px[2][o+1], px[2][o+2]

def cls2(r, g, b):
    if b > 150 and b > r + 30 and g > 100: return 'B'
    if r > 200 and 120 < g < 200 and b < 80: return 'O'
    if abs(r-g) < 20 and abs(g-b) < 20 and 60 < r < 130: return 'G'
    if r > 150 and g > 150 and b < 160: return '.'
    return '?'

def hexmap(path):
    w, h, rgb = read_png(path)
    px = (w, h, rgb)
    comps = blobs_with_area(w, h, rgb)
    tot, x0, y0, par0 = fit_single(comps)
    m = {}
    q = 0
    while x0 + q*PX - 30 < w:
        r = 0
        while True:
            cx = x0 + q*PX
            cy = y0 + r*PY + (HY if (q+par0)&1 else 0)
            if cy - 30 >= h: break
            votes = {}
            for ox, oy in ((0,0),(7,0),(-7,0),(0,7),(0,-7)):
                c = cls2(*sample(px, cx+ox, cy+oy))
                votes[c] = votes.get(c, 0)+1
            cc = max(votes, key=votes.get)
            if cc in 'BOG': m[(q, r)] = cc
            r += 1
        q += 1
    return m

base = r'C:\Users\suita\OneDrive\Pictures\Screenshots'
files = {
    'B':  base + r'\Screenshot 2026-09-29 104818.png',
    'O': base + r'\Screenshot 2026-09-29 104842.png',
    'G':  base + r'\Screenshot 2026-09-29 104907.png',
}
maps = {}
for name, path in files.items():
    m = hexmap(path)
    maps[name] = m
    print(f'=== view {name}: {len(m)} colored')
    for col in 'BOG':
        n = sum(1 for v in m.values() if v == col)
        print(f'  {col}: {n}')
    # print map rows (convert: rows r, cols q)
    rmin = min(k[1] for k in m); rmax = max(k[1] for k in m)
    for r in range(rmin, rmax+1):
        ks = sorted(k[0] for k in m if k[1] == r)
        if not ks: continue
        line = ' '.join(f'{q}{m[(q,r)]}' for q in ks)
        print(f'  r{r:2d}  {line}')
    print()

def align(m1, m2):
    best = None
    ks1 = list(m1); ks2 = list(m2)
    for a in ks1:
        for b in ks2:
            dq, dr = a[0]-b[0], a[1]-b[1]
            match = sum(1 for k in ks1 if m2.get((k[0]-dq, k[1]-dr)) == m1[k])
            mismatch_pen = 0
            for k in ks1:
                v2 = m2.get((k[0]-dq, k[1]-dr))
                if v2 is not None and v2 != m1[k]: mismatch_pen += 1
            score = match - 3*mismatch_pen
            if best is None or score > best[0]:
                best = (score, dq, dr, match, mismatch_pen)
    return best

aOG = align(maps['O'], maps['G'])
print('align G into O frame:', aOG)
aOB = align(maps['O'], maps['B'])
print('align B into O frame:', aOB)

# Build union with membership: for each hex, per-view color
dqG, drG = aOG[1], aOG[2]
dqB, drB = aOB[1], aOB[2]
allk = set(maps['O']) | {(k[0]+dqG, k[1]+drG) for k in maps['G']} | {(k[0]+dqB, k[1]+drB) for k in maps['B']}
print('\nUnion map in O frame (triplet = color in B,O,G views; . = background):')
rows = {}
for k in allk:
    b = maps['B'].get((k[0]-dqB, k[1]-drB), '.')
    o = maps['O'].get(k, '.')
    g = maps['G'].get((k[0]-dqG, k[1]-drG), '.')
    rows.setdefault(k[1], {})[k[0]] = b + o + g
for r in sorted(rows):
    line = ' '.join(f'{q}:{rows[r][q]}' for q in sorted(rows[r]))
    print(f'r{r:2d}  {line}')
