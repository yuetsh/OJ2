"""在学生进程里跑的那一半：逐步执行代码、收集输出、抽出用来比对的「指纹」。

这个模块由母进程预先 import（连同 pandas / matplotlib 一起），fork 出来的学生进程直接调
run()。它和学生代码在**同一个进程**里，所以学生要是存心改写这里的函数，指纹是能伪造的 ——
这是有意接受的：数据分析不是考试，防的是误伤和越界，不是防作弊（设计文档第 3.1 节）。
真正的比对在 compare.py，跑在处理进程里，学生碰不到。

输出的形状（outputs 的每一项）：
  {"kind": "text",  "text": "..."}
  {"kind": "table", "columns": [...], "rows": [[索引, 格, 格, ...], ...], "shape": [行, 列],
                    "skipAfter": 5 | None, "colsTruncated": bool}
  {"kind": "image", "png": "<base64>"}
"""

import ast
import base64
import builtins
import io
import math
import sys
import traceback
import warnings

import matplotlib

matplotlib.use('Agg')

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from matplotlib.container import BarContainer  # noqa: E402
from matplotlib.patches import Wedge  # noqa: E402

# 中文字体：镜像里装的文泉驿微米黑。seaborn 的 set_theme / set_style 会把 font.sans-serif
# 整个换掉（换成 Arial、DejaVu Sans …，都没有中文），所以不只在启动时设一次，
# 每次出图前再补一次（matplotlib 在画的那一刻才按 rcParams 找字体）。
CJK_FONT_NAME = 'WenQuanYi Micro Hei'
CJK_FONT_PATH = '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc'

MAX_TEXT = 64 * 1024  # 一步最多收这么多字的 print 输出
MAX_FIGURES = 10  # 一步最多出几张图
MAX_TABLE_ROWS = 60  # 超过就只给头 5 行、尾 5 行，和 pandas 自己的显示一个口径
MAX_TABLE_COLS = 30
MAX_FP_CELLS = 20000  # 指纹最多带这么多格，再大的表只比形状
MAX_FP_ITEMS = 5000


def ensure_cjk_font():
    sans = list(matplotlib.rcParams['font.sans-serif'])
    if not sans or sans[0] != CJK_FONT_NAME:
        matplotlib.rcParams['font.sans-serif'] = [CJK_FONT_NAME] + [f for f in sans if f != CJK_FONT_NAME]
    matplotlib.rcParams['font.family'] = ['sans-serif']
    # 负号用 Unicode 减号的话，文泉驿没有这个字形，会画成方框
    matplotlib.rcParams['axes.unicode_minus'] = False


def warm_up():
    """母进程启动时调一次：把字体缓存、jieba 词典、openpyxl 都提前走一遍，fork 出来的进程直接复用。"""
    import logging

    import jieba
    import openpyxl  # noqa: F401
    import seaborn  # noqa: F401
    import wordcloud.wordcloud

    # 词云默认字体没有中文，学生不该知道字体文件在哪 —— 换成镜像里的中文字体
    wordcloud.wordcloud.FONT_PATH = CJK_FONT_PATH
    jieba.setLogLevel(logging.WARNING)
    jieba.initialize()

    # print(表) 时按「一个汉字占两格」对齐，不然中文列名和数字错开（学生打印出来的表几乎都有中文）
    pd.set_option('display.unicode.east_asian_width', True)

    ensure_cjk_font()
    fig = plt.figure()
    plt.bar(['预热'], [1])
    plt.title('预热')
    fig.savefig(io.BytesIO(), format='png')
    plt.close('all')

    buf = io.BytesIO()
    pd.DataFrame({'a': [1]}).to_excel(buf, index=False)
    buf.seek(0)
    pd.read_excel(buf)


# ---------------------------------------------------------------- 输出


class Outputs:
    def __init__(self):
        self.items = []
        self.text_size = 0
        self.truncated = False

    def text(self, s):
        if self.text_size >= MAX_TEXT:
            self.truncated = True
            return
        if self.text_size + len(s) > MAX_TEXT:
            s = s[: MAX_TEXT - self.text_size]
            self.truncated = True
        self.text_size += len(s)
        if self.items and self.items[-1]['kind'] == 'text':
            self.items[-1]['text'] += s
        else:
            self.items.append({'kind': 'text', 'text': s})


class Capture(io.TextIOBase):
    def __init__(self, sink):
        self.sink = sink

    def writable(self):
        return True

    def write(self, s):
        if not isinstance(s, str):
            raise TypeError(f'write() argument must be str, not {type(s).__name__}')
        if self.sink is not None:
            self.sink.text(s)
        return len(s)


def fmt_cell(v):
    if v is None or v is pd.NA or v is pd.NaT:
        return 'NaN'
    if isinstance(v, (bool, np.bool_)):
        return str(bool(v))
    if isinstance(v, (int, np.integer)):
        return str(int(v))
    if isinstance(v, (float, np.floating)):
        f = float(v)
        if math.isnan(f):
            return 'NaN'
        return repr(round(f, 6))
    s = str(v)
    return s if len(s) <= 200 else s[:200] + '…'


def table_item(df):
    n, m = df.shape
    cols = list(df.columns[:MAX_TABLE_COLS])
    if n > MAX_TABLE_ROWS:
        part = pd.concat([df.iloc[:5], df.iloc[-5:]])
        skip_after = 5
    else:
        part = df
        skip_after = None
    rows = []
    for idx, (_, row) in zip(part.index, part.iterrows()):
        rows.append([fmt_cell(idx)] + [fmt_cell(row.iloc[j]) for j in range(len(cols))])
    return {
        'kind': 'table',
        'columns': [fmt_cell(c) for c in cols],
        'rows': rows,
        'shape': [int(n), int(m)],
        'skipAfter': skip_after,
        'colsTruncated': m > MAX_TABLE_COLS,
    }


def png_item(save):
    buf = io.BytesIO()
    save(buf)
    return {'kind': 'image', 'png': base64.b64encode(buf.getvalue()).decode('ascii')}


def is_matplotlib_object(v):
    mod = type(v).__module__ or ''
    if mod.startswith('matplotlib'):
        return True
    if isinstance(v, (list, tuple)) and v and all((type(x).__module__ or '').startswith('matplotlib') for x in v):
        return True
    return False


def display(value, out):
    """像 Jupyter 一样把最后一行表达式的值显示出来。图表对象（plt.bar 的返回值之类）不显示。"""
    if value is None or is_matplotlib_object(value):
        return
    if isinstance(value, pd.DataFrame):
        out.items.append(table_item(value))
    elif isinstance(value, pd.Series):
        name = '' if value.name is None else value.name
        out.items.append(table_item(value.to_frame(name=name)))
    elif (type(value).__module__ or '').startswith('PIL.') and hasattr(value, 'save'):
        out.items.append(png_item(lambda buf: value.save(buf, format='PNG')))
    elif (type(value).__module__ or '').startswith('wordcloud') and hasattr(value, 'to_image'):
        out.items.append(png_item(lambda buf: value.to_image().save(buf, format='PNG')))
    else:
        r = repr(value)
        out.text((r if len(r) <= 10000 else r[:10000] + '…') + '\n')


# ---------------------------------------------------------------- 图的指纹


def _num(v):
    f = float(v)
    return None if math.isnan(f) else f


def axes_fingerprint(fig, ax):
    title = ax.get_title()
    if not title and getattr(fig, '_suptitle', None) is not None:
        title = fig._suptitle.get_text()
    fp = {'title': title, 'xlabel': ax.get_xlabel(), 'ylabel': ax.get_ylabel(), 'marks': None}

    bars = [c for c in ax.containers if isinstance(c, BarContainer)]
    if bars:
        horizontal = getattr(bars[0], 'orientation', 'vertical') == 'horizontal'
        ticks = ax.get_yticks() if horizontal else ax.get_xticks()
        tick_labels = [t.get_text() for t in (ax.get_yticklabels() if horizontal else ax.get_xticklabels())]
        values, labels = [], []
        for c in bars:
            for p in c.patches:
                if horizontal:
                    values.append(_num(p.get_width()))
                    center, half = p.get_y() + p.get_height() / 2, p.get_height() / 2
                else:
                    values.append(_num(p.get_height()))
                    center, half = p.get_x() + p.get_width() / 2, p.get_width() / 2
                label = ''
                for t, text in zip(ticks, tick_labels):
                    if abs(t - center) <= half:
                        label = text
                        break
                labels.append(label)
        fp['marks'] = {'kind': 'bar', 'values': values[:MAX_FP_ITEMS], 'labels': labels[:MAX_FP_ITEMS]}
        return fp

    lines = [ln for ln in ax.get_lines() if ln.get_visible() and len(ln.get_xydata()) >= 2]
    if lines:
        series = []
        for ln in lines:
            xy = ln.get_xydata()[:MAX_FP_ITEMS]
            label = ln.get_label()
            series.append(
                {
                    'label': '' if label.startswith('_') else label,
                    'x': [_num(x) for x in xy[:, 0]],
                    'y': [_num(y) for y in xy[:, 1]],
                }
            )
        fp['marks'] = {'kind': 'line', 'series': series}
        return fp

    points = []
    for coll in ax.collections:
        offs = coll.get_offsets()
        if hasattr(offs, '__len__') and len(offs) and getattr(offs, 'ndim', 0) == 2:
            points.extend([[_num(x), _num(y)] for x, y in offs[:MAX_FP_ITEMS]])
    if points:
        fp['marks'] = {'kind': 'scatter', 'points': points[:MAX_FP_ITEMS]}
        return fp

    wedges = [p for p in ax.patches if isinstance(p, Wedge)]
    if wedges:
        total = sum((w.theta2 - w.theta1) for w in wedges) or 1
        fp['marks'] = {'kind': 'pie', 'values': [(w.theta2 - w.theta1) / total for w in wedges]}
        return fp

    if ax.images:
        fp['marks'] = {'kind': 'image'}
    return fp


def figure_fingerprint(fig):
    return {'axes': [axes_fingerprint(fig, ax) for ax in fig.get_axes() if ax.get_visible()]}


# ---------------------------------------------------------------- 变量的指纹


def _cell(v):
    if v is None or v is pd.NA or v is pd.NaT:
        return None
    if isinstance(v, (bool, np.bool_)):
        return bool(v)
    if isinstance(v, (int, np.integer)):
        return int(v)
    if isinstance(v, (float, np.floating)):
        f = float(v)
        return None if math.isnan(f) else f
    return str(v)


def _index(ix):
    return {'labels': [fmt_cell(x) for x in ix[:MAX_FP_ITEMS]], 'range': isinstance(ix, pd.RangeIndex)}


def value_fingerprint(v, depth=0):
    if v is None:
        return {'t': 'none'}
    if isinstance(v, (bool, np.bool_)):
        return {'t': 'bool', 'v': bool(v)}
    if isinstance(v, (int, float, np.integer, np.floating)):
        return {'t': 'num', 'v': _cell(v)}
    if isinstance(v, str):
        return {'t': 'str', 'v': v[:10000]}
    if isinstance(v, pd.DataFrame):
        n, m = v.shape
        fp = {'t': 'df', 'shape': [int(n), int(m)], 'columns': [fmt_cell(c) for c in v.columns], 'index': _index(v.index)}
        if n * m <= MAX_FP_CELLS:
            fp['values'] = [[_cell(x) for x in row] for row in v.itertuples(index=False, name=None)]
        return fp
    if isinstance(v, pd.Series):
        fp = {'t': 'series', 'length': int(len(v)), 'index': _index(v.index)}
        if len(v) <= MAX_FP_CELLS:
            fp['values'] = [_cell(x) for x in v.tolist()]
        return fp
    if isinstance(v, np.ndarray):
        v = v.tolist()
    if depth < 4 and isinstance(v, (list, tuple)):
        return {'t': 'list', 'v': [value_fingerprint(x, depth + 1) for x in v[:MAX_FP_ITEMS]], 'length': len(v)}
    if depth < 4 and isinstance(v, dict):
        return {'t': 'dict', 'items': [[fmt_cell(k), value_fingerprint(x, depth + 1)] for k, x in list(v.items())[:MAX_FP_ITEMS]]}
    if depth < 4 and isinstance(v, (set, frozenset)):
        return {'t': 'set', 'v': sorted(repr(x) for x in v)[:MAX_FP_ITEMS]}
    r = repr(v)
    return {'t': 'repr', 'type': type(v).__name__, 'v': r[:2000]}


# ---------------------------------------------------------------- 执行


def step_filename(i):
    return f'<step{i + 1}>'


def error_info(e, step):
    """报错只留学生自己那几行代码的栈帧；英文原文留给前端翻译（apps/web/src/utils/pythonError.ts）。"""
    fname = step_filename(step)
    if isinstance(e, SyntaxError) and e.filename == fname:
        lines = traceback.format_exception_only(type(e), e)
        return {'step': step + 1, 'type': type(e).__name__, 'message': str(e.msg), 'line': e.lineno, 'traceback': ''.join(lines)}
    frames = [f for f in traceback.extract_tb(e.__traceback__) if f.filename == fname]
    line = frames[-1].lineno if frames else None
    text = ''
    if frames:
        text = 'Traceback (most recent call last):\n' + ''.join(traceback.format_list(frames))
    text += ''.join(traceback.format_exception_only(type(e), e))
    return {'step': step + 1, 'type': type(e).__name__, 'message': str(e), 'line': line, 'traceback': text}


def exec_step(code, i, ns, out):
    fname = step_filename(i)
    tree = ast.parse(code, filename=fname)
    last = None
    if tree.body and isinstance(tree.body[-1], ast.Expr):
        last = ast.Expression(tree.body.pop().value)
    exec(compile(tree, fname, 'exec'), ns)
    if last is not None:
        display(eval(compile(last, fname, 'eval'), ns), out)


def run(job):
    """job = {"steps": [代码, ...], "vars": [变量名, ...], "figure": bool, "script": str | None}

    依次跑完所有步骤，只收最后一步的输出。前面某一步报错就停在那一步，报那一步的错。
    """
    warnings.simplefilter('ignore')
    sys.stdin = io.StringIO('')
    ns = {'__name__': '__main__', '__builtins__': builtins}
    steps = job['steps']
    result = {'outputs': [], 'error': None, 'truncated': False, 'vars': {}, 'figures': None, 'script': None}

    for i, code in enumerate(steps):
        is_last = i == len(steps) - 1
        out = Outputs()
        sys.stdout = sys.stderr = Capture(out if is_last else None)
        try:
            exec_step(code, i, ns, out)
        except SystemExit:
            pass
        except BaseException as e:  # noqa: BLE001 —— 学生代码里什么都可能抛
            sys.stdout = sys.stderr = Capture(None)
            result['error'] = error_info(e, i)
            if is_last:
                result['outputs'] = out.items
            plt.close('all')
            return result
        sys.stdout = sys.stderr = Capture(None)

        if not is_last:
            # 和 Jupyter 一样，一步跑完图就关掉，不带到下一步
            plt.close('all')
            continue

        ensure_cjk_font()
        figures = []
        for num in plt.get_fignums()[:MAX_FIGURES]:
            fig = plt.figure(num)
            try:
                out.items.append(png_item(lambda buf: fig.savefig(buf, format='png', dpi=100, bbox_inches='tight')))
            except Exception as e:  # noqa: BLE001
                result['error'] = error_info(e, i)
                break
            if job.get('figure'):
                figures.append(figure_fingerprint(fig))
        if job.get('figure'):
            result['figures'] = figures

        for name in job.get('vars') or []:
            result['vars'][name] = value_fingerprint(ns[name]) if name in ns else {'t': 'missing'}

        script = job.get('script')
        if script:
            result['script'] = run_script(script, ns)

        plt.close('all')
        result['outputs'] = out.items
        result['truncated'] = out.truncated
    return result


def run_script(script, ns):
    """老师的检查脚本：在学生代码跑完的同一个命名空间里执行，assert 的说明文字就是给学生的提示。"""
    try:
        exec(compile(script, '<check>', 'exec'), ns)
    except AssertionError as e:
        msg = str(e).strip()
        return {'passed': False, 'message': msg or None}
    except BaseException as e:  # noqa: BLE001
        return {'passed': False, 'scriptError': ''.join(traceback.format_exception_only(type(e), e)).strip()}
    return {'passed': True}
