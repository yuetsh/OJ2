"""「数据分析」的运行器：母进程 + 每个请求一个处理进程 + 每次运行一个学生进程。

    母进程（root）   启动时 import 好 pandas / matplotlib / seaborn / jieba / wordcloud 并预热，
                    然后在 unix socket 上收请求。单线程，所以 fork 是安全的。
      └ 处理进程     ForkingMixIn 给每个请求 fork 一个：解析请求、建临时目录、放素材，
         │           再 fork 学生进程（对照答案时连老师的答案一起、两个并行），等它们跑完，比对，回结果。
         └ 学生进程   换成独立的普通用户（每次一个 uid），限 CPU / 内存 / 写文件大小 / 进程数，
                     关掉继承来的全部文件描述符，然后调 kernel.run()。

为什么 import 一次、每次 fork：import pandas + matplotlib 本身约 0.7 秒 CPU，服务器只有 2 核，
一个班 40 人一起点运行要排十几秒；fork 出来的进程直接带着已加载的库，一次运行零点几秒。
实测见 docs/specs/2026-11-12-data-analysis-design.md 第 4.1 节。

协议见 README.md。
"""

import base64
import http.server
import json
import os
import re
import resource
import select
import shutil
import signal
import socketserver
import sys
import tempfile
import time
import traceback

# 这几个必须在 import numpy 之前设：多线程的 BLAS 在 fork 之后可能卡死，而且学生进程限了进程数
for _k in ('OPENBLAS_NUM_THREADS', 'OMP_NUM_THREADS', 'MKL_NUM_THREADS', 'NUMEXPR_NUM_THREADS'):
    os.environ[_k] = '1'
os.environ['MPLBACKEND'] = 'Agg'
os.environ.setdefault('MPLCONFIGDIR', '/tmp/matplotlib')

_t0 = time.monotonic()
import kernel  # noqa: E402
import compare  # noqa: E402

kernel.warm_up()
WARM_SECONDS = time.monotonic() - _t0

SOCKET = os.environ.get('DATA_ANALYSIS_SOCKET', '/run/data-analysis/data-analysis.sock')
# socket 文件归谁：api 用哪个 uid 连就填哪个（容器里的 api 是 root = 0，本机 dev 是自己的 uid）。
# 权限 0600，学生进程的 uid 连不上，免得学生代码自己给自己发运行请求。
SOCKET_UID = int(os.environ.get('DATA_ANALYSIS_SOCKET_UID', '0'))
CONCURRENCY = int(os.environ.get('DATA_ANALYSIS_CONCURRENCY', '3'))
CPU_SECONDS = int(os.environ.get('DATA_ANALYSIS_CPU_SECONDS', '10'))
WALL_SECONDS = float(os.environ.get('DATA_ANALYSIS_WALL_SECONDS', '20'))
MEMORY_MB = int(os.environ.get('DATA_ANALYSIS_MEMORY_MB', '512'))
FILE_MB = 32
RUNS_DIR = '/tmp/runs'

MAX_BODY = 40 * 1024 * 1024
MAX_CODE = 200 * 1024
MAX_STEPS = 50
ASSET_NAME = re.compile(r'^[^/\\\x00]{1,100}$')


def vm_size_kb():
    with open('/proc/self/status') as f:
        for line in f:
            if line.startswith('VmSize:'):
                return int(line.split()[1])
    return 0


# 母进程预热完的虚拟内存，学生进程在这之上再给 MEMORY_MB。限的是地址空间（RLIMIT_AS），
# numpy 和 matplotlib 本身就占了几百 MB 的虚拟地址，不能拿一个固定值去卡。
BASE_VM_KB = vm_size_kb()


def log(msg):
    print(time.strftime('%H:%M:%S'), msg, file=sys.stderr, flush=True)


class BadRequest(Exception):
    pass


# ---------------------------------------------------------------- 学生进程


def spawn(job, assets):
    """fork 一个学生进程跑 job，返回 (pid, 目录)。"""
    run_dir = tempfile.mkdtemp(dir=RUNS_DIR)
    for a in assets:
        with open(os.path.join(run_dir, a['name']), 'wb') as f:
            f.write(a['bytes'])
    pid = os.fork()
    if pid:
        return pid, run_dir
    status = 1
    try:
        child(job, run_dir)
        status = 0
    except BaseException:  # noqa: BLE001
        try:
            os.write(2, traceback.format_exc().encode())
        except Exception:  # noqa: BLE001
            pass
    os._exit(status)


def child(job, run_dir):
    os.setsid()  # 自成一个进程组：超时的时候连学生代码开的子进程一起杀
    uid = 20000 + os.getpid() % 40000
    for name in os.listdir(run_dir):
        os.chown(os.path.join(run_dir, name), uid, uid)
    os.chown(run_dir, uid, uid)
    os.chmod(run_dir, 0o700)
    os.chdir(run_dir)
    with open('/proc/self/oom_score_adj', 'w') as f:
        f.write('1000')  # 内存真满了先杀学生进程

    resource.setrlimit(resource.RLIMIT_CPU, (CPU_SECONDS, CPU_SECONDS + 1))
    mem = (BASE_VM_KB + MEMORY_MB * 1024) * 1024
    resource.setrlimit(resource.RLIMIT_AS, (mem, mem))
    fsize = FILE_MB * 1024 * 1024
    resource.setrlimit(resource.RLIMIT_FSIZE, (fsize, fsize))
    resource.setrlimit(resource.RLIMIT_NPROC, (16, 16))
    resource.setrlimit(resource.RLIMIT_NOFILE, (256, 256))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    signal.signal(signal.SIGXFSZ, signal.SIG_IGN)  # 写超了让 write 报错，而不是直接被信号杀掉

    # 继承来的 socket（监听的、这次请求的）全部关掉，学生代码碰不到 api 的连接
    devnull = os.open(os.devnull, os.O_RDWR)
    for fd in (0, 1, 2):
        os.dup2(devnull, fd)
    os.closerange(3, 65536)

    os.setgroups([])
    os.setgid(uid)
    os.setuid(uid)
    os.environ['HOME'] = run_dir
    os.environ['TMPDIR'] = run_dir

    result = kernel.run(job)
    data = json.dumps(result, ensure_ascii=False).encode()
    fd = os.open(os.path.join(run_dir, '.result.json'), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'wb') as f:
        f.write(data)


def wait_all(runs):
    """等一批学生进程。超时的整组杀掉。返回 [(结果 | None, 失败原因 | None), ...]。"""
    deadline = time.monotonic() + WALL_SECONDS
    pending = {}
    for i, (pid, _) in enumerate(runs):
        pending[os.pidfd_open(pid)] = i
    timed_out = set()
    poller = select.poll()
    for fd in pending:
        poller.register(fd, select.POLLIN)
    while pending:
        left = deadline - time.monotonic()
        if left <= 0:
            for fd, i in pending.items():
                timed_out.add(i)
                os.close(fd)
            break
        for fd, _ in poller.poll(left * 1000):
            i = pending.pop(fd)
            poller.unregister(fd)
            os.close(fd)

    out = []
    for i, (pid, run_dir) in enumerate(runs):
        try:
            os.killpg(pid, signal.SIGKILL)  # 学生代码自己开的子进程也收掉
        except ProcessLookupError:
            pass
        _, st = os.waitpid(pid, 0)
        result, failure = None, None
        if i in timed_out:
            failure = 'timeout'
        else:
            path = os.path.join(run_dir, '.result.json')
            try:
                if os.path.getsize(path) > MAX_BODY:
                    failure = 'crashed'
                else:
                    with open(path, 'rb') as f:
                        result = json.loads(f.read())
            except (OSError, ValueError):
                failure = 'crashed'
            if failure and os.WIFSIGNALED(st) and os.WTERMSIG(st) in (signal.SIGXCPU, signal.SIGKILL):
                failure = 'timeout'
        shutil.rmtree(run_dir, ignore_errors=True)
        out.append((result, failure))
    return out


def failure_error(failure, step):
    if failure == 'timeout':
        return {'step': step, 'type': 'Timeout', 'message': f'运行超过了 {CPU_SECONDS} 秒', 'line': None, 'traceback': ''}
    return {'step': step, 'type': 'Crashed', 'message': '程序意外退出了（可能是用的内存太多）', 'line': None, 'traceback': ''}


# ---------------------------------------------------------------- 一次请求


def parse_request(body):
    try:
        req = json.loads(body)
    except ValueError:
        raise BadRequest('不是合法的 JSON')
    if not isinstance(req, dict):
        raise BadRequest('请求要是一个对象')

    def codes(key):
        v = req.get(key)
        if v is None:
            return None
        if not isinstance(v, list) or not v or len(v) > MAX_STEPS or not all(isinstance(c, str) for c in v):
            raise BadRequest(f'{key} 要是 1–{MAX_STEPS} 段代码')
        if sum(len(c) for c in v) > MAX_CODE:
            raise BadRequest(f'{key} 太长')
        return v

    steps = codes('steps')
    if steps is None:
        raise BadRequest('缺 steps')
    reference = codes('reference')

    assets = []
    for a in req.get('assets') or []:
        name = a.get('name') if isinstance(a, dict) else None
        if not isinstance(name, str) or not ASSET_NAME.match(name) or name.startswith('.'):
            raise BadRequest('素材文件名不合法')
        try:
            data = base64.b64decode(a.get('data') or '', validate=True)
        except ValueError:
            raise BadRequest(f'素材 {name} 不是合法的 base64')
        assets.append({'name': name, 'bytes': data})

    check = req.get('check') or {'kind': 'none'}
    kind = check.get('kind') if isinstance(check, dict) else None
    if kind not in ('none', 'compare', 'script'):
        raise BadRequest('check.kind 只能是 none / compare / script')
    if kind == 'compare':
        if reference is None or len(reference) != len(steps):
            raise BadRequest('对照答案要给 reference，而且和 steps 一样多步')
        names = check.get('vars') or []
        if not isinstance(names, list) or not all(isinstance(n, str) and n.isidentifier() for n in names):
            raise BadRequest('vars 要是变量名列表')
        fig = check.get('figure')
        if fig is not None and not isinstance(fig, dict):
            raise BadRequest('figure 要是对象或 null')
        if not names and fig is None:
            raise BadRequest('对照答案至少要比一个变量或比图')
    if kind == 'script' and not isinstance(check.get('script'), str):
        raise BadRequest('检查脚本要是一段代码')

    # api 缓存的答案比对数据（之前某次运行回的 referenceResult）。带了就不再跑答案
    cached = req.get('referenceResult')
    if cached is not None:
        if kind != 'compare' or not isinstance(cached, dict) or not {'error', 'vars', 'figures'} <= cached.keys():
            raise BadRequest('referenceResult 的形状不对')
        if not isinstance(cached['vars'], dict) or any(n not in cached['vars'] for n in check.get('vars') or []):
            raise BadRequest('referenceResult 里缺要比的变量')
    return steps, reference, assets, check, cached


def handle_run(body):
    t0 = time.monotonic()
    steps, reference, assets, check, cached = parse_request(body)
    kind = check['kind']
    want = {
        'vars': (check.get('vars') or []) if kind == 'compare' else [],
        'figure': kind == 'compare' and check.get('figure') is not None,
    }
    stu_job = dict(want, steps=steps, script=check.get('script') if kind == 'script' else None)
    runs = [spawn(stu_job, assets)]
    # 对照答案：答案对全班都一样，api 记住它的比对数据（referenceResult），之后带过来就不再跑 ——
    # 2 核的服务器上这能省掉将近一半的 CPU（40 人同时运行实测见 README）
    if kind == 'compare' and cached is None:
        runs.append(spawn(dict(want, steps=reference, script=None), assets))
    results = wait_all(runs)
    if kind == 'compare' and cached is not None:
        results.append((cached, None))

    stu, stu_fail = results[0]
    last = len(steps)
    resp = {
        'ok': False,
        'outputs': [],
        'truncated': False,
        'error': None,
        'check': None,
        'referenceError': None,
        'referenceSummary': None,
        # 这次真跑了答案、而且答案跑通了，就把比对数据交回去给 api 缓存（不含图片，只有指纹）
        'referenceResult': None,
    }
    if stu_fail:
        resp['error'] = failure_error(stu_fail, last)
    else:
        resp['outputs'] = stu['outputs']
        resp['truncated'] = stu['truncated']
        resp['error'] = stu['error']
        resp['ok'] = stu['error'] is None

    if kind == 'compare':
        ref, ref_fail = results[1]
        if ref_fail:
            resp['referenceError'] = failure_error(ref_fail, last)
        elif ref['error']:
            resp['referenceError'] = ref['error']
        else:
            missing = [n for n in want['vars'] if ref['vars'][n]['t'] == 'missing']
            if missing:
                resp['referenceError'] = {'step': last, 'type': 'Missing', 'message': f'答案里没有 {missing[0]}', 'line': None, 'traceback': ''}
            if want['figure']:
                resp['referenceSummary'] = compare.describe_figures(ref['figures'])
            if cached is None and not missing:
                resp['referenceResult'] = {'error': None, 'vars': ref['vars'], 'figures': ref['figures']}
        if resp['ok'] and not resp['referenceError']:
            msgs = compare.compare(ref, stu, check)
            resp['check'] = {'passed': not msgs, 'messages': msgs}
    elif kind == 'script' and resp['ok']:
        s = stu['script']
        msgs = [s['message']] if s.get('message') else []
        resp['check'] = {'passed': s['passed'], 'messages': msgs}
        if s.get('scriptError'):
            resp['check']['scriptError'] = s['scriptError']
    elif kind == 'none' and resp['ok']:
        resp['check'] = {'passed': True, 'messages': []}

    resp['timeMs'] = round((time.monotonic() - t0) * 1000)
    passed = resp['check']['passed'] if resp['check'] else None
    ref_note = ' ref=cached' if cached is not None else ''
    log(f'run steps={len(steps)} check={kind}{ref_note} ok={resp["ok"]} passed={passed} {resp["timeMs"]}ms')
    return resp


def versions():
    import importlib.metadata as md

    pkgs = ['pandas', 'numpy', 'matplotlib', 'seaborn', 'openpyxl', 'jieba', 'wordcloud']
    return {'python': sys.version.split()[0], **{p: md.version(p) for p in pkgs}}


VERSIONS = versions()


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def address_string(self):
        return 'unix'

    def log_message(self, format, *args):  # noqa: A002 —— 父类的参数名
        pass  # 每次运行在 handle_run 里自己记一行

    def send_json(self, code, obj):
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Connection', 'close')
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == '/health':
            self.send_json(200, {'ok': True, 'warmSeconds': round(WARM_SECONDS, 2), 'concurrency': CONCURRENCY, 'versions': VERSIONS})
        else:
            self.send_json(404, {'error': 'not found'})

    def do_POST(self):
        if self.path != '/run':
            self.send_json(404, {'error': 'not found'})
            return
        try:
            length = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            length = -1
        if length <= 0 or length > MAX_BODY:
            self.send_json(413 if length > MAX_BODY else 400, {'error': '请求体大小不对'})
            return
        body = self.rfile.read(length)
        try:
            self.send_json(200, handle_run(body))
        except BadRequest as e:
            self.send_json(400, {'error': str(e)})
        except Exception:  # noqa: BLE001
            log(traceback.format_exc())
            self.send_json(500, {'error': '运行器内部出错'})


class Server(socketserver.ForkingMixIn, socketserver.UnixStreamServer):
    request_queue_size = 128
    # 同时在处理的请求数。超过的在 socket 的 backlog 里排队（ForkingMixIn 到上限会阻塞着等一个结束），
    # 每个请求最多两个学生进程。2 核的机器开再多也只是抢 CPU，还多占内存。
    max_children = CONCURRENCY
    block_on_close = False


def main():
    os.makedirs(RUNS_DIR, exist_ok=True)
    os.chmod(RUNS_DIR, 0o711)  # 学生进程能进自己的目录，但列不出别人的
    os.makedirs(os.path.dirname(SOCKET), exist_ok=True)
    try:
        os.unlink(SOCKET)
    except FileNotFoundError:
        pass
    server = Server(SOCKET, Handler)
    os.chown(SOCKET, SOCKET_UID, -1)
    os.chmod(SOCKET, 0o600)
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    log(f'data-analysis runner ready on {SOCKET} (预热 {WARM_SECONDS:.2f}s, 并发 {CONCURRENCY}, {VERSIONS})')
    server.serve_forever()


if __name__ == '__main__':
    main()
