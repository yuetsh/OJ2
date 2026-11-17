"""「对照参考答案」：拿老师答案跑出来的指纹和学生的比，说出差在哪。

跑在处理进程里（学生进程之外）。两边的指纹都是 kernel.py 抽的，形状见那边。
给学生看的话一律中文、说名字不说术语，一次最多说 MAX_MESSAGES 条。
"""

import math

MAX_MESSAGES = 3
REL_TOL = 1e-6
ABS_TOL = 1e-9

TYPE_NAMES = {
    'none': 'None',
    'bool': 'True / False',
    'num': '一个数',
    'str': '一段文字',
    'df': '一张表（DataFrame）',
    'series': '一列数据（Series）',
    'list': '一个列表',
    'dict': '一个字典',
    'set': '一个集合',
}

MARK_NAMES = {'bar': '柱状图', 'line': '折线图', 'scatter': '散点图', 'pie': '饼图', 'image': '一张图片', None: '空白的图'}


def fmt(v):
    if v is None:
        return 'NaN'
    if isinstance(v, bool):
        return str(v)
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        if math.isinf(v):
            return '无穷大' if v > 0 else '负无穷大'
        r = round(v, 6)
        return str(int(r)) + '.0' if r == int(r) and abs(r) < 1e15 else repr(r)
    s = str(v)
    return f'「{s if len(s) <= 40 else s[:40] + "…"}」'


def same(a, b):
    if a is None or b is None:
        return a is None and b is None
    if isinstance(a, bool) or isinstance(b, bool):
        return a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return math.isclose(a, b, rel_tol=REL_TOL, abs_tol=ABS_TOL)
    return a == b


def _type_name(fp):
    if fp['t'] == 'repr':
        return fp.get('type', '其他')
    return TYPE_NAMES.get(fp['t'], fp['t'])


def _label_diff(name, ref_ix, stu_ix, what):
    """索引（行名 / 项名）不一样时的说法。两边都是默认的 0、1、2 … 时不比。"""
    if ref_ix['range'] and stu_ix['range']:
        return None
    r, s = ref_ix['labels'], stu_ix['labels']
    if r == s:
        return None
    missing = [x for x in r if x not in s]
    extra = [x for x in s if x not in r]
    if missing:
        return f'{name} 里少了「{missing[0]}」这一{what}'
    if extra:
        return f'{name} 里多了「{extra[0]}」这一{what}'
    shown = '、'.join(r[:6]) + ('…' if len(r) > 6 else '')
    return f'{name} 的顺序不对，应该是 {shown}'



def _where(index, i, unit):
    """第 i 项（行）怎么说：有自己的索引就说索引名，否则说第几项。

    索引的名字只留了前 MAX_FP_ITEMS 个（kernel.py 的 _index），数值却能取到更多：超过 5000 行、
    索引又不是 0、1、2… 的长表，后面那些行没有名字可说，原来直接 IndexError、运行器回 500。
    """
    labels = index['labels']
    if not index['range'] and i < len(labels):
        return f'「{labels[i]}」这一{unit}'
    return f'第 {i + 1} {unit}'

def compare_value(name, ref, stu):
    """返回说法列表；空列表就是一样。"""
    if stu['t'] == 'missing':
        return [f'没有找到 {name}，是不是名字写错了']
    t = ref['t']
    if t != stu['t'] and not (t in ('num', 'bool') and stu['t'] in ('num', 'bool')):
        return [f'{name} 应该是{_type_name(ref)}，你的是{_type_name(stu)}']

    if t in ('none', 'bool', 'num', 'str'):
        a, b = stu.get('v'), ref.get('v')
        if same(a, b):
            return []
        return [f'{name}：你的是 {fmt(a)}，应该是 {fmt(b)}']

    if t == 'repr':
        return [] if ref['v'] == stu['v'] else [f'{name}：你的是 {fmt(stu["v"])}，应该是 {fmt(ref["v"])}']

    if t == 'set':
        return [] if ref['v'] == stu['v'] else [f'{name} 里的东西和答案不一样']

    if t == 'list':
        if ref['length'] != stu['length']:
            return [f'{name} 应该有 {ref["length"]} 项，你的有 {stu["length"]} 项']
        msgs = []
        for i, (r, s) in enumerate(zip(ref['v'], stu['v'])):
            msgs += compare_value(f'{name} 的第 {i + 1} 项', r, s)
            if len(msgs) >= MAX_MESSAGES:
                break
        return msgs

    if t == 'dict':
        rk = [k for k, _ in ref['items']]
        sk = [k for k, _ in stu['items']]
        missing = [k for k in rk if k not in sk]
        if missing:
            return [f'{name} 里少了「{missing[0]}」']
        extra = [k for k in sk if k not in rk]
        if extra:
            return [f'{name} 里多了「{extra[0]}」']
        sv = dict(stu['items'])
        msgs = []
        for k, r in ref['items']:
            msgs += compare_value(f'{name} 里「{k}」', r, sv[k])
            if len(msgs) >= MAX_MESSAGES:
                break
        return msgs

    if t == 'series':
        if ref['length'] != stu['length']:
            return [f'{name} 应该有 {ref["length"]} 项，你的有 {stu["length"]} 项']
        d = _label_diff(name, ref['index'], stu['index'], '项')
        if d:
            return [d]
        if 'values' not in ref or 'values' not in stu:
            return []
        msgs = []
        for i, (r, s) in enumerate(zip(ref['values'], stu['values'])):
            if not same(s, r):
                where = _where(ref['index'], i, '项')
                msgs.append(f'{name} 里{where}：你的是 {fmt(s)}，应该是 {fmt(r)}')
                if len(msgs) >= MAX_MESSAGES:
                    break
        return msgs

    if t == 'df':
        rc, sc = ref['columns'], stu['columns']
        missing = [c for c in rc if c not in sc]
        if missing:
            return [f'{name} 少了「{missing[0]}」这一列']
        extra = [c for c in sc if c not in rc]
        if extra:
            return [f'{name} 多了「{extra[0]}」这一列']
        if rc != sc:
            return [f'{name} 的列顺序不对，应该是 {"、".join(rc)}']
        if ref['shape'][0] != stu['shape'][0]:
            return [f'{name} 应该有 {ref["shape"][0]} 行，你的有 {stu["shape"][0]} 行']
        d = _label_diff(name, ref['index'], stu['index'], '行')
        if d:
            return [d]
        if 'values' not in ref or 'values' not in stu:
            return []
        msgs = []
        for i, (rrow, srow) in enumerate(zip(ref['values'], stu['values'])):
            for j, (r, s) in enumerate(zip(rrow, srow)):
                if not same(s, r):
                    row = _where(ref['index'], i, '行')
                    msgs.append(f'{name} {row}「{rc[j]}」：你的是 {fmt(s)}，应该是 {fmt(r)}')
                    if len(msgs) >= MAX_MESSAGES:
                        return msgs
        return msgs

    return []


# ---------------------------------------------------------------- 图


def _marks_kind(ax):
    return ax['marks']['kind'] if ax['marks'] else None


def _seq(msgs, what, ref, stu, labels=None):
    for i, (r, s) in enumerate(zip(ref, stu)):
        if not same(s, r):
            label = f'（{labels[i]}）' if labels and labels[i] else ''
            msgs.append(f'第 {i + 1} {what}{label}：你的是 {fmt(s)}，应该是 {fmt(r)}')
            if len(msgs) >= MAX_MESSAGES:
                return


def compare_marks(ref, stu):
    kind = ref['kind']
    if kind == 'bar':
        rv, sv = ref['values'], stu['values']
        if len(rv) != len(sv):
            names = [x for x in ref['labels'] if x]
            hint = f'（{"、".join(names)}）' if names and len(names) <= 8 else ''
            return [f'图里应该是 {len(rv)} 根柱子{hint}，你画了 {len(sv)} 根']
        msgs = []
        for i, (r, s) in enumerate(zip(ref['labels'], stu['labels'])):
            if r and r != s:
                msgs.append(f'第 {i + 1} 根柱子应该是「{r}」，你的是「{s}」' if s else f'第 {i + 1} 根柱子应该是「{r}」')
                if len(msgs) >= MAX_MESSAGES:
                    return msgs
        _seq(msgs, '根柱子', rv, sv, ref['labels'])
        return msgs
    if kind == 'line':
        rs, ss = ref['series'], stu['series']
        if len(rs) != len(ss):
            return [f'图里应该是 {len(rs)} 条线，你画了 {len(ss)} 条']
        msgs = []
        for k, (r, s) in enumerate(zip(rs, ss)):
            prefix = f'第 {k + 1} 条线' if len(rs) > 1 else '线'
            if len(r['y']) != len(s['y']):
                msgs.append(f'{prefix}应该有 {len(r["y"])} 个点，你的有 {len(s["y"])} 个')
            else:
                before = len(msgs)
                _seq(msgs, '个点的横坐标', r['x'], s['x'])
                if len(msgs) == before:
                    _seq(msgs, '个点', r['y'], s['y'])
                msgs[before:] = [f'{prefix}{m}' if len(rs) > 1 else m for m in msgs[before:]]
            if len(msgs) >= MAX_MESSAGES:
                break
        return msgs
    if kind == 'scatter':
        rp, sp = ref['points'], stu['points']
        if len(rp) != len(sp):
            return [f'图里应该有 {len(rp)} 个点，你画了 {len(sp)} 个']
        for i, (r, s) in enumerate(zip(rp, sp)):
            if not (same(s[0], r[0]) and same(s[1], r[1])):
                return [f'第 {i + 1} 个点：你的是 ({fmt(s[0])}, {fmt(s[1])})，应该是 ({fmt(r[0])}, {fmt(r[1])})']
        return []
    if kind == 'pie':
        rv, sv = ref['values'], stu['values']
        if len(rv) != len(sv):
            return [f'饼图应该分 {len(rv)} 块，你分了 {len(sv)} 块']
        for i, (r, s) in enumerate(zip(rv, sv)):
            if abs(r - s) > 1e-3:
                return [f'第 {i + 1} 块：你的占 {s * 100:.1f}%，应该占 {r * 100:.1f}%']
        return []
    return []


def _text_diff(what, ref, stu):
    if ref == stu:
        return []
    if not stu:
        return [f'没有写{what}，应该是「{ref}」']
    if not ref:
        return [f'{what}应该不写，你写了「{stu}」']
    return [f'{what}：你的是「{stu}」，应该是「{ref}」']


def compare_figures(ref_figs, stu_figs, opts):
    if not ref_figs:
        return []
    if not stu_figs:
        return ['没有画出图']
    if len(ref_figs) != len(stu_figs):
        return [f'应该画 {len(ref_figs)} 张图，你画了 {len(stu_figs)} 张']
    msgs = []
    for fi, (rf, sf) in enumerate(zip(ref_figs, stu_figs)):
        pre = f'第 {fi + 1} 张图：' if len(ref_figs) > 1 else ''
        if len(rf['axes']) != len(sf['axes']):
            msgs.append(f'{pre}应该有 {len(rf["axes"])} 个小图，你的有 {len(sf["axes"])} 个')
            continue
        for ra, sa in zip(rf['axes'], sf['axes']):
            part = []
            if opts.get('values', True):
                rk, sk = _marks_kind(ra), _marks_kind(sa)
                if rk != sk:
                    part.append(f'应该画{MARK_NAMES.get(rk, rk)}，你画的是{MARK_NAMES.get(sk, sk)}')
                elif rk:
                    part += compare_marks(ra['marks'], sa['marks'])
            if opts.get('title', True):
                part += _text_diff('标题', ra['title'], sa['title'])
            if opts.get('labels', False):
                part += _text_diff('横轴文字', ra['xlabel'], sa['xlabel'])
                part += _text_diff('纵轴文字', ra['ylabel'], sa['ylabel'])
            msgs += [pre + m for m in part]
        if len(msgs) >= MAX_MESSAGES:
            break
    return msgs


def describe_figures(figs):
    """出题页「试跑」那句：画了什么。"""
    if not figs:
        return '没有画出图'
    parts = []
    for f in figs:
        for ax in f['axes']:
            m = ax['marks']
            if not m:
                desc = '空白的图'
            elif m['kind'] == 'bar':
                desc = f'{len(m["values"])} 根柱子'
            elif m['kind'] == 'line':
                desc = f'{len(m["series"])} 条线'
            elif m['kind'] == 'scatter':
                desc = f'{len(m["points"])} 个点'
            elif m['kind'] == 'pie':
                desc = f'饼图 {len(m["values"])} 块'
            else:
                desc = '一张图片'
            if ax['title']:
                desc += f'，标题「{ax["title"]}」'
            parts.append(desc)
    return '；'.join(parts)


def compare(ref, stu, check):
    """ref / stu 是两边 kernel.run() 的结果。返回给学生看的说法列表，空就是通过。"""
    msgs = []
    for name in check.get('vars') or []:
        msgs += compare_value(name, ref['vars'][name], stu['vars'][name])
        if len(msgs) >= MAX_MESSAGES:
            return msgs[:MAX_MESSAGES]
    if check.get('figure'):
        msgs += compare_figures(ref['figures'] or [], stu['figures'] or [], check['figure'])
    return msgs[:MAX_MESSAGES]
