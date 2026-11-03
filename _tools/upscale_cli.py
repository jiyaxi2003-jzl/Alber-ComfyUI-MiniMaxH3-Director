#!/usr/bin/env python3
"""二采命令行：不打开 ComfyUI 也能对成片做放大补细节。

它和插件里的「二采」按钮走**同一份实现**（director/upscale_routes.py），
所以两边行为、参数、报错措辞完全一致，改一处就够了。

用法：
    python _tools/upscale_cli.py 成片.mp4                    # Topaz Proteus，2 倍
    python _tools/upscale_cli.py 成片.mp4 --mode 1080p       # 短边对齐 1080
    python _tools/upscale_cli.py 成片.mp4 -o 大.mp4 --mode custom --w 2560 --h 1440
    python _tools/upscale_cli.py 成片.mp4 --engine ffmpeg    # 十几秒的快速通道
    python _tools/upscale_cli.py --check                     # 只看环境是否就绪
"""

from __future__ import annotations

import argparse
import os
import sys
import time

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from director import upscale_routes as U  # noqa: E402


def _fmt_size(n: int) -> str:
    return f"{n / 1048576:.1f}MB" if n >= 1048576 else f"{max(1, n // 1024)}KB"


def cmd_check() -> int:
    info = U._detect_topaz(force=True)
    print("Topaz 安装目录 :", info["root"] or "（未找到）")
    print("  ffmpeg       :", info["ffmpeg"] or "（未找到）")
    print("  模型清单目录 :", info["manifest_dir"] or "（未找到 prob-4.json）")
    print("  权重目录     :", info["weights_dir"] or "（未找到 prob-v4-*.tz）")
    print("  可用瓦片     :", info["tiles"], "个")
    for name in info["model_files"]:
        print("    -", name)
    print("ffmpeg（通用） :", U._ffmpeg_bin() or "（PATH 里没有）")

    probe = U._probe_topaz(force=True)
    if probe["ok"]:
        print("\n自检：通过 —— Topaz 可以跑 prob-4")
        return 0
    print("\n自检：失败 ——", probe["reason"])
    if probe["detail"]:
        print(probe["detail"])
    return 1


# 和界面上的四档预设一一对应（AI 成片就是全 0 + 混回 0.2）
PRESETS = {
    "ai":   {"estimate": 0,  "blend": 0.2,  "compression": 0,   "noise": 0,   "halo": 0,   "blur": 0,   "details": 0},
    "live": {"estimate": 16, "blend": 0.2,  "compression": 0,   "noise": 0,   "halo": 0,   "blur": 0,   "details": 0},
    "fix":  {"estimate": 8,  "blend": 0.15, "compression": 0.5, "noise": 0.1, "halo": 0.1, "blur": 0.1, "details": 0.1},
}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="二采：对已落盘的成片放大 + 补细节（Topaz Proteus / ffmpeg）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "预设：\n"
            "  ai    AI 成片（默认）—— 画面参数全 0，只混回 20% 原片\n"
            "  live  实拍素材 —— 先自动估 16 帧参数\n"
            "  fix   低码率修复 —— 去块 + 轻降噪 + 轻锐化\n"
            "单给的参数会覆盖预设值。"
        ),
    )
    ap.add_argument("src", nargs="?", help="源视频（mp4/mov/mkv…）")
    ap.add_argument("-o", "--out", default="", help="输出路径，默认 <源目录>/<名字>_Proteus.mp4")
    ap.add_argument("--engine", choices=["topaz", "ffmpeg"], default="topaz", help="默认 topaz")
    ap.add_argument("--preset", choices=list(PRESETS), default="ai", help="参数预设，默认 ai")
    ap.add_argument("--mode", choices=["2x", "1.5x", "1080p", "custom"], default="2x")
    ap.add_argument("--w", type=int, default=0, help="--mode custom 时的目标宽")
    ap.add_argument("--h", type=int, default=0, help="--mode custom 时的目标高")
    ap.add_argument("--qp", type=int, default=18, help="编码质量，越小越清晰（默认 18）")
    ap.add_argument("--estimate", type=int, default=None, help="自动分析帧数，0 = 手动（覆盖预设）")
    ap.add_argument("--blend", type=float, default=None, help="混合原片比例 0~1（默认 0.2）")
    ap.add_argument("--details", type=float, default=None, help="-1~1，恢复被降噪抹掉的纹理")
    ap.add_argument("--noise", type=float, default=None, help="-1~1，去 ISO 噪点")
    ap.add_argument("--blur", type=float, default=None, help="-1~1，额外锐化")
    ap.add_argument("--halo", type=float, default=None, help="-1~1，去锐化白边")
    ap.add_argument("--compression", type=float, default=None, help="-1~1，去压缩块")
    ap.add_argument("--preblur", type=float, default=None, help="-1~1，抵消镜头虚")
    ap.add_argument("--prenoise", type=float, default=None, help="0~0.1，处理前加颗粒")
    ap.add_argument("--grain", type=float, default=None, help="0~0.1，输出加胶片颗粒")
    ap.add_argument("--gsize", type=float, default=None, help="0~5，颗粒大小")
    ap.add_argument("--no-kcolor", action="store_true", help="关掉模型自带的色彩校正")
    ap.add_argument("--vram", type=float, default=None, help="0.1~1，Proteus 可用显存比例")
    ap.add_argument("--instances", type=int, default=None, help="0~3，并发实例")
    ap.add_argument("--overwrite", action="store_true", help="覆盖已存在的输出")
    ap.add_argument("--check", action="store_true", help="只检查环境，不处理文件")
    args = ap.parse_args(argv)

    if args.check:
        return cmd_check()
    if not args.src:
        ap.error("要么给源视频，要么用 --check")
    src = os.path.abspath(args.src)
    if not os.path.isfile(src):
        print(f"源文件不存在：{src}", file=sys.stderr)
        return 2

    # 预设打底，再让单给的参数覆盖
    prm = dict(PRESETS[args.preset])
    prm.setdefault("preblur", 0)
    prm.setdefault("prenoise", 0)
    prm.setdefault("grain", 0)
    prm.setdefault("gsize", 0)
    prm.setdefault("kcolor", 0 if args.no_kcolor else 1)
    prm.setdefault("vram", 0.75)
    prm.setdefault("instances", 1)
    for key in ("estimate", "blend", "details", "noise", "blur", "halo",
                "compression", "preblur", "prenoise", "grain", "gsize", "vram", "instances"):
        val = getattr(args, key, None)
        if val is not None:
            prm[key] = val

    body = {
        "engine": args.engine,
        "mode": args.mode,
        "target_w": args.w,
        "target_h": args.h,
        "qp": args.qp,
        "overwrite": bool(args.overwrite),
        "params": prm,
    }

    info = U._video_info(src)
    if not info:
        print("读不出源视频信息（ffprobe 不可用？）", file=sys.stderr)
        return 2

    out = U._pick_out_path({"out_path": args.out}, src)
    if os.path.normcase(out) == os.path.normcase(src):
        print("输出路径不能和源文件相同", file=sys.stderr)
        return 2
    if os.path.exists(out) and not args.overwrite:
        print(f"输出已存在：{out}（加 --overwrite 覆盖）", file=sys.stderr)
        return 2
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)

    part = f"{os.path.splitext(out)[0]}.part.mp4"
    cmd, env, cwd, err = U._build_cmd(body, src, part)
    if err:
        print("无法开始：", err, file=sys.stderr)
        return 2

    print(f"源    : {src}")
    print(f"        {info['width']}x{info['height']}  {info['fps']}fps  {info['frames']} 帧")
    print(f"引擎  : {args.engine}   模式: {args.mode}")
    print(f"输出  : {out}")
    print()

    job = U._job_new(args.engine)
    job["total"] = int(info.get("frames") or 0)
    job["out_path"] = out
    t0 = time.time()

    # 边跑边打印进度，别让人对着空屏猜
    last = [-1.0]
    stop = False
    import threading

    def ticker() -> None:
        while not stop:
            pct = job["pct"]
            if pct - last[0] >= 1.0 or (job["state"] != "running" and last[0] != 101):
                last[0] = 101 if job["state"] != "running" else pct
                bar = int(pct / 4)
                sys.stdout.write(
                    f"\r  [{'#' * bar}{'.' * (25 - bar)}] {pct:5.1f}%  "
                    f"{job['frame']}/{job['total']} 帧  {time.time() - t0:5.1f}s "
                )
                sys.stdout.flush()
            time.sleep(0.25)

    th = threading.Thread(target=ticker, daemon=True)
    th.start()
    U._run_job(job, cmd, env, cwd, part, out)
    stop = True
    th.join(timeout=1)
    print()

    if job["state"] == "done":
        got = job.get("info") or U._video_info(out)
        print(f"完成：{out}")
        print(f"      {got.get('width')}x{got.get('height')}  {got.get('frames')} 帧  "
              f"{_fmt_size(got.get('size') or 0)}  用时 {time.time() - t0:.1f}s")
        return 0

    print(f"失败（{job['state']}）：{job.get('error') or '未知原因'}", file=sys.stderr)
    for line in job.get("log") or []:
        print("  " + line, file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
