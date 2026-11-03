"""二采（放大 + 补细节）：Topaz Video AI Proteus / ffmpeg 两条外部通道。

完全旁路：不碰采样、不进 ComfyUI 队列，只对**已经落盘的成片 mp4** 起一个外部进程，
跑完把结果写到你指定的路径。前端在预览列里点一下就能用。

为什么不是「在节点里做」：
  * Proteus 是 Topaz 的商业模型，只能在它自带的 ffmpeg.exe 里跑；
  * 16G 显存下它和 H3 抢卡，必须串行，不能塞进同一次采样；
  * 成片已经编码过一遍，再走 latent 放大要重新解码/编码，反而更慢。

模型目录（踩过坑，务必分清两层）：
  * **清单目录**里是 `prob-4.json` 这类描述符，一共几十个，只有几 MB；
  * **权重目录**里是 `prob-v4-fgnet-fp32-384x480-4x-....tz` 这类瓦片，几 GB。
  这台机器上清单在 `C:\\ProgramData\\...\\models`、权重在 `G:\\ProgramData\\...\\models`，
  **两个变量都得给**，少一个 CLI 就报 `No models found in directory`（它不会告诉你少的是哪个）：
      TVAI_MODEL_DIR       = 清单目录
      TVAI_MODEL_DATA_DIR  = 权重目录
  之前只设 MODEL_DIR 指到权重盘，于是清单读不到 → 连默认的 ahq-12 都「not found」。
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path

log = logging.getLogger("ComfyUI-MiniMaxH3-Director.director.upscale")

VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi"}
MAX_JOBS = 8
LOG_TAIL = 40
_CREATE_NO_WINDOW = 0x08000000 if os.name == "nt" else 0

# ── Topaz 定位 ────────────────────────────────────────────────────────────────
# 装在哪没有统一规范：官方安装器默认 C:\Program Files，但这台机器装在 H:，
# 日志里还留着 G:\Program Files 的旧路径。所以按候选表逐个试，允许环境变量覆盖。
_TOPAZ_ROOTS = [
    os.environ.get("ALBER_TOPAZ_DIR", ""),
    r"H:\Topaz Labs LLC\Topaz Video AI",
    r"C:\Program Files\Topaz Labs LLC\Topaz Video AI",
    r"C:\Program Files (x86)\Topaz Labs LLC\Topaz Video AI",
    r"D:\Topaz Labs LLC\Topaz Video AI",
    r"G:\Topaz Labs LLC\Topaz Video AI",
    r"E:\Topaz Labs LLC\Topaz Video AI",
]
# 清单目录（*.json）与权重目录（*.tz）分开找：官方安装器两者同目录，
# 但这台机器把权重挪到了 G:，只按一种目录结构找必然扑空。
_MANIFEST_DIRS = [
    os.environ.get("ALBER_TOPAZ_MODEL_DIR", ""),
    r"C:\ProgramData\Topaz Labs LLC\Topaz Video AI\models",
    r"G:\ProgramData\Topaz Labs LLC\Topaz Video AI\models",
    r"D:\ProgramData\Topaz Labs LLC\Topaz Video AI\models",
]
_WEIGHT_DIRS = [
    os.environ.get("ALBER_TOPAZ_WEIGHT_DIR", ""),
    r"G:\ProgramData\Topaz Labs LLC\Topaz Video AI\models",
    r"C:\ProgramData\Topaz Labs LLC\Topaz Video AI\models",
    r"D:\ProgramData\Topaz Labs LLC\Topaz Video AI\models",
]

_CACHE: dict | None = None
_CACHE_AT = 0.0
_PROBE: dict | None = None
_PROBE_AT = 0.0
_CACHE_TTL = 30.0
_PROBE_TTL = 600.0


def _detect_topaz(force: bool = False) -> dict:
    """找 ffmpeg.exe、清单目录、权重目录。结果缓存 30 秒。"""
    global _CACHE, _CACHE_AT
    now = time.time()
    if _CACHE is not None and not force and now - _CACHE_AT < _CACHE_TTL:
        return _CACHE

    root = ""
    ffmpeg = ""
    for cand in _TOPAZ_ROOTS:
        if not cand:
            continue
        exe = os.path.join(cand, "ffmpeg.exe")
        if os.path.isfile(exe):
            root, ffmpeg = cand, exe
            break

    extra = []
    if root:
        extra = [os.path.join(root, "models"), os.path.join(os.path.dirname(root), "models")]

    manifest, weights, tiles = "", "", []
    for cand in [d for d in _MANIFEST_DIRS if d] + extra:
        if not os.path.isdir(cand):
            continue
        # 认清单看 json：只有它才知道 prob-4 该配哪一档瓦片
        if not manifest and os.path.isfile(os.path.join(cand, "prob-4.json")):
            manifest = cand
    for cand in [d for d in _WEIGHT_DIRS if d] + extra:
        if not os.path.isdir(cand):
            continue
        if not weights:
            try:
                found = sorted(p.name for p in Path(cand).glob("prob-v4-*.tz"))
            except OSError:
                found = []
            if found:
                weights, tiles = cand, found

    info = {
        "found": bool(ffmpeg),
        "root": root,
        "ffmpeg": ffmpeg,
        # manifest / weights 是真正要喂给 CLI 的两个路径；model_dir 保留给旧前端读
        "manifest_dir": manifest,
        "weights_dir": weights,
        "model_dir": manifest or weights,
        "tiles": len(tiles),
        "model_files": tiles[:3],
    }
    _CACHE, _CACHE_AT = info, now
    return info


def _topaz_env(tz: dict) -> dict:
    """两个目录变量一起给。少任何一个 → No models found。"""
    env = dict(os.environ)
    if tz.get("manifest_dir"):
        env["TVAI_MODEL_DIR"] = tz["manifest_dir"]
    if tz.get("weights_dir"):
        env["TVAI_MODEL_DATA_DIR"] = tz["weights_dir"]
    return env


def _ffprobe_bin() -> str:
    """优先用 ComfyUI 环境里的 ffprobe，其次 PATH，最后借 Topaz 自带的那份。"""
    local = shutil.which("ffprobe")
    if local:
        return local
    topaz = _detect_topaz().get("root") or ""
    if topaz:
        cand = os.path.join(topaz, "ffprobe.exe")
        if os.path.isfile(cand):
            return cand
    try:
        import imageio_ffmpeg  # type: ignore

        exe = imageio_ffmpeg.get_ffmpeg_exe()
        cand = os.path.join(os.path.dirname(exe), "ffprobe" + (".exe" if os.name == "nt" else ""))
        if os.path.isfile(cand):
            return cand
    except Exception:
        pass
    return ""


def _ffmpeg_bin() -> str:
    local = shutil.which("ffmpeg")
    if local:
        return local
    topaz = _detect_topaz().get("root") or ""
    if topaz:
        cand = os.path.join(topaz, "ffmpeg.exe")
        if os.path.isfile(cand):
            return cand
    return ""


def _video_info(path: str) -> dict:
    """读宽高/帧率/帧数/时长。拿不到就返回空 dict，前端自己降级。"""
    exe = _ffprobe_bin()
    if not exe or not os.path.isfile(path):
        return {}
    cmd = [
        exe, "-v", "error", "-select_streams", "v:0",
        # 两个 -show_entries 会互相覆盖（第二个把 stream 项吃掉，width/height 就读成 0），
        # 必须写成同一段里的分号形式。
        "-show_entries", "stream=width,height,r_frame_rate,nb_frames,duration,codec_name:format=duration,size",
        "-of", "json", path,
    ]
    try:
        raw = subprocess.run(
            cmd, capture_output=True, timeout=30, creationflags=_CREATE_NO_WINDOW
        ).stdout.decode("utf-8", "replace")
        data = json.loads(raw or "{}")
    except Exception as exc:
        log.debug("upscale: ffprobe 失败 %s: %s", path, exc)
        return {}

    st = (data.get("streams") or [{}])[0]
    fmt = data.get("format") or {}
    num, _, den = str(st.get("r_frame_rate") or "0/1").partition("/")
    try:
        fps = float(num) / float(den or 1)
    except (TypeError, ValueError, ZeroDivisionError):
        fps = 0.0
    try:
        duration = float(st.get("duration") or fmt.get("duration") or 0)
    except (TypeError, ValueError):
        duration = 0.0
    try:
        frames = int(st.get("nb_frames") or 0)
    except (TypeError, ValueError):
        frames = 0
    if not frames and fps and duration:
        frames = int(round(fps * duration))
    try:
        size = int(fmt.get("size") or os.path.getsize(path))
    except (TypeError, ValueError, OSError):
        size = 0
    return {
        "width": int(st.get("width") or 0),
        "height": int(st.get("height") or 0),
        "fps": round(fps, 3),
        "frames": frames,
        "duration": round(duration, 3),
        "size": size,
        "codec": st.get("codec_name") or "",
    }


def _even(n: int) -> int:
    """yuv420p 要求偶数边长，向上取偶。"""
    n = int(n)
    return n if n % 2 == 0 else n + 1


def _fit_size(w: int, h: int, scale: float, mode: str, target_w: int, target_h: int) -> tuple[int, int]:
    """按模式算目标画布。mode: 2x / 1.5x / 1080p / custom。"""
    if mode == "custom":
        return _even(target_w), _even(target_h)
    if mode == "1080p":
        # 短边对齐 1080，保持比例（竖屏就是 1080 宽）
        if w >= h:
            return _even(1080 * w / max(1, h)), 1080
        return 1080, _even(1080 * h / max(1, w))
    return _even(w * scale), _even(h * scale)


def _probe_topaz(force: bool = False) -> dict:
    """真跑一次 2 帧的 tvai_up，确认清单+权重都能被枚举出来。

    只查文件在不在不够：真正会失败的是「清单目录没给对」，症状是连默认
    模型都报 not found。所以这里用和正式作业完全相同的 env 与滤镜写法，
    拿 480x384 的小画布跑 2 帧（这档瓦片权重里一定有）。
    """
    global _PROBE, _PROBE_AT
    now = time.time()
    if _PROBE is not None and not force and now - _PROBE_AT < _PROBE_TTL:
        return _PROBE

    info = _detect_topaz()
    if not info["found"]:
        res = {"ok": False, "reason": "没找到 Topaz Video AI 的 ffmpeg.exe", "detail": ""}
    elif not info["manifest_dir"]:
        res = {"ok": False, "reason": "没找到 Topaz 模型清单目录（缺 prob-4.json）", "detail": ""}
    elif not info["weights_dir"]:
        res = {"ok": False, "reason": "没找到 Topaz 权重目录（缺 prob-v4-*.tz）", "detail": ""}
    else:
        cmd = [
            info["ffmpeg"], "-hide_banner", "-nostdin", "-nostats", "-loglevel", "error",
            "-f", "lavfi", "-i", "color=c=black:s=480x384:r=24:d=0.2",
            "-vf", "tvai_up=model=prob-4:scale=0:w=960:h=768:device=-2",
            "-frames:v", "2", "-f", "null", "-",
        ]
        try:
            proc = subprocess.run(
                cmd, capture_output=True, timeout=180, env=_topaz_env(info),
                cwd=info["root"] or None, creationflags=_CREATE_NO_WINDOW,
            )
            err = (proc.stderr or b"").decode("utf-8", "replace")
            low = err.lower()
            ok = proc.returncode == 0 and "no models found" not in low and "model not found" not in low
            if ok:
                res = {"ok": True, "reason": "", "detail": ""}
            elif "no models found" in low or "model not found" in low:
                res = {
                    "ok": False,
                    "reason": "Topaz 没枚举到 prob-4（清单目录不对，或模型文件被挪走）",
                    "detail": _squash(err),
                }
            else:
                res = {"ok": False, "reason": "Topaz 自检失败", "detail": _squash(err)}
        except subprocess.TimeoutExpired:
            res = {"ok": False, "reason": "Topaz 自检超时（>180s）", "detail": ""}
        except Exception as exc:
            res = {"ok": False, "reason": f"Topaz 自检异常：{exc}", "detail": ""}

    res["at"] = int(now)
    _PROBE, _PROBE_AT = res, now
    return res


def _squash(text: str, limit: int = 400) -> str:
    lines = [ln.strip() for ln in str(text or "").splitlines() if ln.strip()]
    # Topaz 的日志前面带时间戳，只留最后几行有效信息
    keep = [ln for ln in lines if any(k in ln.lower() for k in ("error", "critical", "model", "fail"))]
    out = "\n".join((keep or lines)[-4:])
    return out[:limit]


# ── 作业管理 ──────────────────────────────────────────────────────────────────
_JOBS: dict[str, dict] = {}
_JOBS_LOCK = threading.Lock()


def _job_new(kind: str) -> dict:
    jid = uuid.uuid4().hex[:12]
    job = {
        "id": jid,
        "kind": kind,
        "state": "running",       # running | done | error | cancelled
        "pct": 0.0,
        "frame": 0,
        "total": 0,
        "started": time.time(),
        "finished": 0.0,
        "out_path": "",
        "error": "",
        "log": [],
        "proc": None,
    }
    with _JOBS_LOCK:
        if len(_JOBS) >= MAX_JOBS:
            # 先清掉结束最久的，避免无限增长
            for key in sorted(_JOBS, key=lambda k: _JOBS[k]["started"])[: max(1, len(_JOBS) - MAX_JOBS + 1)]:
                if _JOBS[key]["state"] != "running":
                    _JOBS.pop(key, None)
        _JOBS[jid] = job
    return job


def _job_log(job: dict, line: str) -> None:
    line = line.rstrip()
    if not line:
        return
    buf = job["log"]
    buf.append(line)
    if len(buf) > LOG_TAIL:
        del buf[: len(buf) - LOG_TAIL]


def _job_public(job: dict) -> dict:
    return {
        "id": job["id"],
        "state": job["state"],
        "pct": round(job["pct"], 1),
        "frame": job["frame"],
        "total": job["total"],
        "elapsed": round((job["finished"] or time.time()) - job["started"], 1),
        "out_path": job["out_path"],
        "error": job["error"],
        "log": list(job["log"]),
        "info": job.get("info") or {},
        "engine": job["kind"],
    }


def _drain(stream, job: dict, on_line) -> None:
    try:
        for raw in iter(stream.readline, b""):
            line = raw.decode("utf-8", "replace").rstrip("\r\n")
            if not line:
                continue
            on_line(line)
    except Exception:
        pass
    finally:
        try:
            stream.close()
        except Exception:
            pass


def _run_job(job: dict, cmd: list[str], env: dict | None, cwd: str | None, out_part: str, out_final: str) -> None:
    total = int(job.get("total") or 0)

    def on_stdout(line: str) -> None:
        # -progress pipe:1 的输出形如 key=value；frame= 是已写出的帧数
        if line.startswith("frame="):
            try:
                job["frame"] = int(line.split("=", 1)[1])
            except (TypeError, ValueError):
                return
            if total > 0:
                job["pct"] = min(99.0, job["frame"] * 100.0 / total)
        elif line.startswith("out_time_ms=") and total <= 0:
            _job_log(job, line)

    def on_stderr(line: str) -> None:
        _job_log(job, line)

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            stdin=subprocess.DEVNULL,
            env=env,
            cwd=cwd or None,
            creationflags=_CREATE_NO_WINDOW,
        )
        job["proc"] = proc
        t1 = threading.Thread(target=_drain, args=(proc.stdout, job, on_stdout), daemon=True)
        t2 = threading.Thread(target=_drain, args=(proc.stderr, job, on_stderr), daemon=True)
        t1.start()
        t2.start()
        rc = proc.wait()
        t1.join(timeout=2)
        t2.join(timeout=2)
    except Exception as exc:
        job["state"] = "error"
        job["error"] = f"启动失败：{exc}"
        job["finished"] = time.time()
        return

    if job.get("cancel"):
        job["state"] = "cancelled"
        job["error"] = "已取消"
        _cleanup(out_part)
    elif rc != 0 or not os.path.isfile(out_part) or os.path.getsize(out_part) < 1024:
        job["state"] = "error"
        job["error"] = _pick_error(job["log"], rc)
        _cleanup(out_part)
    else:
        try:
            if os.path.isfile(out_final):
                os.remove(out_final)
            os.replace(out_part, out_final)
        except Exception as exc:
            job["state"] = "error"
            job["error"] = f"重命名输出失败：{exc}"
            job["finished"] = time.time()
            return
        info = _video_info(out_final)
        job["state"] = "done"
        job["pct"] = 100.0
        job["out_path"] = out_final
        job["info"] = info
    job["finished"] = time.time()


def _cleanup(path: str) -> None:
    try:
        if os.path.isfile(path):
            os.remove(path)
    except OSError:
        pass


def _pick_error(log_lines: list[str], rc: int) -> str:
    """失败原因排序：模型相关 > 编码器相关 > 最后几行。

    Topaz 真实的失败原因（模型没枚举到）往往被后面的「编码器开不起来」盖住，
    直接甩最后四行会把人带偏。
    """
    lines = [ln for ln in log_lines if ln.strip()]
    for key in ("no models found", "model not found", "cannot load", "unsupported"):
        hit = [ln for ln in lines if key in ln.lower()]
        if hit:
            return hit[-1][:400]
    err = [ln for ln in lines if "error" in ln.lower() or "invalid" in ln.lower() or "critical" in ln.lower()]
    if err:
        return "\n".join(err[-3:])[:400]
    return "\n".join(lines[-4:])[:400] or f"退出码 {rc}"


def _build_cmd(body: dict, src: str, out_part: str) -> tuple[list[str], dict | None, str | None, str]:
    """返回 (cmd, env, cwd, error)。"""
    engine = str(body.get("engine") or "topaz").strip().lower()
    info = _video_info(src)
    w = int(info.get("width") or body.get("src_w") or 0)
    h = int(info.get("height") or body.get("src_h") or 0)
    if w <= 0 or h <= 0:
        return [], None, None, "读不出源视频分辨率"

    mode = str(body.get("mode") or "2x")
    if mode not in {"2x", "1.5x", "1080p", "custom"}:
        mode = "2x"
    tw, th = _fit_size(w, h, 2.0 if mode == "2x" else 1.5, mode,
                       int(body.get("target_w") or 0), int(body.get("target_h") or 0))
    if tw < 64 or th < 64:
        return [], None, None, "目标分辨率太小"
    if tw > 8192 or th > 8192:
        return [], None, None, "目标分辨率超过 8192，Topaz 也不接受"

    qp = int(body.get("qp") or 18)
    qp = max(1, min(51, qp))

    if engine == "ffmpeg":
        exe = _ffmpeg_bin()
        if not exe:
            return [], None, None, "找不到 ffmpeg"
        vf = (
            f"hqdn3d=1.5:1.5:6:6,scale={tw}:{th}:flags=lanczos,cas=strength=0.35"
        )
        cmd = [
            exe, "-hide_banner", "-nostdin", "-y", "-i", src,
            "-vf", vf,
            "-c:v", "libx264", "-preset", "medium", "-crf", str(max(12, min(28, qp - 2))),
            "-pix_fmt", "yuv420p",
            # 【必须显式 map 视频】一旦写了 -map，ffmpeg 就关掉默认映射，
            # 只 -map 音频会产出一个「只有声音、没有画面」的 mp4。
            "-map", "0:v:0", "-map", "0:a?", "-c:a", "copy",
            "-movflags", "+faststart",
            # 显式容器：临时文件是 xxx.part.mp4，但调用方传什么后缀都不该让 ffmpeg 猜
            "-f", "mp4",
            "-progress", "pipe:1", "-nostats", "-loglevel", "error",
            out_part,
        ]
        return cmd, None, None, ""

    # ── Topaz Proteus ──
    tz = _detect_topaz()
    if not tz["found"]:
        return [], None, None, "没找到 Topaz Video AI（可用环境变量 ALBER_TOPAZ_DIR 指定安装目录）"
    if not tz["manifest_dir"]:
        return [], None, None, "没找到 Topaz 模型清单目录（缺 prob-4.json，可用 ALBER_TOPAZ_MODEL_DIR 指定）"
    if not tz["weights_dir"]:
        return [], None, None, "没找到 Topaz 权重目录（缺 prob-v4-*.tz，可用 ALBER_TOPAZ_WEIGHT_DIR 指定）"

    p = body.get("params") or {}

    def num(key: str, lo: float, hi: float, default: float) -> float:
        try:
            v = float(p.get(key, default))
        except (TypeError, ValueError):
            v = default
        return max(lo, min(hi, v))

    # 默认 = 「AI 成片」预设：不自动估参数、六个画面参数全 0、混回 20% 原片。
    # 实测（480x854 人像，同一帧四组对比）自动估计会把画面压暗、对比变硬，
    # 因为生成视频没有噪声/压缩块可估，估出来的值反而在反向修正。
    estimate = int(num("estimate", 0, 100, 0))
    blend = num("blend", 0.0, 1.0, 0.2)
    preblur = num("preblur", -1.0, 1.0, 0.0)
    noise = num("noise", -1.0, 1.0, 0.0)
    details = num("details", -1.0, 1.0, 0.0)
    halo = num("halo", -1.0, 1.0, 0.0)
    blur = num("blur", -1.0, 1.0, 0.0)
    compression = num("compression", -1.0, 1.0, 0.0)
    # 以下是 GUI 有、但之前没接进来的三项：输出侧颗粒与色保真
    prenoise = num("prenoise", 0.0, 0.1, 0.0)
    grain = num("grain", 0.0, 0.1, 0.0)
    gsize = num("gsize", 0.0, 5.0, 0.0)
    kcolor = 1 if num("kcolor", 0, 1, 1) >= 0.5 else 0
    vram = num("vram", 0.1, 1.0, 0.75)
    device = str(p.get("device") or "-2")
    if not all(ch.isdigit() or ch in ".-" for ch in device):
        device = "-2"
    instances = int(num("instances", 0, 3, 1))

    # 显式宽高 + scale=0 = 按目标画布估缩放倍数（GUI 自己也是这么发的）。
    # 后面必须再跟一段 scale+pad：tvai_up 的输出边长会被对齐到模型 stride
    # （实测 960x1728 请求出来是 960x1664），不补这一步画布就不精确。
    # 滤镜链一长就必须自己写标签，否则 ffmpeg 会抱怨「找不到未使用的输入 pad」。
    vf = (
        "[0:v:0]tvai_up=model=prob-4:scale=0:w={w}:h={h}"
        ":preblur={pb}:noise={ns}:details={dt}:halo={hl}:blur={bl}:compression={cp}"
        ":prenoise={pn}:grain={gr}:gsize={gs}:kcolor={kc}"
        ":estimate={es}:blend={bd}:device={dev}:vram={vr}:instances={ins}"
        ",scale=w={w}:h={h}:flags=lanczos:threads=0:force_original_aspect_ratio=decrease"
        ",pad={w}:{h}:-1:-1:color=black[vout]"
    ).format(
        w=tw, h=th, pb=preblur, ns=noise, dt=details, hl=halo, bl=blur, cp=compression,
        pn=prenoise, gr=grain, gs=gsize, kc=kcolor,
        es=estimate, bd=blend, dev=device, vr=vram, ins=instances,
    )
    cmd = [
        tz["ffmpeg"], "-hide_banner", "-nostdin", "-y", "-i", src,
        "-sws_flags", "spline+accurate_rnd+full_chroma_int",
        "-filter_complex", vf,
        "-c:v", "h264_nvenc", "-profile:v", "high", "-pix_fmt", "yuv420p",
        "-preset", "p7", "-tune", "hq", "-rc", "constqp", "-qp", str(qp), "-g", "30",
        "-map", "[vout]", "-map", "0:a?", "-c:a", "copy",
        "-movflags", "+faststart",
        "-f", "mp4",
        "-progress", "pipe:1", "-nostats", "-loglevel", "error",
        out_part,
    ]
    return cmd, _topaz_env(tz), tz["root"] or None, ""


# ── 路由 ──────────────────────────────────────────────────────────────────────
def _json(body) -> dict:
    return body if isinstance(body, dict) else {}


def _pick_out_path(body: dict, src: str) -> str:
    raw = str(body.get("out_path") or "").strip().strip('"')
    if raw:
        return os.path.abspath(raw)
    stem, _ = os.path.splitext(os.path.basename(src))
    # ComfyUI 的落盘名常带尾下划线（shot01_00001_.mp4），直接拼会出双下划线
    stem = stem.rstrip("_") or stem
    return os.path.abspath(os.path.join(os.path.dirname(src), f"{stem}_Proteus.mp4"))


def _err(text: str, status: int = 400):
    from aiohttp import web

    return web.json_response({"error": text}, status=status)


# ── 文件浏览（给「选择视频」用） ───────────────────────────────────────────────
# 不走上传：ComfyUI 和浏览器在同一台机器上，直接把**服务器路径**填进 src 就够了，
# 几十上百 MB 的成片没必要在 loopback 上再搬一遍。
_SKIP_DIRS = {
    "$recycle.bin", "system volume information", "recovery",
    "node_modules", "__pycache__", ".git", ".venv", "venv",
}


def _comfy_dirs() -> list[dict]:
    """ComfyUI 的 output / input：优先问 folder_paths，问不到就按插件位置反推。

    插件装成 `<ComfyUI>/custom_nodes/<插件名>/director/upscale_routes.py`，
    所以往上找到叫 `custom_nodes` 的那层，它的父目录就是 ComfyUI 根。
    """
    out: list[dict] = []
    try:
        import folder_paths  # type: ignore

        for label, fn in (
            ("ComfyUI 输出", "get_output_directory"),
            ("ComfyUI 输入", "get_input_directory"),
        ):
            try:
                p = getattr(folder_paths, fn)()
            except Exception:
                continue
            if p and os.path.isdir(p):
                out.append({"label": label, "path": os.path.abspath(p)})
    except Exception:
        pass
    if out:
        return out

    root = None
    for p in Path(__file__).resolve().parents:
        if p.name == "custom_nodes":
            root = p.parent
            break
    if root is not None:
        for label, sub in (("ComfyUI 输出", "output"), ("ComfyUI 输入", "input")):
            d = root / sub
            if d.is_dir():
                out.append({"label": label, "path": str(d)})
    return out


def _quick_dirs() -> list[dict]:
    """常用目录：ComfyUI 的 output/input 排最前，其次桌面/视频/下载。"""
    out: list[dict] = _comfy_dirs()
    home = os.path.expanduser("~")
    for label, sub in (("桌面", "Desktop"), ("视频", "Videos"), ("下载", "Downloads")):
        p = os.path.join(home, sub)
        if os.path.isdir(p):
            out.append({"label": label, "path": os.path.abspath(p)})
    return out


def _fs_roots() -> dict:
    roots: list[dict] = []
    if os.name == "nt":
        for ch in "CDEFGHIJKLMNOPQRSTUVWXYZ":
            p = f"{ch}:\\"
            if os.path.isdir(p):
                roots.append({"label": f"{ch}:", "path": p})
    else:
        roots.append({"label": "/", "path": "/"})
    return {"roots": roots, "quick": _quick_dirs()}


_ROOTS_CACHE: dict | None = None
_ROOTS_AT = 0.0


def _fs_roots_cached() -> dict:
    """盘符和快捷目录每次翻转目录都带上 —— 前端才能随时切盘，不用先退回根。

    盘符变动极少，缓存 30 秒；folder_paths 那两次调用也就几毫秒。
    """
    global _ROOTS_CACHE, _ROOTS_AT
    now = time.time()
    if _ROOTS_CACHE is None or now - _ROOTS_AT > 30:
        _ROOTS_CACHE, _ROOTS_AT = _fs_roots(), now
    return _ROOTS_CACHE


def _fs_parent(path: str) -> str:
    p = path.rstrip("\\/") or path
    parent = os.path.dirname(p)
    if not parent or parent == p:
        return path  # 已经在盘符根，别再往上
    return parent


def _fs_scan(path: str) -> dict:
    """列一个目录：子目录 + 视频文件。只列视频，不给看别的文件。"""
    dirs: list[dict] = []
    files: list[dict] = []
    with os.scandir(path) as it:
        for ent in it:
            name_low = ent.name.lower()
            if name_low.startswith(".") or name_low in _SKIP_DIRS:
                continue
            try:
                if ent.is_dir():
                    dirs.append({"name": ent.name, "path": os.path.abspath(ent.path)})
                elif ent.is_file() and os.path.splitext(ent.name)[1].lower() in VIDEO_EXTS:
                    st = ent.stat()
                    files.append({
                        "name": ent.name,
                        "path": os.path.abspath(ent.path),
                        "size": int(st.st_size),
                        "mtime": int(st.st_mtime),
                    })
            except OSError:
                continue  # 单个文件 stat 失败（正被占用等）不该毁掉整次列举
    dirs.sort(key=lambda d: d["name"].lower())
    files.sort(key=lambda f: f["mtime"], reverse=True)  # 最新在前，找刚出的片最顺手
    return {"path": path, "parent": _fs_parent(path), "dirs": dirs, "files": files}


def register_upscale_routes(routes, register_route) -> None:
    """挂 6 条路由：状态 / 源信息 / 目录浏览 / 起作业 / 查作业 / 取消。"""
    from aiohttp import web

    async def upscale_status(request):
        probe = str(request.query.get("probe") or "").strip() in {"1", "true", "yes"}
        info = _detect_topaz(force=bool(request.query.get("refresh")))
        payload = {
            "topaz": info,
            "ffmpeg": _ffmpeg_bin(),
            "probe": _probe_topaz(force=True) if probe else None,
        }
        if not probe and _PROBE is not None:
            payload["probe"] = _PROBE  # 之前探过就直接带出来
        return web.json_response(payload)

    async def upscale_video_info(request):
        path = str(request.query.get("path") or "").strip()
        if not path or not os.path.isfile(path):
            return _err("文件不存在")
        return web.json_response({"path": path, "info": _video_info(path)})

    async def fs_list(request):
        """列目录：不带 path 返回盘符 + 常用目录，带 path 返回子目录和视频文件。

        只列**视频**，不给看别的文件 —— 免得这个面板被当成通用文件管理器用。
        """
        raw = str(request.query.get("path") or "").strip().strip('"')
        if not raw:
            return web.json_response({"path": "", "parent": "", "dirs": [], "files": [], **_fs_roots_cached()})

        path = os.path.abspath(os.path.expanduser(raw))
        if os.path.isfile(path):  # 直接贴了个文件路径 → 列它所在目录
            path = os.path.dirname(path)
        if not os.path.isdir(path):
            return _err(f"目录不存在：{path}")

        try:
            # 盘符和快捷目录一起带上，前端每次翻转都能就地切盘
            return web.json_response({**_fs_scan(path), **_fs_roots_cached()})
        except PermissionError:
            return _err(f"没有权限读这个目录：{path}")
        except OSError as exc:
            return _err(f"读目录失败：{exc}")

    async def upscale_start(request):
        try:
            body = _json(await request.json())
        except Exception:
            return _err("请求体不是 JSON")

        src = os.path.abspath(str(body.get("src") or "").strip())
        if not os.path.isfile(src):
            return _err(f"源文件不存在：{src}")
        if os.path.splitext(src)[1].lower() not in VIDEO_EXTS:
            return _err("源文件不是视频")

        out_final = _pick_out_path(body, src)
        if os.path.normcase(out_final) == os.path.normcase(src):
            return _err("输出路径不能和源文件相同")
        out_dir = os.path.dirname(out_final)
        try:
            os.makedirs(out_dir, exist_ok=True)
        except OSError as exc:
            return _err(f"建不了输出目录：{exc}")
        if os.path.exists(out_final) and not body.get("overwrite"):
            return _err(f"输出文件已存在：{out_final}")

        out_part = f"{os.path.splitext(out_final)[0]}.part.mp4"
        cmd, env, cwd, problem = _build_cmd(body, src, out_part)
        if problem:
            return _err(problem)

        info = _video_info(src)
        job = _job_new(str(body.get("engine") or "topaz").lower())
        job["total"] = int(info.get("frames") or 0)
        job["out_path"] = out_final
        job["src"] = src
        threading.Thread(
            target=_run_job,
            args=(job, cmd, env, cwd, out_part, out_final),
            daemon=True,
        ).start()
        log.info("upscale: 起作业 %s %s -> %s", job["id"], src, out_final)
        return web.json_response({"id": job["id"], "total": job["total"]})

    async def upscale_job(request):
        jid = str(request.query.get("id") or "").strip()
        with _JOBS_LOCK:
            job = _JOBS.get(jid)
        if not job:
            return _err("作业不存在（可能已过期）", 404)
        return web.json_response(_job_public(job))

    async def upscale_cancel(request):
        try:
            body = _json(await request.json())
        except Exception:
            body = {}
        jid = str(body.get("id") or "").strip()
        with _JOBS_LOCK:
            job = _JOBS.get(jid)
        if not job:
            return _err("作业不存在", 404)
        job["cancel"] = True
        proc = job.get("proc")
        if proc and proc.poll() is None:
            try:
                proc.terminate()
            except Exception:
                pass
        return web.json_response({"ok": True})

    register_route(routes, "GET", "/alber/director/upscale_status", upscale_status)
    register_route(routes, "GET", "/alber/director/upscale_info", upscale_video_info)
    register_route(routes, "GET", "/alber/director/fs_list", fs_list)
    register_route(routes, "POST", "/alber/director/upscale_start", upscale_start)
    register_route(routes, "GET", "/alber/director/upscale_job", upscale_job)
    register_route(routes, "POST", "/alber/director/upscale_cancel", upscale_cancel)
