/**
 * 二采（放大 + 补细节）：预览列里的「✦ 二采」按钮。
 *
 * 做四件事：
 *   1. 在主预览列下面加一颗按钮，点开参数对话框；
 *   2. 调后端 /alber/director/upscale_* 起外部进程（Topaz Proteus / ffmpeg），
 *      带进度、可停止；
 *   3. 跑完在**右侧**挂第二列放大预览，和原片并排；
 *   4. 「展开 / 对比」打开大窗，支持缩放（滚轮 / 按钮）和拖动平移。
 *
 * 为什么按钮放在预览列：二采的对象就是「这条已经落盘的片」，
 * 放别处还得先选文件，反而多一步。
 */

import { getLocale } from "./minimax_i18n.js";
import { syncPreviewGeometry } from "./alber_mp4_panel.js";

const API = "/alber/director";
const STYLE_ID = "alber-upscale-css";
const PROP_UP = "alberUpscalePath";
const PROP_SRC = "alberUpscaleSrc";
const COL_CLASS = "alber-preview-col";
const UP_CLASS = "alber-up-col";
const POLL_MS = 700;

/* ── 文案 ─────────────────────────────────────────────────────────────────── */
const L = {
    zh: {
        btn: "二采",
        btnTitle: "用 Topaz Proteus 给这条成片放大、补细节（不占 H3 的显存）",
        title: "二采放大",
        sub: "对已经落盘的成片再跑一遍：放大到指定尺寸并补细节。不参与采样，跑完另存一份。",
        engine: "引擎",
        engineTopaz: "Topaz Proteus",
        engineTopazHint: "视频原生、带时域一致，效果最好；需要 Topaz Video AI 已登录且模型可用",
        engineFfmpeg: "ffmpeg 快速",
        engineFfmpegHint: "降噪 + lanczos + CAS，十几秒出片，不补真细节",
        target: "目标尺寸",
        customW: "宽",
        customH: "高",
        params: "Proteus 参数",
        paramsHint: "0 是「别看这段素材自己调」，非 0 是相对量；拿不准就留 0",
        preset: "预设",
        pAi: "AI 成片",
        pLive: "实拍素材",
        pFix: "低码率修复",
        pCustom: "自定义",
        presetHintAi: "生成视频既没噪点也没压缩块，全 0 让模型只补真细节 —— 实测最自然的一组",
        presetHintLive: "实拍素材先自动估 16 帧参数，再按需微调",
        presetHintFix: "网络抓来的糊片：去块 + 轻降噪 + 轻锐化",
        presetHintCustom: "参数已手动改过，按当前值跑",
        mode2: "参数来源",
        modeManual: "手动",
        modeAuto: "自动估计",
        modeHintManual: "自己给值；默认这一档",
        modeHintAuto: "先分析 N 帧再定参数。实测在 AI 成片上会压暗、对比变硬，只在实拍素材上用",
        estimate: "分析帧数",
        estimateHint: "0 = 关（手动）。实拍素材给 8~20 比较稳，越大越慢",
        blend: "混合原片",
        preblur: "预模糊",
        noise: "降噪",
        details: "恢复细节",
        halo: "去光晕",
        blur: "锐化",
        compression: "去压缩块",
        prenoise: "前置颗粒",
        grain: "输出颗粒",
        gsize: "颗粒大小",
        kcolor: "模型色彩校正",
        vram: "显存上限",
        instances: "并发实例",
        gMain: "画面",
        gGrain: "颗粒质感",
        gPerf: "性能",
        hDetails: "恢复被机内降噪抹掉的纹理。AI 成片没有这层损失，给 0",
        hNoise: "去 ISO 噪点。生成视频本来就没噪点，调高只会糊",
        hBlur: "额外锐化。画面偏软给 0.1~0.3，再高会出白边",
        hHalo: "压掉锐化留下的白边光晕",
        hComp: "去压缩块。H3 出片码率高，给 0",
        hPreblur: "预模糊，抵消镜头本身的虚。负值更适合有摩尔纹/锯齿的素材",
        hBlend: "混回多少原片。0.2 既拿到模型纹理，又不容易让脸跑形",
        hPrenoise: "处理前加颗粒喂给重建，一般用不到",
        hGrain: "只在输出上加胶片颗粒，纯观感",
        hGsize: "颗粒尺寸，0 = 模型自己定",
        hKcolor: "让模型自带的白平衡/色彩校正生效，一般开着",
        hVram: "允许 Proteus 占用的显存比例，16G 卡 0.75 够用",
        hInst: "多开实例提速，显存不够别加",
        estAuto: "自动",
        outDir: "输出目录",
        outName: "文件名",
        useSrcDir: "用源目录",
        srcLabel: "源视频",
        pickVideo: "选择视频…",
        pickTitle: "选择要做二采的视频",
        pickHint: "只列视频文件。路径可以直接粘到下面那栏，回车跳转。",
        pickUp: "上一级",
        pickRoots: "盘符",
        pickQuick: "常用目录",
        pickEmpty: "这个目录里没有视频",
        pickUse: "用这个文件",
        pickPathPh: "粘贴完整路径后回车",
        pickLoading: "读取中…",
        pickSelected: "已选",
        dragHint: "也可以把视频文件拖到这一行",
        noSrcPick: "还没有选源视频 —— 点右边「选择视频…」",
        needPick: "先选一个视频再开始",
        overwrite: "覆盖同名文件",
        autoMount: "完成后在右侧显示对比",
        cancel: "取消",
        start: "开始二采",
        stop: "停止",
        running: "正在二采…",
        checking: "正在检测引擎…",
        ok: "放大成功",
        reopen: "打开目录",
        again: "再跑一次",
        close: "关闭",
        compare: "对比",
        expand: "展开",
        remove: "移除",
        upTag: "二采",
        srcTag: "原片",
        upTagFull: "放大后",
        notReady: "引擎未就绪",
        probing: "检测中…",
        probe: "检测",
        needTopaz: "没检测到可用的 Proteus 模型，可先点「检测」，或直接用 ffmpeg 快速",
        stale: "这条放大结果来自另一版成片",
        zoom: "缩放",
        reset: "适应",
        sync: "同步播放",
        split: "并排对比",
        single: "只看放大",
        noSrc: "还没有成片：先跑一条，或者点「刷新」",
        badSrc: "读不出源文件信息",
        doneInfo: "{w}×{h} · {n} 帧 · {mb} MB · {s}s",
        starting: "正在启动…",
        errPrefix: "失败：",
        cancelHint: "已取消",
        tip: "16G 显存下，二采和 H3 抢卡，建议等队列跑完再点",
    },
    en: {
        btn: "Refine ×2",
        btnTitle: "Upscale + detail recovery with Topaz Proteus (does not touch H3 VRAM)",
        title: "Second pass",
        sub: "Run the exported mp4 through an external upscaler and save a second file.",
        engine: "Engine",
        engineTopaz: "Topaz Proteus",
        engineTopazHint: "Native video model with temporal consistency; needs Topaz Video AI signed in",
        engineFfmpeg: "ffmpeg fast",
        engineFfmpegHint: "denoise + lanczos + CAS, seconds to finish, no real detail",
        target: "Target size",
        customW: "W",
        customH: "H",
        params: "Proteus params",
        paramsHint: "0 means auto relative to the clip; leave at 0 unless you know better",
        preset: "Preset",
        pAi: "AI footage",
        pLive: "Live action",
        pFix: "Low bitrate",
        pCustom: "Custom",
        presetHintAi: "Generated video has no noise or blocking — all zeros lets the model only add real detail. Measured as the most natural set",
        presetHintLive: "Auto-estimate 16 frames first, then fine tune",
        presetHintFix: "Grabby web clips: deblock + light denoise + light sharpen",
        presetHintCustom: "Params were edited by hand",
        mode2: "Parameter source",
        modeManual: "Manual",
        modeAuto: "Auto estimate",
        modeHintManual: "You set the values — the default",
        modeHintAuto: "Analyse N frames first. On AI footage it darkens and hardens contrast; use it for live action",
        estimate: "Analyse frames",
        estimateHint: "0 = off (manual). 8~20 is safe for live action, slower as it grows",
        blend: "Blend source",
        preblur: "Pre-blur",
        noise: "Noise",
        details: "Details",
        halo: "Halo",
        blur: "Sharpen",
        compression: "Deblock",
        prenoise: "Pre-noise",
        grain: "Output grain",
        gsize: "Grain size",
        kcolor: "Model colour correction",
        vram: "VRAM cap",
        instances: "Instances",
        gMain: "Image",
        gGrain: "Grain",
        gPerf: "Performance",
        hDetails: "Recover texture killed by in-camera denoise. AI footage has no such loss — keep 0",
        hNoise: "Remove ISO noise. Generated video has none; raising it only blurs",
        hBlur: "Extra sharpening. 0.1~0.3 for soft clips, more gives halos",
        hHalo: "Suppress halos left by over-sharpening",
        hComp: "Remove blocking. H3 exports at high bitrate — keep 0",
        hPreblur: "Compensate for lens blur; negative suits aliased/moire sources",
        hBlend: "How much source to mix back. 0.2 keeps model texture without warping faces",
        hPrenoise: "Grain added before processing — rarely useful",
        hGrain: "Film grain on output, cosmetic only",
        hGsize: "Grain size, 0 = model decides",
        hKcolor: "Let the model's own white-balance/colour pass run — usually on",
        hVram: "VRAM ratio Proteus may use; 0.75 is fine on 16 GB",
        hInst: "More instances = faster; only with spare VRAM",
        estAuto: "auto",
        outDir: "Output folder",
        outName: "File name",
        useSrcDir: "Use source folder",
        srcLabel: "Source",
        pickVideo: "Choose video…",
        pickTitle: "Pick a video to refine",
        pickHint: "Videos only. You can also paste a full path below and press Enter.",
        pickUp: "Up",
        pickRoots: "Drives",
        pickQuick: "Shortcuts",
        pickEmpty: "No video in this folder",
        pickUse: "Use this file",
        pickPathPh: "Paste a full path and press Enter",
        pickLoading: "Loading…",
        pickSelected: "Selected",
        dragHint: "You can also drop a video file onto this row",
        noSrcPick: "No source yet — click “Choose video…” on the right",
        needPick: "Pick a video first",
        overwrite: "Overwrite",
        autoMount: "Show comparison on the right",
        cancel: "Cancel",
        start: "Start",
        stop: "Stop",
        running: "Running…",
        checking: "Checking engine…",
        ok: "Upscale finished",
        reopen: "Open folder",
        again: "Run again",
        close: "Close",
        compare: "Compare",
        expand: "Expand",
        remove: "Remove",
        upTag: "Refined",
        srcTag: "Source",
        upTagFull: "Upscaled",
        notReady: "Engine not ready",
        probing: "Probing…",
        probe: "Probe",
        needTopaz: "No usable Proteus model found; probe again, or use ffmpeg fast",
        stale: "This result came from another export",
        zoom: "Zoom",
        reset: "Fit",
        sync: "Sync",
        split: "Side by side",
        single: "Upscaled only",
        noSrc: "Nothing exported yet",
        badSrc: "Cannot read the source video",
        doneInfo: "{w}×{h} · {n} frames · {mb} MB · {s}s",
        starting: "Starting…",
        errPrefix: "Failed: ",
        cancelHint: "Cancelled",
        tip: "On 16 GB VRAM the upscaler competes with H3 — run it after the queue is empty",
    },
};

function t(key, vars) {
    const lang = String(getLocale() || "zh").toLowerCase().startsWith("en") ? "en" : "zh";
    let s = L[lang][key] ?? L.zh[key] ?? key;
    if (vars) {
        for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    }
    return s;
}

/* ── 工具 ─────────────────────────────────────────────────────────────────── */
function fmtMB(bytes) {
    const n = Number(bytes) || 0;
    if (n <= 0) return "0";
    return (n / 1024 / 1024).toFixed(1);
}

function baseName(p) {
    return String(p || "").split(/[\\/]/).pop() || "";
}

function dirName(p) {
    const s = String(p || "").replace(/\\/g, "/");
    const i = s.lastIndexOf("/");
    return i > 0 ? s.slice(0, i) : "";
}

function stemOf(p) {
    const b = baseName(p);
    const i = b.lastIndexOf(".");
    return i > 0 ? b.slice(0, i) : b;
}

/* ComfyUI 的落盘名常带尾下划线（shot01_00001_.mp4），直接拼会出双下划线 */
function proteusName(p) {
    const s = stemOf(p);
    const trimmed = s.replace(/_+$/, "");
    return `${trimmed || s}_Proteus.mp4`;
}

function even(n) {
    n = Math.round(Number(n) || 0);
    return n % 2 === 0 ? n : n + 1;
}

function httpMsg(status) {
    if (status === 404) return "后端没有这条路由 —— 改过 director/ 就要重启 ComfyUI";
    if (status === 502 || status === 503) return "ComfyUI 后端没在跑";
    return `HTTP ${status}`;
}

async function readJson(r) {
    const text = await r.text();
    let data = null;
    try {
        data = JSON.parse(text);
    } catch {
        data = null;
    }
    // 404 时返回的是整页 HTML，直接丢给用户看没法读，这里换成一句人话
    if (!r.ok) throw new Error((data && data.error) || httpMsg(r.status));
    if (!data) throw new Error(httpMsg(r.status));
    return data;
}

async function apiGet(url) {
    return readJson(await fetch(url, { cache: "no-store" }));
}

async function apiPost(url, body) {
    const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
    });
    return readJson(r);
}

function previewUrl(path, bump = 0) {
    const q = new URLSearchParams({ path: String(path || "") });
    if (bump) q.set("v", String(bump));
    return `${API}/mp4_preview?${q.toString()}`;
}

/* ── 样式 ─────────────────────────────────────────────────────────────────── */
function injectCss() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = `
/* 二采按钮：单独一行，占满预览列宽 */
.${COL_CLASS} .apc-up-row{flex:0 0 auto;display:flex;gap:5px}
.${COL_CLASS} .apc-btn.apc-up{
  flex:1 1 auto;background:#20324a;border-color:#3f6fa8;color:#cfe3ff;font-weight:600;
}
.${COL_CLASS} .apc-btn.apc-up:hover{background:#294468;color:#e6f1ff;border-color:#5a8fd0}
.${COL_CLASS} .apc-btn.apc-up.is-busy{opacity:.6;cursor:progress}
.${COL_CLASS} .apc-btn.apc-up.is-on{background:#1d3a2e;border-color:#3f9d72;color:#c8f0dd}

/* 放大预览列：贴在主列右边 */
.${UP_CLASS}{right:6px;width:var(--alber-up-w,320px)}
.${UP_CLASS} .apc-tag{color:#8fe0b4;background:#1b2b24;border-color:#2f5a45}
.${UP_CLASS} .apc-actions .apc-btn{padding:5px 4px}
.mmx-host.alber-has-up > .${COL_CLASS}.is-main{
  right:calc(6px + var(--alber-up-w, 0px) + var(--alber-up-gap, 0px));
}

/* ── 对话框 ── */
.au-overlay{
  position:fixed;inset:0;z-index:2147483000;background:rgba(6,8,12,.62);
  display:flex;align-items:center;justify-content:center;padding:20px;
  font-family:system-ui,"Microsoft YaHei",sans-serif;
}
.au-dlg{
  width:min(720px,96vw);max-height:92vh;overflow:auto;box-sizing:border-box;
  background:#191a20;border:1px solid #33343f;border-radius:10px;color:#e2e2e8;
  box-shadow:0 18px 60px rgba(0,0,0,.6);padding:16px 18px 14px;
}
.au-head{display:flex;align-items:baseline;gap:10px;margin-bottom:4px}
.au-head b{font-size:15px;font-weight:700;color:#eef1f8}
.au-head .au-x{margin-left:auto;all:unset;cursor:pointer;color:#8a8f9e;font-size:16px;padding:2px 6px;border-radius:5px}
.au-head .au-x:hover{background:#2a2b34;color:#dfe3ee}
.au-sub{font-size:11.5px;color:#8b90a0;line-height:1.65;margin-bottom:12px}

/* 源视频一行：完整路径 + 选择按钮 */
.au-srcbar{
  display:flex;gap:8px;align-items:center;margin-bottom:12px;padding:6px 8px;
  background:#1d1e26;border:1px solid #2b2c37;border-radius:7px;
}
.au-srcbar.drag{border-color:#4d84c9;background:#1b2740}
.au-srcpath{
  flex:1 1 auto;min-width:0;font-size:11.5px;line-height:1.5;color:#b9c0d4;
  font-family:ui-monospace,Consolas,monospace;overflow-wrap:anywhere;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;
}
.au-srcpath.empty{color:#8b90a0;font-style:italic;font-family:inherit}

/* 选视频对话框 */
.pk-dlg{width:min(780px,96vw)}
.pk-bar{display:flex;gap:8px;align-items:center;margin-bottom:8px}
.pk-bar .au-in{flex:1 1 auto;min-width:0}
.pk-quick{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px}
.pk-chip{padding:3px 8px;font-size:11px}
.pk-list{
  height:min(46vh,420px);overflow:auto;box-sizing:border-box;
  background:#14151b;border:1px solid #2b2c37;border-radius:7px;padding:4px;
}
.pk-row{
  display:flex;gap:8px;align-items:center;padding:5px 8px;border-radius:5px;
  cursor:pointer;font-size:12px;color:#cfd5e4;user-select:none;
}
.pk-row:hover{background:#23252f}
.pk-row.on{background:#1d3350;color:#dbeaff;box-shadow:inset 0 0 0 1px #3f6fa8}
.pk-ico{flex:none;width:12px;font-size:11px;color:#7d859a}
.pk-row.dir .pk-ico{color:#79b8ea}
.pk-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pk-meta{flex:none;font-size:10.5px;color:#7d859a;font-variant-numeric:tabular-nums}
.pk-empty{padding:16px;text-align:center;font-size:12px;color:#7d859a}
.pk-empty.bad{color:#e08a8a}
.au-grid{display:grid;grid-template-columns:104px minmax(0,1fr);gap:9px 12px;align-items:center}
.au-label{font-size:12px;color:#a9aebd}
.au-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;min-width:0}
.au-seg{display:flex;gap:4px;flex-wrap:wrap}
.au-seg button{
  all:unset;box-sizing:border-box;cursor:pointer;padding:5px 10px;border-radius:6px;
  border:1px solid #3a3b48;background:#22232b;color:#b9bfd0;font-size:12px;line-height:1.3;
  transition:.12s;white-space:nowrap;
}
.au-seg button:hover{border-color:#4c6a95;color:#d8e6ff}
.au-seg button.on{background:#22374f;border-color:#4d84c9;color:#dbeaff;font-weight:600}
.au-seg button:disabled{opacity:.4;cursor:not-allowed}
.au-in{
  box-sizing:border-box;background:#111219;border:1px solid #353644;border-radius:6px;
  color:#dfe3ee;font-size:12px;padding:5px 8px;font-family:inherit;min-width:0;flex:1 1 120px;
}
.au-in:focus{outline:none;border-color:#4d84c9}
.au-in.num{flex:0 0 68px;text-align:center}
.au-chip{
  font-size:11px;color:#9aa3b6;background:#20222b;border:1px solid #33353f;
  border-radius:10px;padding:1px 8px;
}
.au-note{font-size:11.5px;color:#8b90a0;line-height:1.6;margin-top:2px}
.au-note.warn{color:#e0b070}
.au-note.bad{color:#ff8f8f}
.au-note.ok{color:#7ed6a5}
.au-detail{
  grid-column:1 / -1;border-top:1px dashed #2f3039;margin-top:6px;padding-top:8px;
}
.au-detail summary{cursor:pointer;font-size:12px;color:#a9aebd;list-style:none;user-select:none}
.au-detail summary::-webkit-details-marker{display:none}
.au-detail summary::before{content:"▸ ";color:#6f7688}
.au-detail[open] summary::before{content:"▾ "}
.au-sliders{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 14px;margin-top:8px}
.au-slider{display:grid;grid-template-columns:64px minmax(0,1fr) 42px;gap:6px;align-items:center;font-size:11.5px;color:#a9aebd}
.au-slider input[type=range]{width:100%;accent-color:#4d84c9}
.au-slider output{text-align:right;color:#cfd5e4;font-variant-numeric:tabular-nums}
/* 自动估计模式下这六个参数由模型自己定，视觉上压暗，不隐藏（免得用户以为丢了） */
.au-slider.au-dim{opacity:.42}
.au-sec{margin-top:12px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#6f7688}
.au-sec:first-child{margin-top:6px}
.au-check{display:flex;gap:6px;align-items:center;margin-top:8px;cursor:pointer}
.au-foot{display:flex;gap:8px;align-items:center;margin-top:14px;flex-wrap:wrap}
.au-foot .au-grow{flex:1 1 auto;min-width:0}
.au-btn{
  all:unset;box-sizing:border-box;cursor:pointer;padding:7px 16px;border-radius:7px;
  border:1px solid #3a3b48;background:#24252e;color:#c8cde0;font-size:12.5px;text-align:center;
  transition:.12s;white-space:nowrap;
}
.au-btn:hover{background:#2e3040;color:#e6ebff;border-color:#4c5580}
.au-btn.primary{background:#2b5c96;border-color:#3f7fd6;color:#eaf3ff;font-weight:600}
.au-btn.primary:hover{background:#356fb2}
.au-btn.ghost{background:transparent}
.au-btn:disabled{opacity:.45;cursor:not-allowed}
.au-prog{height:6px;border-radius:3px;background:#23242c;overflow:hidden;margin-top:10px;border:1px solid #2e2f3a}
.au-prog i{display:block;height:100%;width:0;background:linear-gradient(90deg,#3f7fd6,#63b3ed);transition:width .25s}
.au-log{
  margin-top:8px;max-height:88px;overflow:auto;font:11px/1.5 ui-monospace,Consolas,monospace;
  color:#8f96a8;background:#101117;border:1px solid #24252e;border-radius:6px;padding:6px 8px;
  white-space:pre-wrap;word-break:break-all;
}
.au-log:empty{display:none}

/* ── 查看器 ── */
.au-view{
  width:min(1500px,97vw);height:min(92vh,1000px);display:flex;flex-direction:column;
  background:#101116;border:1px solid #33343f;border-radius:10px;overflow:hidden;
}
.au-view .au-head{padding:10px 14px 6px;margin:0;border-bottom:1px solid #24252e}
.au-view .au-head b{font-size:13px}
.au-bar{
  display:flex;align-items:center;gap:8px;padding:7px 12px;border-bottom:1px solid #24252e;
  flex-wrap:wrap;font-size:11.5px;color:#a9aebd;
}
.au-bar .au-btn{padding:4px 10px;font-size:11.5px}
.au-bar .sp{flex:1 1 auto}
.au-stage{flex:1 1 auto;display:flex;gap:8px;overflow:hidden;padding:8px;min-height:0}
.au-pane{
  flex:1 1 0;min-width:0;position:relative;background:#000;border:1px solid #262732;
  border-radius:6px;overflow:auto;cursor:grab;
}
.au-pane:active{cursor:grabbing}
.au-pane .au-tag{
  position:sticky;left:0;top:0;z-index:2;display:inline-block;margin:6px;
  font-size:10px;font-weight:700;letter-spacing:.4px;padding:1px 7px;border-radius:9px;
  background:rgba(18,22,32,.82);border:1px solid #3a3a52;color:#9fb4d8;
}
.au-pane.up .au-tag{color:#8fe0b4;border-color:#2f5a45}
.au-film{width:100%;height:100%;display:flex;align-items:center;justify-content:center}
.au-film video{width:100%;height:100%;object-fit:contain;display:block;background:#000}
.au-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#5b6274;font-size:12px}
`;
    document.head.appendChild(st);
}

/* ── 参数状态（每个节点一份，跑完记住，下次打开还是上次那套） ───────────────── */
function loadPrefs() {
    try {
        return JSON.parse(localStorage.getItem("alber.upscale.prefs") || "{}") || {};
    } catch {
        return {};
    }
}

function savePrefs(p) {
    try {
        localStorage.setItem("alber.upscale.prefs", JSON.stringify(p));
    } catch {
        /* 隐私模式等，忽略 */
    }
}

/* ── 选视频：后端列目录，不开系统对话框（ComfyUI 可能在另一台机器上） ────── */
function fmtSize(n) {
    n = Number(n) || 0;
    if (n >= 1 << 30) return `${(n / (1 << 30)).toFixed(2)} GB`;
    if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(n / 1024))} KB`;
}

function fmtTime(sec) {
    const d = new Date((Number(sec) || 0) * 1000);
    const p = (x) => String(x).padStart(2, "0");
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function openPicker(start) {
    injectCss();
    return new Promise((resolve) => {
        const ov = document.createElement("div");
        ov.className = "au-overlay";
        ov.innerHTML = `
<div class="au-dlg pk-dlg" role="dialog" aria-label="${t("pickTitle")}">
  <div class="au-head">
    <b>${t("pickTitle")}</b>
    <button class="au-x" data-r="x" title="${t("close")}">✕</button>
  </div>
  <div class="au-sub">${t("pickHint")}</div>
  <div class="pk-bar">
    <button class="au-btn ghost" data-r="up">↑ ${t("pickUp")}</button>
    <input class="au-in" data-r="path" spellcheck="false" placeholder="${t("pickPathPh")}">
  </div>
  <div class="pk-quick" data-r="quick"></div>
  <div class="pk-list" data-r="list"><div class="pk-empty">${t("pickLoading")}</div></div>
  <div class="au-foot">
    <span class="au-note au-grow" data-r="sel"></span>
    <button class="au-btn" data-r="cancel">${t("cancel")}</button>
    <button class="au-btn primary" data-r="ok" disabled>${t("pickUse")}</button>
  </div>
</div>`;
        document.body.appendChild(ov);

        const $ = (r) => ov.querySelector(`[data-r="${r}"]`);
        const el = {
            up: $("up"), path: $("path"), quick: $("quick"), list: $("list"),
            sel: $("sel"), ok: $("ok"), cancel: $("cancel"), x: $("x"),
        };

        let cur = "";
        let parent = "";
        let picked = "";
        let seq = 0; // 连点目录时丢弃过期响应

        function close(val) {
            document.removeEventListener("keydown", onKey);
            ov.remove();
            resolve(val || null);
        }

        function onKey(e) {
            if (e.key === "Escape") {
                e.stopPropagation();
                close(null);
            }
        }
        document.addEventListener("keydown", onKey);

        function paintPick() {
            el.ok.disabled = !picked;
            el.sel.textContent = picked ? `${t("pickSelected")}：${baseName(picked)}` : "";
            el.sel.title = picked || "";
            for (const r of el.list.querySelectorAll(".pk-row")) {
                r.classList.toggle("on", r.dataset.p === picked);
            }
        }

        function rowDir(d) {
            const r = document.createElement("div");
            r.className = "pk-row dir";
            r.dataset.p = d.path;
            r.innerHTML = `<span class="pk-ico">▸</span><span class="pk-name"></span>`;
            r.querySelector(".pk-name").textContent = d.name;
            r.title = d.path;
            r.addEventListener("click", () => go(d.path));
            return r;
        }

        function rowFile(f) {
            const r = document.createElement("div");
            r.className = "pk-row file";
            r.dataset.p = f.path;
            r.innerHTML = `<span class="pk-ico">▤</span><span class="pk-name"></span>
              <span class="pk-meta">${fmtSize(f.size)} · ${fmtTime(f.mtime)}</span>`;
            r.querySelector(".pk-name").textContent = f.name;
            r.title = f.path;
            r.addEventListener("click", () => {
                picked = f.path;
                paintPick();
            });
            r.addEventListener("dblclick", () => close(f.path));
            return r;
        }

        function paintQuick(data) {
            if (!data) return;
            el.quick.textContent = "";
            const add = (label, path) => {
                const b = document.createElement("button");
                b.className = "au-btn ghost pk-chip";
                b.textContent = label;
                b.title = path;
                b.addEventListener("click", () => go(path || ""));
                el.quick.appendChild(b);
            };
            for (const q of data.quick || []) add(q.label, q.path);
            for (const q of data.roots || []) add(q.label, q.path);
        }

        async function go(path, autoFirst) {
            const my = ++seq;
            el.list.innerHTML = `<div class="pk-empty">${t("pickLoading")}</div>`;
            let data;
            try {
                data = await apiGet(`${API}/fs_list?path=${encodeURIComponent(path || "")}`);
            } catch (err) {
                if (my !== seq) return;
                el.list.innerHTML = `<div class="pk-empty bad"></div>`;
                el.list.firstChild.textContent = String(err.message || err);
                return;
            }
            if (my !== seq) return;

            // 没给起点（比如面板里还没选过片）：直接落到第一个常用目录，
            // 否则会停在盘符列表这一层，列表是空的、看着像坏了
            if (!path && autoFirst && data.quick?.length) {
                paintQuick(data);
                go(data.quick[0].path);
                return;
            }

            cur = data.path || "";
            parent = data.parent || "";
            el.path.value = cur;
            el.up.disabled = !cur;
            if (data.quick || data.roots) paintQuick(data);

            picked = "";
            paintPick();
            el.list.textContent = "";
            for (const d of data.dirs || []) el.list.appendChild(rowDir(d));
            for (const f of data.files || []) el.list.appendChild(rowFile(f));
            if (!el.list.children.length) {
                el.list.innerHTML = `<div class="pk-empty">${t("pickEmpty")}</div>`;
            }
        }

        el.up.addEventListener("click", () => {
            if (parent) go(parent);
        });
        el.path.addEventListener("keydown", (e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const v = el.path.value.trim();
            if (!v) return;
            // 直接给了个文件 → 就选它；给了目录 → 进去
            if (/\.[a-z0-9]{2,5}$/i.test(v)) {
                picked = v;
                paintPick();
                close(v);
                return;
            }
            go(v);
        });
        el.ok.addEventListener("click", () => close(picked));
        el.cancel.addEventListener("click", () => close(null));
        el.x.addEventListener("click", () => close(null));
        ov.addEventListener("mousedown", (e) => {
            if (e.target === ov) close(null);
        });

        go(start || "", !start);
    });
}

/* ── 对话框 ───────────────────────────────────────────────────────────────── */
function openDialog(node, onDone) {
    injectCss();
    // 没有当前成片也允许打开：直接在面板里选一条已有的片做二采
    let src = String(node?.properties?.alberMp4Path || "").trim();
    if (node && !node.properties) node.properties = {};

    const prefs = loadPrefs();
    const state = {
        engine: prefs.engine || "topaz",
        mode: prefs.mode || "2x",
        targetW: 0,
        targetH: 0,
        info: {},
        status: null,
        jobId: "",
        timer: 0,
        done: null,
        prefs,
    };

    const ov = document.createElement("div");
    ov.className = "au-overlay";
    ov.innerHTML = `
<div class="au-dlg" role="dialog" aria-label="${t("title")}">
  <div class="au-head">
    <b>${t("title")}</b>
    <span class="au-chip" data-r="srcname"></span>
    <button class="au-x" data-r="x" title="${t("close")}">✕</button>
  </div>
  <div class="au-sub">${t("sub")}</div>
  <div class="au-srcbar" data-r="srcbar" title="${t("dragHint")}">
    <span class="au-srcpath" data-r="srcpath"></span>
    <button class="au-btn ghost" data-r="pick">${t("pickVideo")}</button>
  </div>
  <div class="au-grid">
    <div class="au-label">${t("engine")}</div>
    <div class="au-row">
      <div class="au-seg" data-r="eng">
        <button data-v="topaz">${t("engineTopaz")}</button>
        <button data-v="ffmpeg">${t("engineFfmpeg")}</button>
      </div>
      <span class="au-chip" data-r="engchip">…</span>
    </div>
    <div class="au-label"></div>
    <div class="au-note" data-r="enghint"></div>

    <div class="au-label">${t("target")}</div>
    <div class="au-row">
      <div class="au-seg" data-r="mode">
        <button data-v="2x">2×</button>
        <button data-v="1.5x">1.5×</button>
        <button data-v="1080p">1080p</button>
        <button data-v="custom">${t("customW")}×${t("customH")}</button>
      </div>
      <span class="au-chip" data-r="size">…</span>
      <input class="au-in num" data-r="tw" type="number" min="64" max="8192" step="2" style="display:none">
      <input class="au-in num" data-r="th" type="number" min="64" max="8192" step="2" style="display:none">
    </div>

    <div class="au-label">${t("preset")}</div>
    <div class="au-row">
      <div class="au-seg" data-r="preset">
        <button data-v="ai">${t("pAi")}</button>
        <button data-v="live">${t("pLive")}</button>
        <button data-v="fix">${t("pFix")}</button>
        <button data-v="custom">${t("pCustom")}</button>
      </div>
    </div>
    <div class="au-label"></div>
    <div class="au-note" data-r="presethint"></div>

    <div class="au-label">${t("mode2")}</div>
    <div class="au-row">
      <div class="au-seg" data-r="psrc">
        <button data-v="manual">${t("modeManual")}</button>
        <button data-v="auto">${t("modeAuto")}</button>
      </div>
      <span class="au-chip" data-r="srcchip">…</span>
    </div>
    <div class="au-label"></div>
    <div class="au-note" data-r="srchint"></div>

    <details class="au-detail" data-r="det" open>
      <summary>${t("params")}</summary>
      <div class="au-sec" data-r="sec1">${t("gMain")}</div>
      <div class="au-sliders" data-r="sliders"></div>
      <label class="au-note au-check"><input type="checkbox" data-r="kcolor"> ${t("kcolor")}</label>
      <div class="au-sec">${t("gGrain")}</div>
      <div class="au-sliders" data-r="sliders2"></div>
      <div class="au-sec">${t("gPerf")}</div>
      <div class="au-sliders" data-r="sliders3"></div>
    </details>

    <div class="au-label">${t("outDir")}</div>
    <div class="au-row">
      <input class="au-in" data-r="dir" spellcheck="false">
      <button class="au-btn ghost" data-r="usesrc">${t("useSrcDir")}</button>
    </div>
    <div class="au-label">${t("outName")}</div>
    <div class="au-row">
      <input class="au-in" data-r="name" spellcheck="false">
      <label class="au-note" style="display:flex;gap:5px;align-items:center;flex:none">
        <input type="checkbox" data-r="ow"> ${t("overwrite")}
      </label>
    </div>
    <div class="au-label"></div>
    <div class="au-row">
      <label class="au-note" style="display:flex;gap:5px;align-items:center">
        <input type="checkbox" data-r="auto" checked> ${t("autoMount")}
      </label>
      <span class="au-note" data-r="tip">${t("tip")}</span>
    </div>
  </div>
  <div class="au-prog" data-r="prog" style="display:none"><i></i></div>
  <div class="au-log" data-r="log"></div>
  <div class="au-foot">
    <span class="au-note au-grow" data-r="state"></span>
    <button class="au-btn" data-r="close">${t("close")}</button>
    <button class="au-btn primary" data-r="go">${t("start")}</button>
  </div>
</div>`;
    document.body.appendChild(ov);

    const $ = (r) => ov.querySelector(`[data-r="${r}"]`);
    const el = {
        srcname: $("srcname"), srcbar: $("srcbar"), srcpath: $("srcpath"), pick: $("pick"),
        eng: $("eng"), engchip: $("engchip"), enghint: $("enghint"),
        mode: $("mode"), size: $("size"), tw: $("tw"), th: $("th"),
        preset: $("preset"), presethint: $("presethint"),
        psrc: $("psrc"), srcchip: $("srcchip"), srchint: $("srchint"),
        det: $("det"), sliders: $("sliders"), sliders2: $("sliders2"), sliders3: $("sliders3"),
        kcolor: $("kcolor"), dir: $("dir"), name: $("name"),
        usesrc: $("usesrc"), ow: $("ow"), auto: $("auto"), prog: $("prog"),
        log: $("log"), state: $("state"), go: $("go"), close: $("close"), x: $("x"),
    };

    el.srcname.textContent = src ? baseName(src) : "";
    el.srcpath.textContent = src || t("noSrcPick");
    el.srcpath.title = src || "";
    el.srcpath.classList.toggle("empty", !src);
    el.dir.value = prefs.dir || (src ? dirName(src) : "");
    el.name.value = prefs.name || (src ? proteusName(src) : "");
    el.ow.checked = !!prefs.overwrite;
    el.auto.checked = prefs.auto !== false;
    el.go.disabled = !src;

    /* 换源：从「选择视频」进来。输出目录/文件名只在它们还是旧源的派生值时才跟着改，
       用户手改过就保留 —— 多数人是固定输出到一个交付目录的。 */
    function applySrc(next) {
        next = String(next || "").trim();
        if (!next || next === src) return;
        const oldDir = dirName(src);
        const keepDir = el.dir.value.trim() && el.dir.value.trim() !== oldDir;
        const keepName = el.name.value.trim() && el.name.value.trim() !== proteusName(src);

        src = next;
        try {
            node.properties[PROP_SRC] = next;
        } catch {
            /* 只读节点，忽略 */
        }
        el.srcpath.textContent = next;
        el.srcpath.title = next;
        el.srcpath.classList.remove("empty");
        el.srcname.textContent = baseName(next);
        el.go.disabled = false;
        if (!keepDir) el.dir.value = dirName(next);
        if (!keepName) el.name.value = proteusName(next);
        el.state.textContent = "";
        el.state.className = "au-note au-grow";
        el.log.textContent = "";
        el.prog.querySelector("i").style.width = "0%";
        loadInfo();
    }

    async function pickVideo() {
        const start = dirName(src) || "";
        const picked = await openPicker(start);
        if (picked) applySrc(picked);
    }

    el.pick.addEventListener("click", pickVideo);

    /* 拖文件进来：Electron（ComfyUI Desktop）会给 f.path，普通浏览器没有，能拿就拿 */
    el.srcbar.addEventListener("dragover", (e) => {
        e.preventDefault();
        el.srcbar.classList.add("drag");
    });
    el.srcbar.addEventListener("dragleave", () => el.srcbar.classList.remove("drag"));
    el.srcbar.addEventListener("drop", (e) => {
        e.preventDefault();
        el.srcbar.classList.remove("drag");
        const f = e.dataTransfer?.files?.[0];
        if (!f) return;
        const p = f.path || f.webkitRelativePath || "";
        if (p) applySrc(p);
    });

    /* 参数：默认 = 「AI 成片」预设（实测最自然的一组） */
    const DEF = {
        estimate: 0, blend: 0.2, preblur: 0, noise: 0, details: 0, halo: 0, blur: 0, compression: 0,
        prenoise: 0, grain: 0, gsize: 0, kcolor: 1, vram: 0.75, instances: 1,
    };
    const PRESETS = {
        ai: Object.assign({}, DEF),
        // 实拍素材：先自动估参数，其余留给模型
        live: Object.assign({}, DEF, { estimate: 16 }),
        // 抓来的糊片：去块 + 轻降噪 + 轻锐化
        fix: Object.assign({}, DEF, {
            estimate: 8, blend: 0.15, compression: 0.5, noise: 0.1, halo: 0.1, blur: 0.1, details: 0.1,
        }),
        custom: null,
    };
    const PRESET_HINT = {
        ai: "presetHintAi", live: "presetHintLive", fix: "presetHintFix", custom: "presetHintCustom",
    };
    const params = Object.assign({}, DEF, prefs.params || {});
    let preset = PRESETS[prefs.preset] ? prefs.preset : "ai";

    const SLIDERS = {
        sliders: [
            ["estimate", t("estimate"), 0, 40, 1, t("estimateHint")],
            ["details", t("details"), -1, 1, 0.05, t("hDetails")],
            ["noise", t("noise"), -1, 1, 0.05, t("hNoise")],
            ["blur", t("blur"), -1, 1, 0.05, t("hBlur")],
            ["halo", t("halo"), -1, 1, 0.05, t("hHalo")],
            ["compression", t("compression"), -1, 1, 0.05, t("hComp")],
            ["preblur", t("preblur"), -1, 1, 0.05, t("hPreblur")],
            ["blend", t("blend"), 0, 1, 0.05, t("hBlend")],
        ],
        sliders2: [
            ["prenoise", t("prenoise"), 0, 0.1, 0.01, t("hPrenoise")],
            ["grain", t("grain"), 0, 0.1, 0.01, t("hGrain")],
            ["gsize", t("gsize"), 0, 5, 0.5, t("hGsize")],
        ],
        sliders3: [
            ["vram", t("vram"), 0.1, 1, 0.05, t("hVram")],
            ["instances", t("instances"), 0, 3, 1, t("hInst")],
        ],
    };

    const rows = {};
    for (const [host, defs] of Object.entries(SLIDERS)) {
        for (const [key, label, lo, hi, step, hint] of defs) {
            const row = document.createElement("div");
            row.className = "au-slider";
            row.dataset.k = key;
            row.title = hint || label;
            row.innerHTML = `<span>${label}</span>
              <input type="range" min="${lo}" max="${hi}" step="${step}" value="${params[key] ?? 0}">
              <output>${params[key] ?? 0}</output>`;
            const rng = row.querySelector("input");
            const out = row.querySelector("output");
            row.addEventListener("pointerdown", (e) => e.stopPropagation());
            rng.addEventListener("input", () => {
                params[key] = Number(rng.value);
                out.textContent = rng.value;
                preset = "custom";
                paintPreset();
            });
            el[host].appendChild(row);
            rows[key] = { row, rng, out };
        }
    }

    function syncValues() {
        for (const [key, r] of Object.entries(rows)) {
            r.rng.value = String(params[key] ?? 0);
            r.out.textContent = String(params[key] ?? 0);
        }
        el.kcolor.checked = !!Number(params.kcolor);
    }

    function paintPreset() {
        for (const b of el.preset.querySelectorAll("button")) {
            b.classList.toggle("on", b.dataset.v === preset);
        }
        el.presethint.textContent = t(PRESET_HINT[preset] || "presetHintAi");
        paintSource();
    }

    /* 手动 / 自动：estimate > 0 就是自动估计，此时画面六个参数由模型自己定 */
    const isAuto = () => Number(params.estimate) > 0;

    function paintSource() {
        const auto = isAuto();
        for (const b of el.psrc.querySelectorAll("button")) {
            b.classList.toggle("on", b.dataset.v === (auto ? "auto" : "manual"));
        }
        el.srcchip.textContent = auto ? `${t("estimate")} ${params.estimate}` : "";
        el.srcchip.style.display = auto ? "" : "none";
        el.srchint.textContent = auto ? t("modeHintAuto") : t("modeHintManual");
        for (const k of ["details", "noise", "blur", "halo", "compression", "preblur"]) {
            rows[k]?.row.classList.toggle("au-dim", auto);
        }
    }

    el.kcolor.checked = !!Number(params.kcolor);
    el.kcolor.addEventListener("change", () => {
        params.kcolor = el.kcolor.checked ? 1 : 0;
        preset = "custom";
        paintPreset();
    });

    el.preset.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-v]");
        if (!b) return;
        const name = b.dataset.v;
        if (name === "custom") {
            preset = "custom";
            paintPreset();
            return;
        }
        Object.assign(params, PRESETS[name]);
        syncValues();
        preset = name;
        paintPreset();
    });

    el.psrc.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-v]");
        if (!b) return;
        const want = b.dataset.v;
        if (want === "auto" && !isAuto()) params.estimate = 16;
        if (want === "manual") params.estimate = 0;
        syncValues();
        preset = "custom";
        paintPreset();
    });

    paintPreset();

    /* 目标尺寸 */
    function fit(mode) {
        const w = Number(state.info.width) || 0;
        const h = Number(state.info.height) || 0;
        if (!w || !h) return [0, 0];
        if (mode === "custom") {
            return [even(el.tw.value || w * 2), even(el.th.value || h * 2)];
        }
        if (mode === "1080p") return w >= h ? [even((1080 * w) / h), 1080] : [1080, even((1080 * h) / w)];
        const k = mode === "1.5x" ? 1.5 : 2;
        return [even(w * k), even(h * k)];
    }

    function paintSize() {
        const [w, h] = fit(state.mode);
        state.targetW = w;
        state.targetH = h;
        el.size.textContent = w && h ? `${w}×${h}` : "—";
        el.tw.style.display = state.mode === "custom" ? "" : "none";
        el.th.style.display = state.mode === "custom" ? "" : "none";
    }

    function paintSeg(seg, value) {
        for (const b of seg.querySelectorAll("button")) {
            b.classList.toggle("on", b.dataset.v === value);
        }
    }

    paintSeg(el.eng, state.engine);
    paintSeg(el.mode, state.mode);
    paintSize();

    el.eng.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-v]");
        if (!b) return;
        state.engine = b.dataset.v;
        paintSeg(el.eng, state.engine);
        paintEngineHint();
    });
    el.mode.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-v]");
        if (!b) return;
        state.mode = b.dataset.v;
        paintSeg(el.mode, state.mode);
        paintSize();
    });
    el.tw.addEventListener("input", paintSize);
    el.th.addEventListener("input", paintSize);
    el.usesrc.addEventListener("click", () => {
        el.dir.value = dirName(src);
    });

    function paintEngineHint() {
        const isTopaz = state.engine === "topaz";
        el.enghint.textContent = isTopaz ? t("engineTopazHint") : t("engineFfmpegHint");
        el.enghint.className = "au-note";
        el.det.style.display = isTopaz ? "" : "none";
        const probe = state.status?.probe;
        if (!isTopaz) {
            el.engchip.textContent = "ffmpeg";
            el.engchip.style.color = "";
            return;
        }
        if (!state.status) {
            el.engchip.textContent = t("checking");
            return;
        }
        if (probe?.ok) {
            el.engchip.textContent = "OK";
            el.engchip.style.color = "#7ed6a5";
        } else if (probe) {
            el.engchip.textContent = t("notReady");
            el.engchip.style.color = "#e0b070";
            el.enghint.textContent = `${t("needTopaz")}（${probe.reason}）`;
            el.enghint.className = "au-note warn";
        } else {
            el.engchip.textContent = state.status.topaz?.found ? t("probe") : t("notReady");
            el.engchip.style.color = state.status.topaz?.found ? "" : "#e0b070";
            if (!state.status.topaz?.found) {
                el.enghint.textContent = t("needTopaz");
                el.enghint.className = "au-note warn";
            }
        }
    }

    /* 源文件信息 + 引擎状态 */
    async function loadInfo() {
        if (!src) {
            el.srcname.textContent = "";
            return;
        }
        try {
            const d = await apiGet(`${API}/upscale_info?path=${encodeURIComponent(src)}`);
            state.info = d.info || {};
            const i = state.info;
            el.srcname.textContent = `${baseName(src)} · ${i.width}×${i.height} · ${i.frames} 帧`;
            paintSize();
        } catch (err) {
            el.srcname.textContent = `${baseName(src)} · ${t("badSrc")}`;
        }
    }

    async function loadStatus() {
        paintEngineHint();
        try {
            state.status = await apiGet(`${API}/upscale_status`);
        } catch (err) {
            state.status = null;
            el.state.textContent = String(err.message || err);
            el.state.className = "au-note bad au-grow";
            return;
        }
        paintEngineHint();
    }

    // 状态里没带 probe 结果时，后台补一次（实跑 2 帧，几秒）
    async function ensureProbe() {
        if (state.status?.probe) return;
        if (!state.status?.topaz?.found) return;
        el.engchip.textContent = t("probing");
        try {
            state.status = await apiGet(`${API}/upscale_status?probe=1`);
        } catch {
            /* ignore */
        }
        paintEngineHint();
    }

    /* 起作业 + 轮询 */
    function stopPoll() {
        if (state.timer) {
            clearInterval(state.timer);
            state.timer = 0;
        }
    }

    function setRunning(on) {
        el.go.textContent = on ? t("stop") : t("start");
        el.go.classList.toggle("primary", !on);
        el.go.disabled = !on && !src;  // 没源的时候「开始」保持灰的
        el.prog.style.display = on ? "" : "none";
        for (const node of ov.querySelectorAll(".au-seg button, .au-in, .au-slider input, .au-check input, .au-srcbar button")) {
            node.disabled = on;
        }
    }

    async function startJob() {
        if (!src) {
            el.state.textContent = t("needPick");
            el.state.className = "au-note bad au-grow";
            return;
        }
        const dir = String(el.dir.value || "").trim() || dirName(src);
        const name = String(el.name.value || "").trim() || proteusName(src);
        const outPath = `${dir.replace(/[\\/]+$/, "")}\\${name}`;
        state.prefs = {
            engine: state.engine,
            mode: state.mode,
            preset,
            dir: el.dir.value,
            name: el.name.value,
            overwrite: el.ow.checked,
            auto: el.auto.checked,
            params,
        };
        savePrefs(state.prefs);

        el.state.textContent = t("starting");
        el.state.className = "au-note au-grow";
        el.log.textContent = "";
        el.prog.querySelector("i").style.width = "0%";
        setRunning(true);

        try {
            const d = await apiPost(`${API}/upscale_start`, {
                src,
                out_path: outPath,
                engine: state.engine,
                mode: state.mode,
                target_w: state.targetW,
                target_h: state.targetH,
                qp: 18,
                overwrite: !!el.ow.checked,
                params,
            });
            state.jobId = d.id;
        } catch (err) {
            setRunning(false);
            el.state.textContent = `${t("errPrefix")}${err.message || err}`;
            el.state.className = "au-note bad au-grow";
            return;
        }

        stopPoll();
        state.timer = setInterval(poll, POLL_MS);
    }

    async function poll() {
        if (!state.jobId) return;
        let d;
        try {
            d = await apiGet(`${API}/upscale_job?id=${encodeURIComponent(state.jobId)}`);
        } catch (err) {
            stopPoll();
            setRunning(false);
            el.state.textContent = `${t("errPrefix")}${err.message || err}`;
            el.state.className = "au-note bad au-grow";
            return;
        }
        const pct = Math.max(0, Math.min(100, Number(d.pct) || 0));
        el.prog.querySelector("i").style.width = `${pct}%`;
        if (d.state === "running") {
            el.state.textContent = `${t("running")} ${pct.toFixed(0)}% · ${d.frame}/${d.total || "?"} · ${d.elapsed}s`;
            if (d.log?.length) el.log.textContent = d.log.slice(-8).join("\n");
            return;
        }

        stopPoll();
        setRunning(false);
        if (d.state === "done") {
            const i = d.info || {};
            state.done = d;
            el.state.textContent = `✓ ${t("ok")} · ${t("doneInfo", {
                w: i.width || state.targetW,
                h: i.height || state.targetH,
                n: i.frames || 0,
                mb: fmtMB(i.size),
                s: d.elapsed,
            })}`;
            el.state.className = "au-note ok au-grow";
            el.go.style.display = "none";
            el.close.textContent = t("close");
            // 追加「打开目录 / 再跑一次」
            if (!ov.querySelector('[data-r="after"]')) {
                const box = document.createElement("span");
                box.dataset.r = "after";
                box.style.display = "flex";
                box.style.gap = "8px";
                box.innerHTML = `<button class="au-btn ghost" data-r="reopen">${t("reopen")}</button>
                  <button class="au-btn" data-r="again">${t("again")}</button>`;
                el.go.parentNode.insertBefore(box, el.go);
                box.querySelector('[data-r="reopen"]').addEventListener("click", () => {
                    void apiPost(`${API}/open_folder`, { path: dirName(d.out_path) }).catch(() => {});
                });
                box.querySelector('[data-r="again"]').addEventListener("click", () => {
                    box.remove();
                    el.go.style.display = "";
                    el.state.textContent = "";
                    startJob();
                });
            }
            if (el.auto.checked && typeof onDone === "function") {
                try {
                    onDone({ path: d.out_path, info: i, src });
                } catch (err) {
                    console.warn("[Alber] 挂载二采预览失败", err);
                }
            }
        } else if (d.state === "cancelled") {
            el.state.textContent = t("cancelHint");
            el.state.className = "au-note au-grow";
        } else {
            el.state.textContent = `${t("errPrefix")}${d.error || "unknown"}`;
            el.state.className = "au-note bad au-grow";
            if (d.log?.length) el.log.textContent = d.log.slice(-10).join("\n");
        }
    }

    el.go.addEventListener("click", async () => {
        if (state.jobId && el.go.textContent === t("stop")) {
            try {
                await apiPost(`${API}/upscale_cancel`, { id: state.jobId });
            } catch {
                /* ignore */
            }
            return;
        }
        if (state.engine === "topaz" && !state.status?.probe?.ok) {
            // 不拦着，但先把原因摆出来，免得跑一半才看到红字
            await ensureProbe();
        }
        startJob();
    });

    function close() {
        stopPoll();
        ov.remove();
        document.removeEventListener("keydown", onKey);
    }
    function onKey(e) {
        if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    el.close.addEventListener("click", close);
    el.x.addEventListener("click", close);
    ov.addEventListener("click", (e) => {
        if (e.target === ov) close();
    });

    void loadInfo();
    void loadStatus().then(ensureProbe);
}

/* ── 右侧放大预览列 ───────────────────────────────────────────────────────── */
function buildUpColumn(node) {
    const col = document.createElement("div");
    col.className = `${COL_CLASS} ${UP_CLASS}`;
    col.innerHTML = `
      <div class="apc-head">
        <span class="apc-tag">${t("upTag")}</span>
        <span class="apc-file">—</span>
      </div>
      <div class="apc-stage">
        <video class="apc-video" controls playsinline preload="metadata"></video>
        <div class="apc-empty"><b>${t("upTagFull")}</b><span>—</span></div>
      </div>
      <div class="apc-actions">
        <button type="button" class="apc-btn au-cmp" title="${t("compare")}">${t("compare")}</button>
        <button type="button" class="apc-btn au-exp" title="${t("expand")}">${t("expand")}</button>
        <button type="button" class="apc-btn au-del" title="${t("remove")}">✕</button>
      </div>`;
    return col;
}

export function mountUpColumn(node, rec) {
    if (!node || !rec?.path) return false;
    const host = node?._minimaxDomWidget?.element;
    if (!host) return false;
    injectCss();

    const main = host.querySelector(`:scope > .${COL_CLASS}.is-main`) || host.querySelector(`:scope > .${COL_CLASS}`);
    if (!main) return false;

    let col = host.querySelector(`:scope > .${UP_CLASS}`);
    if (!col) {
        col = buildUpColumn(node);
        host.appendChild(col);
        host.classList.add("alber-has-up");
    }

    // 先按主列当前宽度占位，再让 mp4 面板重算一次几何
    const prevW = parseInt(getComputedStyle(host).getPropertyValue("--alber-prev-w") || "0", 10) || 320;
    node._alberUpColW = prevW;

    // 首次出现时把节点补宽一列（否则两列会把时间轴挤没）
    if (!node.properties) node.properties = {};
    if (!node.properties.alberUpWidened) {
        node.properties.alberUpWidened = true;
        try {
            const w = Math.round(node.size?.[0] || 1000);
            node.setSize?.([w + prevW + 8, node.size?.[1] || 680]);
        } catch {
            /* ignore */
        }
    }
    syncPreviewGeometry(node);

    const file = col.querySelector(".apc-file");
    const stage = col.querySelector(".apc-stage");
    const video = col.querySelector(".apc-video");
    const empty = col.querySelector(".apc-empty");
    const label = `${baseName(rec.path)}${rec.info?.width ? ` · ${rec.info.width}×${rec.info.height}` : ""}`;
    file.textContent = label;
    file.title = rec.path;
    file.classList.add("has");
    video.src = previewUrl(rec.path, Date.now());
    try {
        video.load();
    } catch {
        /* ignore */
    }
    stage.classList.add("has");
    empty.style.display = "none";

    node.properties[PROP_UP] = rec.path;
    if (rec.src) node.properties[PROP_SRC] = rec.src;
    node._alberUpRec = { ...rec };

    col.querySelector(".au-cmp").onclick = (e) => {
        e.stopPropagation();
        openViewer(node, true);
    };
    col.querySelector(".au-exp").onclick = (e) => {
        e.stopPropagation();
        openViewer(node, false);
    };
    col.querySelector(".au-del").onclick = (e) => {
        e.stopPropagation();
        unmountUpColumn(node);
    };
    try {
        node.setDirtyCanvas?.(true, true);
    } catch {
        /* ignore */
    }
    return true;
}

export function unmountUpColumn(node) {
    const host = node?._minimaxDomWidget?.element;
    if (!host) return;
    host.querySelector(`:scope > .${UP_CLASS}`)?.remove();
    host.classList.remove("alber-has-up");
    node._alberUpColW = 0;
    node._alberUpRec = null;
    if (node.properties) {
        delete node.properties[PROP_UP];
        delete node.properties[PROP_SRC];
    }
    syncPreviewGeometry(node);
    try {
        node.setDirtyCanvas?.(true, true);
    } catch {
        /* ignore */
    }
}

/* ── 查看器：展开 / 并排对比（缩放 + 拖动平移） ────────────────────────────── */
function openViewer(node, split) {
    injectCss();
    const upPath = node?.properties?.[PROP_UP];
    // 先看这次二采用的是哪个源（可能是手选的另一条片），没有才回退到当前成片
    const srcPath = node?.properties?.[PROP_SRC] || node?.properties?.alberMp4Path || "";
    if (!upPath) {
        alert(t("noSrc"));
        return;
    }
    let isSplit = !!split;
    let zoom = 1;

    const ov = document.createElement("div");
    ov.className = "au-overlay";
    ov.innerHTML = `
<div class="au-view">
  <div class="au-head">
    <b>${t("upTagFull")}</b>
    <span class="au-chip" data-r="meta"></span>
    <button class="au-x" data-r="x" title="${t("close")}">✕</button>
  </div>
  <div class="au-bar">
    <button class="au-btn" data-r="mode"></button>
    <label style="display:flex;gap:5px;align-items:center" data-r="syncbox">
      <input type="checkbox" data-r="sync" checked> ${t("sync")}
    </label>
    <span class="sp"></span>
    <span>${t("zoom")}</span>
    <button class="au-btn" data-r="zo">−</button>
    <span class="au-chip" data-r="zp">100%</span>
    <button class="au-btn" data-r="zi">+</button>
    <button class="au-btn" data-r="fit">${t("reset")}</button>
  </div>
  <div class="au-stage" data-r="stage"></div>
</div>`;
    document.body.appendChild(ov);

    const $ = (r) => ov.querySelector(`[data-r="${r}"]`);
    const stage = $("stage");
    const meta = $("meta");
    const modeBtn = $("mode");
    const syncBox = $("syncbox");
    const syncChk = $("sync");
    const zp = $("zp");

    function pane(tag, path, cls) {
        const d = document.createElement("div");
        d.className = `au-pane ${cls || ""}`;
        d.innerHTML = `<span class="au-tag">${tag}</span>
          <div class="au-film"><video src="${previewUrl(path, Date.now())}" controls playsinline preload="metadata"></video></div>`;
        return d;
    }

    const panes = [];
    function render() {
        stage.innerHTML = "";
        panes.length = 0;
        const upPane = pane(t("upTagFull"), upPath, "up");
        if (isSplit && srcPath) {
            const srcPane = pane(t("srcTag"), srcPath, "");
            stage.append(srcPane, upPane);
            panes.push(srcPane.querySelector("video"), upPane.querySelector("video"));
            syncBox.style.display = "";
        } else {
            stage.append(upPane);
            panes.push(upPane.querySelector("video"));
            syncBox.style.display = "none";
        }
        modeBtn.textContent = isSplit ? t("single") : t("split");
        applyZoom();
        bindSync();
        bindPan();
    }

    function applyZoom() {
        for (const film of stage.querySelectorAll(".au-film")) {
            film.style.width = `${zoom * 100}%`;
            film.style.height = `${zoom * 100}%`;
        }
        zp.textContent = `${Math.round(zoom * 100)}%`;
    }

    let syncing = false;
    function bindSync() {
        if (panes.length < 2) return;
        const [a, b] = panes;
        const mirror = (from, to) => {
            if (!syncChk.checked || syncing) return;
            syncing = true;
            try {
                if (Math.abs((to.currentTime || 0) - (from.currentTime || 0)) > 0.12) {
                    to.currentTime = from.currentTime;
                }
            } catch {
                /* ignore */
            }
            syncing = false;
        };
        for (const [from, to] of [[a, b], [b, a]]) {
            from.addEventListener("play", () => {
                if (!syncChk.checked) return;
                mirror(from, to);
                void to.play().catch(() => {});
            });
            from.addEventListener("pause", () => {
                if (!syncChk.checked) return;
                to.pause();
            });
            from.addEventListener("seeking", () => mirror(from, to));
            from.addEventListener("timeupdate", () => mirror(from, to));
        }
    }

    function bindPan() {
        for (const p of stage.querySelectorAll(".au-pane")) {
            let sx = 0;
            let sy = 0;
            let sl = 0;
            let st = 0;
            let down = false;
            p.addEventListener("mousedown", (e) => {
                if (e.button !== 0 || zoom <= 1) return;
                down = true;
                sx = e.clientX;
                sy = e.clientY;
                sl = p.scrollLeft;
                st = p.scrollTop;
                e.preventDefault();
            });
            const move = (e) => {
                if (!down) return;
                p.scrollLeft = sl - (e.clientX - sx);
                p.scrollTop = st - (e.clientY - sy);
            };
            const up = () => {
                down = false;
            };
            p.addEventListener("mousemove", move);
            p.addEventListener("mouseup", up);
            p.addEventListener("mouseleave", up);
            p.addEventListener("wheel", (e) => {
                if (!e.ctrlKey && !e.metaKey) return; // 不抢普通滚轮（那是滚动）
                e.preventDefault();
                zoom = Math.max(1, Math.min(4, zoom + (e.deltaY < 0 ? 0.25 : -0.25)));
                applyZoom();
            }, { passive: false });
        }
    }

    modeBtn.addEventListener("click", () => {
        isSplit = !isSplit;
        render();
    });
    $("zi").addEventListener("click", () => {
        zoom = Math.min(4, zoom + 0.25);
        applyZoom();
    });
    $("zo").addEventListener("click", () => {
        zoom = Math.max(1, zoom - 0.25);
        applyZoom();
    });
    $("fit").addEventListener("click", () => {
        zoom = 1;
        applyZoom();
    });

    const rec = node._alberUpRec || {};
    const i = rec.info || {};
    const bits = [baseName(upPath)];
    if (i.width) bits.push(`${i.width}×${i.height}`);
    if (i.frames) bits.push(`${i.frames} 帧`);
    if (i.size) bits.push(`${fmtMB(i.size)} MB`);
    meta.textContent = bits.join(" · ");

    function close() {
        ov.remove();
        document.removeEventListener("keydown", onKey);
    }
    function onKey(e) {
        if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    $("x").addEventListener("click", close);
    ov.addEventListener("click", (e) => {
        if (e.target === ov) close();
    });

    render();
}

/* ── 挂载 ─────────────────────────────────────────────────────────────────── */
export function installUpscalePanel(node) {
    const host = node?._minimaxDomWidget?.element;
    if (!host) return false;
    injectCss();

    const main = host.querySelector(`:scope > .${COL_CLASS}.is-main`) || host.querySelector(`:scope > .${COL_CLASS}`);
    if (!main) return false;
    if (main.querySelector(".apc-up-row")) return true; // 幂等

    const row = document.createElement("div");
    row.className = "apc-up-row";
    row.innerHTML = `<button type="button" class="apc-btn apc-up" title="${t("btnTitle")}">✦ ${t("btn")}</button>`;
    const btn = row.querySelector("button");
    const note = main.querySelector(".apc-note") || main.querySelector(".apc-actions");

    // 放在按钮行下面、提示上面
    if (note) note.parentNode.insertBefore(row, note);
    else main.appendChild(row);

    btn.addEventListener("click", (e) => {
        e.stopPropagation();
        openDialog(node, (rec) => {
            mountUpColumn(node, rec);
            btn.classList.add("is-on");
        });
    });

    // 上次的放大结果还在，就把列挂回去（路径跟着工作流走）
    const saved = node?.properties?.[PROP_UP];
    if (saved) {
        mountUpColumn(node, { path: saved, src: node?.properties?.[PROP_SRC] || "" });
        btn.classList.add("is-on");
    }
    return true;
}
