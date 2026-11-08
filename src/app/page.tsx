"use client";
import {motion, AnimatePresence, LayoutGroup, type Transition} from "motion/react";
import {useEffect, useRef, useState} from "react";
import {flushSync} from "react-dom";
import Script from "next/script";
import AsciiVideo from "@/app/components/AsciiVideo";

const sentence = "How I Make Ideas Come Out Slowly";
const words = sentence.split(" ");

// ---------------- 缓动 ----------------
const EASE_OUT = [0.16, 1, 0.3, 1] as const;      // easeOutQuint：入场
const EASE_IN_OUT = [0.76, 0, 0.24, 1] as const;  // easeInOutQuart：变形/位移

// ---------------- 节奏（秒） ----------------
const IN_DUR = 0.9;          // 每词入场时长
const IN_STAGGER = 0.08;     // 入场错峰
const HOLD = 1.5;            // 整句停留
const COLLAPSE_DUR = 0.75;   // 非首字母收拢
const COLLAPSE_STAGGER = 0.035;
const GROW_DUR = 0.9;        // HIMICOS 放大
const HIMI_DELAY = 0.7;       // HIMICOS 开始放大后多久冒出 Himi~
const HIMI_DUR = 1.25;        // Himi~ 弹出 → 停留 → 消失
// 大标题停留到 Himi~ 刚好消失，再飞入方框
const TITLE_HOLD = HIMI_DELAY + HIMI_DUR - GROW_DUR;
const FLY_DUR = 1.05;        // 大标题 → 方框内小标题

const TOTAL_IN = (words.length - 1) * IN_STAGGER + IN_DUR;
const TOTAL_COLLAPSE = (words.length - 1) * COLLAPSE_STAGGER + COLLAPSE_DUR;

type Phase = "wait" | "in" | "collapse" | "title" | "block";

const TIMELINE: [Phase, number][] = [
    ["collapse", TOTAL_IN + HOLD],
    ["title", TOTAL_IN + HOLD + TOTAL_COLLAPSE - 0.2],
    ["block", TOTAL_IN + HOLD + TOTAL_COLLAPSE - 0.2 + GROW_DUR + TITLE_HOLD],
];

// ---------------- Swarm 开场（public/swarm-cursors.js 的 session 模式） ----------------
// 同一群光标从头陪到尾：
// 0. 黑屏中间是灰色的 logo，光标们飞进来围着它转；下方用多国语言轮流写“点击图标”，等访客点击
//    （这一下点击也让浏览器允许播放声音）。点下去 logo 一弹、爆开一圈光，光标被冲散再聚拢
// 1. 一个光标把 logo 拖到那句话下方（够低，光标绕着它转圈时不挡字）
// 2. 光标把整句话画出来，画完后围着 logo 转圈，一个光标去点底部的 Play
// 3. 页面播放收拢动画：HIMICOS 放大，一个光标飞过去拍它一下 → 弹出 Himi~ → 飞进方框位置
// 4. 底部的进度条弹出来：第二轮重建的头两个 layer 是“把 logo 缩小并拖进方框”（其他光标一起摸着它端过去）
//    和“从上往下给它上色”；logo 一放好，一个光标给它上色的同时，其他光标就一个接一个去干活：
//    重建电视（玻璃屏、复制出来的扫描线）和方框；先干完的光标绕着屏幕中间（方框外面一圈）转
// 6. 全部完成后 Play 出现，一个光标按下；光标从两边散开离场，然后电视“开机”：一震一闪，视频亮起并开始播放
// 光标绕圈是扁椭圆：横向约 ±140px，纵向约 ±70px（ORBIT_* 两个参数）
type SwarmSession = {
    readonly alive: boolean;
    gather(ms: number): Promise<void>;
    logoShow(o: () => { x: number; y: number; size: number }): void;
    logoDrag(getTo: () => { x: number; y: number; size: number }): Promise<void>;
    logoPaint(): Promise<void>;
    logoClick(): Promise<void>;
    pressLogo(): void;
    orbit(target: boolean | (() => { x: number; y: number })): void;
    tap(get: () => { x: number; y: number }): Promise<void>;
    build(o: { prepare: () => void; logo?: () => { x: number; y: number; size: number } }): Promise<void>;
    clickPlay(): Promise<void>;
    reveal(): void;
    relayout(): void;
    leave(): Promise<void>;
    close(): void;
};
type SwarmSessionOpts = {
    logo: { svg: string; color: string; glow?: string };
    crew?: number;
    builds?: number;
    orbitScale?: number;
    orbitSquash?: number;
    onAbort?: () => void;
};
type StartSession = (opts: SwarmSessionOpts) => SwarmSession | null;

declare global {
    interface Window {
        SwarmCursors?: { session?: StartSession };
    }
}

/** 等 swarm 脚本加载好；超时（或被 CSP 拦掉）就返回 null，走普通动画开场 */
function waitForSwarm(ms: number) {
    return new Promise<StartSession | null>((resolve) => {
        const t0 = performance.now();
        const tick = () => {
            const session = window.SwarmCursors?.session;
            if (session) return resolve(session);
            if (performance.now() - t0 > ms) return resolve(null);
            setTimeout(tick, 50);
        };
        tick();
    });
}

const SWARM_CREW = 9;         // 光标数量
const ORBIT_SCALE = 0.6;      // 绕圈大小
const ORBIT_SQUASH = 0.5;     // 绕圈压扁程度（纵向 / 横向）
const ORBIT_HALF_H = 80;      // 椭圆纵向半径 + 光标本身的高度，用来算 logo 要放多低才不挡字
const LOGO_INTRO_SIZE = 60;   // 开场时屏幕中间 logo 的大小（和原来的 favicon 开场一样）
const LOGO_PARKED_SIZE = 60;  // 停在句子下方时的大小（保持开场的大 logo；拖进方框前光标会先把它缩小）

// 开场等待点击时 logo 下方轮流显示的提示
const CLICK_PROMPTS = [
    {lang: "en", text: "Click the icon"},
    {lang: "zh-CN", text: "点击图标"},
    {lang: "ja", text: "アイコンをクリック"},
    {lang: "ko", text: "아이콘을 클릭하세요"},
    {lang: "fr", text: "Cliquez sur l’icône"},
    {lang: "de", text: "Klicke auf das Symbol"},
    {lang: "es", text: "Haz clic en el icono"},
    {lang: "ru", text: "Нажмите на значок"},
];
const PROMPT_STEP = 1.5; // 每种语言停留（秒）

// 第二轮里背景视频的替身：一块关着的 CRT 屏幕（深灰玻璃、圆角、四周压暗、左上角一点反光），
// 光标会把它当成一块媒体框画出来（所以“视频一开始是黑的”），开机那一闪时换成真正的字符视频
const TV_GLASS =
    "data:image/svg+xml," +
    encodeURIComponent(
        "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 90' preserveAspectRatio='none'>" +
        "<defs>" +
        "<radialGradient id='g' cx='50%' cy='46%' r='72%'>" +
        "<stop offset='0' stop-color='#1d2126'/><stop offset='.55' stop-color='#0d0f12'/><stop offset='1' stop-color='#030304'/>" +
        "</radialGradient>" +
        "<radialGradient id='s' cx='22%' cy='10%' r='45%'>" +
        "<stop offset='0' stop-color='#fff' stop-opacity='.07'/><stop offset='1' stop-color='#fff' stop-opacity='0'/>" +
        "</radialGradient>" +
        "</defs>" +
        "<rect width='160' height='90' fill='#000'/>" +
        "<rect x='1.4' y='1.8' width='157.2' height='86.4' rx='5' ry='7.5' fill='url(#g)'/>" +
        "<rect x='1.4' y='1.8' width='157.2' height='86.4' rx='5' ry='7.5' fill='url(#s)'/></svg>",
    );

/**
 * 关着的电视上的扫描线：先画一条，然后大家一起往下复制粘贴，每一步都是好几个光标同时在贴：
 *   1 条线 → 3 个光标各复制一条贴到下面（4 条一组）
 *   → 3 个光标各复制这一组贴到下面（16 条一块）
 *   → 剩下的光标一起把这一块贴满整个屏幕
 * 结构：同一层的兄弟节点一模一样（data-swarm-repeat），swarm 把第一个当母版、其余当副本，
 * 副本都只依赖母版，所以可以同时贴；下一层要等上一层的母版完整了才开始。
 */
const SCAN_FAN = 4; // 每一层：1 个母版 + 3 个副本

function ScanLines({blocks}: { blocks: number }) {
    const H = window.innerHeight;
    const lines = blocks * SCAN_FAN * SCAN_FAN;
    const lineH = Math.max(1, Math.round((H / lines) * 0.42));
    const slot = (i: number, n: number) => ({top: `${(i * 100) / n}%`, height: `${100 / n}%`});
    const rows = (render: (i: number) => React.ReactNode, n: number) => Array.from({length: n}, (_, i) => render(i));
    return (
        <div className="absolute inset-0">
            {rows((b) => (
                <div key={b} data-swarm-repeat="" className="absolute inset-x-0" style={slot(b, blocks)}>
                    {rows((q) => (
                        <div key={q} data-swarm-repeat="" className="absolute inset-x-0" style={slot(q, SCAN_FAN)}>
                            {rows((l) => (
                                <div key={l} className="tv-scanline absolute inset-x-0"
                                     style={{top: `${(l * 100) / SCAN_FAN}%`, height: lineH}}/>
                            ), SCAN_FAN)}
                        </div>
                    ), SCAN_FAN)}
                </div>
            ), blocks)}
        </div>
    );
}

// 按词拆“首字母/其余”，首字母连起来正好是 HIMICOS
type Split = { pre: string; first: string; post: string };
const splitWord = (w: string): Split => {
    const m = w.match(/[A-Za-z0-9]/);
    if (!m) return {pre: "", first: w.charAt(0), post: w.slice(1)};
    const i = m.index ?? 0;
    return {pre: w.slice(0, i), first: w[i], post: w.slice(i + 1)};
};
const splits = words.map(splitWord);

const LINKS = [
    {label: "X", href: "https://x.com/himicoswilson"},
    {label: "Github", href: "https://github.com/himicoswilson"},
];

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

const TITLE = splits.map((s) => s.first).join(""); // "HIMICOS"

/** 用页面字体在 100px 下实际排一次，返回文字宽度 */
function measureAt100(text: string) {
    const el = document.createElement("span");
    el.textContent = text;
    el.style.cssText = "position:absolute;visibility:hidden;white-space:pre;font-size:100px;font-weight:700;";
    document.body.appendChild(el);
    const width = el.getBoundingClientRect().width;
    el.remove();
    return width;
}

/** 按当前窗口算字号：整句一行放得下，HIMICOS 放大后不撑满屏幕 */
function computeSizes() {
    const W = window.innerWidth;
    const avail = W - (W >= 640 ? 160 : 32); // 减去 main 的左右 padding（p-4 / sm:p-20）
    return {
        // 整句必须一行放下（换行会在收拢时跳行），手机上会比较小
        small: clamp((avail * 0.94) / (measureAt100(sentence) / 100), 11, 40),
        // 手机上不撑满屏幕（太压迫），只占 65% 宽；桌面最大 120px
        big: clamp((avail * (W < 640 ? 0.65 : 0.9)) / (measureAt100(TITLE) / 100), 32, 120),
        kerns: splits.map(kernAfterFirst),
    };
}

/**
 * 首字母和后半截分成两个盒子后，字体里这两个字之间的字距调整（kerning）就没了，
 * 比如 “To” 本来挨得很紧，拆开后 “ouch” 会往右挪一点。量出这个差值（em），
 * 加回到后半截的 margin-left 上，拆字版就和整词版逐像素对齐（swarm 交接时不会抽一下）。
 */
function kernAfterFirst({first, post}: Split) {
    if (!post) return 0;
    return (measureAt100(first + post) - measureAt100(first) - measureAt100(post)) / 100;
}

/** 内容块里各元素的统一入场：上浮 + 去模糊（swarm 开场时直接是最终状态，由光标画出来） */
const fadeUp = (delay: number, animated = true) => ({
    initial: animated ? {opacity: 0, y: 8, filter: "blur(6px)"} : false,
    animate: {opacity: 1, y: 0, filter: "blur(0px)"},
    transition: {duration: 0.7, ease: EASE_OUT, delay} satisfies Transition,
});

// ---------------- 小组件 ----------------

/** 非首字母部分：宽度收为 0，首字母自然向中间滑拢 */
function Rest({text, idx, collapsed, animated, kern = 0}: {
    text: string; idx: number; collapsed: boolean; animated: boolean; kern?: number;
}) {
    if (!text) return null;
    return (
        <motion.span
            className="inline-block overflow-hidden whitespace-nowrap align-bottom title-ink"
            initial={animated ? {opacity: 0, y: 24, filter: "blur(10px)"} : false}
            // kern：把首字母和后半截之间的字距调整补回来（见 kernAfterFirst），收拢时一起归零
            animate={collapsed
                ? {opacity: 0, y: -6, filter: "blur(6px)", width: 0, marginLeft: "0em"}
                : {opacity: 1, y: 0, filter: "blur(0px)", width: "auto", marginLeft: `${kern}em`}}
            transition={collapsed
                ? {duration: COLLAPSE_DUR, ease: EASE_IN_OUT, delay: idx * COLLAPSE_STAGGER}
                : {duration: IN_DUR, ease: EASE_OUT, delay: idx * IN_STAGGER}}
        >
            {text}
        </motion.span>
    );
}

/**
 * 第一轮 swarm 拍快照用的整句：每个词是一整段文字，光标按词来敲（而不是 “U” + “plift” 分开敲）。
 * 排版和下面拆成首字母的版本一致，点下 Play 的那一刻无缝换成拆字版再开始收拢。
 */
const WordsLine = ({fontSize}: { fontSize: number }) => (
    <div className="relative flex flex-wrap justify-center items-end font-bold" style={{fontSize}}>
        {words.map((w, idx) => (
            <span key={idx} className="inline-flex items-end leading-[1.25]">
                {idx > 0 && <span className="inline-block" style={{width: "0.3em"}}/>}
                <span className="inline-block whitespace-nowrap title-ink">{w}</span>
            </span>
        ))}
    </div>
);

// 像素蝴蝶 logo：按 Pixilart 社区的一只像素蝴蝶重画的 49×49 网格，单色
// 参考：https://www.pixilart.com/art/butterfly-c60cb0eebc1606e
const BUTTERFLY_GRID = [
    "..............####.............####..............",
    "..............####.............####..............",
    "................#####.......#####................",
    "................#####.......#####................",
    "...................##.......##...................",
    "...................##.......##...................",
    ".######............##.......##............######.",
    ".##########........####...####........##########.",
    ".##########........####...####........##########.",
    ".#############.......##...##.......#############.",
    ".#############.......##...##.......#############.",
    "################.....##...##.....################",
    "################.....##...##.....################",
    "##################...##...##...##################",
    "##################...##...##...##################",
    "#################################################",
    "#################################################",
    ".###############################################.",
    ".###############################################.",
    ".###############################################.",
    ".###############################################.",
    ".###############################################.",
    ".###############################################.",
    ".###############################################.",
    "...###########################################...",
    "...###########################################...",
    "...###########################################...",
    "...###########################################...",
    "...###########################################...",
    "...###########################################...",
    ".....#######################################.....",
    ".....#######################################.....",
    "..........#############################..........",
    "..........#############################..........",
    ".........###############################.........",
    ".........###############################.........",
    ".........###############################.........",
    ".........###############################.........",
    ".........###############################.........",
    ".........###############################.........",
    ".........###############################.........",
    ".........###############################.........",
    ".........###############################.........",
    "..........#############...#############..........",
    "..........#############...#############..........",
    "............#########.......#########............",
    "............#########.......#########............",
    "..............#######.......#######..............",
    "..............#######.......#######..............",
];
// 横向拉宽 10%：像素格子从正方形拉成宽矩形
const BUTTERFLY_WIDE = 1.1;
const BUTTERFLY_CELL_X = 123 / BUTTERFLY_GRID.length;
const BUTTERFLY_CELL_Y = BUTTERFLY_CELL_X / BUTTERFLY_WIDE;
const BUTTERFLY_Y_OFF = (123 - BUTTERFLY_GRID.length * BUTTERFLY_CELL_Y) / 2;
// 横向合并连续格子，减少 rect 数量
const BUTTERFLY_RUNS: { x: number; y: number; w: number }[] = [];
BUTTERFLY_GRID.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
        if (row[x] === "#") {
            const x0 = x;
            while (x < row.length && row[x] === "#") x++;
            BUTTERFLY_RUNS.push({x: x0 * BUTTERFLY_CELL_X, y: y * BUTTERFLY_CELL_Y + BUTTERFLY_Y_OFF, w: (x - x0) * BUTTERFLY_CELL_X});
        } else {
            x++;
        }
    }
});
const BUTTERFLY_PIXEL_SVG = BUTTERFLY_RUNS.map(
    (r) => `<rect x="${r.x.toFixed(2)}" y="${r.y.toFixed(2)}" width="${r.w.toFixed(2)}" height="${BUTTERFLY_CELL_Y.toFixed(2)}"/>`
).join("");
// swarm 里被光标拖来拖去、上色的那个 logo：和下面的 <Logo/> 同形同色同光晕，最后无缝换成真的
const LOGO_SWARM = {
    svg: `<svg viewBox="0 0 123 123" fill="currentColor" shape-rendering="crispEdges">${BUTTERFLY_PIXEL_SVG}</svg>`,
    color: "#ceff1c",
    glow: "drop-shadow(0 0 12px rgba(206,255,28,0.45))",
};

/**
 * 开场提示：logo 下方一行小字，多国语言轮流“点击图标”，切换时去模糊 + 轻微上浮。
 * 位置在光标绕圈的椭圆之下，不会被挡住。
 */
function ClickPrompt() {
    const [i, setI] = useState(0);
    useEffect(() => {
        const t = setInterval(() => setI((k) => (k + 1) % CLICK_PROMPTS.length), PROMPT_STEP * 1000);
        return () => clearInterval(t);
    }, []);
    const p = CLICK_PROMPTS[i];
    return (
        <motion.div
            className="pointer-events-none fixed inset-x-0 z-20 flex flex-col items-center"
            style={{top: `calc(50% + ${LOGO_INTRO_SIZE / 2 + ORBIT_HALF_H + 10}px)`}}
            initial={{opacity: 0, y: 10, filter: "blur(8px)"}}
            animate={{opacity: 1, y: 0, filter: "blur(0px)", transition: {duration: 0.8, ease: EASE_OUT, delay: 0.6}}}
            exit={{opacity: 0, y: 6, filter: "blur(10px)", transition: {duration: 0.45, ease: EASE_IN_OUT}}}
            aria-live="polite"
        >
            {/* 一个小小的上指箭头，轻轻上下浮动，指向 logo */}
            <motion.span
                className="block h-2 w-2 rotate-45 border-l border-t border-accent/70"
                animate={{y: [0, -4, 0]}}
                transition={{duration: 1.6, ease: "easeInOut", repeat: Infinity}}
                aria-hidden="true"
            />
            <div className="mt-3 grid place-items-center">
                <AnimatePresence initial={false}>
                    <motion.p
                        key={p.lang}
                        lang={p.lang}
                        className="[grid-area:1/1] whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.28em] text-white/55"
                        initial={{opacity: 0, y: 8, filter: "blur(6px)"}}
                        animate={{opacity: 1, y: 0, filter: "blur(0px)", transition: {duration: 0.5, ease: EASE_OUT}}}
                        exit={{opacity: 0, y: -6, filter: "blur(6px)", transition: {duration: 0.3, ease: EASE_IN_OUT}}}
                    >
                        {p.text}
                    </motion.p>
                </AnimatePresence>
            </div>
        </motion.div>
    );
}

const Logo = () => (
    <svg viewBox="0 0 123 123" aria-hidden="true" fill="currentColor" shapeRendering="crispEdges"
         className="w-8 h-8 md:w-10 md:h-10 text-accent drop-shadow-[0_0_12px_rgba(206,255,28,0.45)]">
        {BUTTERFLY_RUNS.map((r, i) => (
            <rect key={i} x={r.x} y={r.y} width={r.w} height={BUTTERFLY_CELL_Y} />
        ))}
    </svg>
);

/** 大标题右上角弹出的 Himi~：弹性冒出 → 轻微晃动 → 下沉模糊消失（整体向右下倾斜） */
const Himi = ({delay = HIMI_DELAY}: { delay?: number }) => (
    // 外层负责定位（字号用 em，跟随标题一起放大），内层负责动画
    <span
        className="pointer-events-none absolute right-0 top-0 translate-x-[40%] -translate-y-[60%]"
        style={{fontSize: "0.42em"}}
        aria-hidden="true"
    >
        <motion.span
            className="block whitespace-nowrap font-bold text-accent drop-shadow-[0_0_12px_rgba(206,255,28,0.55)]"
            initial={{opacity: 0, scale: 0, rotate: 24, y: -8}}
            animate={{
                opacity: [0, 1, 1, 1, 0],
                scale: [0, 1.18, 0.95, 1, 0.85],
                rotate: [24, 6, 12, 9, 14],
                y: [-8, 0, 0, 0, 12],
                filter: ["blur(4px)", "blur(0px)", "blur(0px)", "blur(0px)", "blur(4px)"],
            }}
            transition={{duration: HIMI_DUR, delay, times: [0, 0.18, 0.3, 0.76, 1], ease: "easeOut"}}
        >
            Himi~
        </motion.span>
    </span>
);

const ArrowIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"
         className="w-3 h-3 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5">
        <path d="M7 17L17 7M17 7H7M17 7V17" stroke="currentColor" strokeWidth={3}/>
    </svg>
);

/** 方框四角的强调色角标 */
const CORNERS = [
    {cls: "-top-1 -left-1 border-t border-l", from: {x: 8, y: 8}},
    {cls: "-top-1 -right-1 border-t border-r", from: {x: -8, y: 8}},
    {cls: "-bottom-1 -left-1 border-b border-l", from: {x: 8, y: -8}},
    {cls: "-bottom-1 -right-1 border-b border-r", from: {x: -8, y: -8}},
];

// ---------------- 页面 ----------------

export default function Home() {
    const [phase, setPhase] = useState<Phase>("wait");
    const [sizes, setSizes] = useState<{ small: number; big: number; kerns: number[] } | null>(null);
    // null = 还没决定；true = swarm 开场（元素都是静态的，由光标画出来）；false = 普通动画开场
    const [swarm, setSwarm] = useState<boolean | null>(null);
    const [wordsOnly, setWordsOnly] = useState(false); // 第一轮快照：整句按整词排
    const [cardShown, setCardShown] = useState(false); // 方框（标题以外的部分）是否可见
    const [standIn, setStandIn] = useState(false);     // 第二轮快照：背景视频的黑屏替身
    const [tvOn, setTvOn] = useState(false);           // 全部完成后：电视开机，视频亮起并播放
    const [himi, setHimi] = useState(false);             // swarm：光标拍了 HIMICOS 一下 → Himi~
    const [prompt, setPrompt] = useState(false);       // swarm：开场等待点击 logo 的多国语言提示
    const logoRef = useRef<HTMLDivElement>(null);      // 方框里的真 logo（swarm 把 logo 拖到这里）
    const titleRef = useRef<HTMLDivElement>(null);     // 收拢/放大中的标题（光标去拍它）
    const cardRef = useRef<HTMLDivElement>(null);      // 方框（第二阶段光标在它下方转圈）

    useEffect(() => {
        let cancelled = false;
        let aborted = false;
        const timers: ReturnType<typeof setTimeout>[] = [];
        const at = (s: number, fn: () => void) => {
            timers.push(setTimeout(fn, s * 1000));
        };
        const wait = (s: number) => new Promise<void>((resolve) => at(s, resolve));
        // 每一步之后检查：被跳过（Esc / ✕）或组件卸载就停下
        const STOP = Symbol("stop");
        const step = async <T, >(p: Promise<T>) => {
            const v = await p;
            if (aborted || cancelled) throw STOP;
            return v;
        };

        // 等字体加载完，按真实字宽算字号，保证整句和 HIMICOS 在任何屏幕上都不换行
        // 自定义字体是按需加载的，显式 load 一次再量，避免量到回退字体
        const fontsReady = document.fonts
            ? document.fonts.load('700 100px "MyFont"', TITLE).then(() => document.fonts.ready)
            : Promise.resolve();
        // 窗口大小变了：重新算字号；swarm 正在重建的话，让它按新排版重新拍一次快照
        let sized = computeSizes();
        let session: SwarmSession | null = null;
        let onKey: ((e: KeyboardEvent) => void) | null = null;
        let resizeT: ReturnType<typeof setTimeout> | undefined;
        const onResize = () => {
            clearTimeout(resizeT);
            resizeT = setTimeout(() => {
                if (cancelled) return;
                sized = computeSizes();
                flushSync(() => setSizes(sized));
                session?.relayout();
            }, 120);
        };

        Promise.all([fontsReady.catch(() => undefined), waitForSwarm(4000)]).then(([, startSession]) => {
            if (cancelled) return;
            sized = computeSizes();
            setSizes(sized);
            window.addEventListener("resize", onResize);

            // 普通动画开场（swarm 脚本没加载到 / 被 CSP 拦截）
            const plain = () => {
                setSwarm(false);
                setCardShown(true);
                setPhase("in");
                TIMELINE.forEach(([p, t]) => at(t, () => setPhase(p)));
            };
            if (!startSession) return plain();

            // 按 Esc / ✕ 跳过：直接到最终画面
            const finish = () => {
                aborted = true;
                timers.forEach(clearTimeout);
                if (onKey) window.removeEventListener("keydown", onKey);
                setPrompt(false);
                setWordsOnly(false);
                setPhase("block");
                setCardShown(true);
                setStandIn(false);
                setTvOn(true);
            };

            const s = startSession({
                logo: LOGO_SWARM,
                crew: SWARM_CREW,
                builds: 2, // 第一段收尾停在“未完待续”的和弦上，第二段才落到完整的大和弦
                orbitScale: ORBIT_SCALE,
                orbitSquash: ORBIT_SQUASH,
                onAbort: finish,
            });
            if (!s) return plain();
            session = s;
            setSwarm(true);

            // 下面这些位置都是函数，每帧按当前窗口 / 排版重新算，调整窗口时 logo 和光标会跟着走
            const center = () => ({x: window.innerWidth / 2, y: window.innerHeight / 2, size: LOGO_INTRO_SIZE});
            // logo 停在句子下方，低到光标绕着它转圈时碰不到之后放大的 HIMICOS（行高 1.25），
            // 又不压到底部的控制条（约 64px 高）
            const parked = () => {
                const H = window.innerHeight;
                return {
                    x: window.innerWidth / 2,
                    y: Math.min(H / 2 + sized.big * 0.625 + ORBIT_HALF_H + 14, H - ORBIT_HALF_H - 64),
                    size: LOGO_PARKED_SIZE,
                };
            };
            // 第二阶段没活干的光标绕着屏幕中间转：一圈套在方框外面的椭圆，不挡方框里的字
            const ring = () => {
                const r = cardRef.current?.getBoundingClientRect();
                const W = window.innerWidth;
                const H = window.innerHeight;
                if (!r) return {x: W / 2, y: H / 2};
                return {
                    x: r.left + r.width / 2,
                    y: r.top + r.height / 2,
                    rx: Math.min(r.width / 2 + 60, W / 2 - 16),
                    ry: Math.min(r.height / 2 + 48, H / 2 - 70),
                };
            };
            // 方框里真 logo 的位置和大小（方框隐藏时也已经排好版）
            const home = () => {
                const r = logoRef.current?.querySelector("svg")?.getBoundingClientRect();
                return r ? {x: r.left + r.width / 2, y: r.top + r.height / 2, size: r.width} : parked();
            };
            // 光标拍 HIMICOS 的位置：右半边、偏上（Himi~ 从右上角冒出来）
            const titleSpot = () => {
                const r = titleRef.current?.getBoundingClientRect();
                return r ? {x: r.right - r.width * 0.16, y: r.top + r.height * 0.45} : center();
            };

            const run = async () => {
                // 0. 黑屏中间一个灰色 logo，光标们飞进来围着它转；画布先透明，让页面上的提示文字露出来。
                //    等访客点击 logo（或按 Enter / 空格）
                s.orbit(true);
                s.reveal();
                s.logoShow(center);
                setPrompt(true);
                onKey = (e: KeyboardEvent) => {
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        s.pressLogo();
                    }
                };
                window.addEventListener("keydown", onKey);
                await step(s.logoClick());
                window.removeEventListener("keydown", onKey);
                setPrompt(false);
                await step(wait(0.9)); // 冲击波散开、光标重新聚拢

                // 1. 一个光标把 logo 拖到句子下方
                await step(s.logoDrag(parked));

                // 2. 光标把整句话一词一词画出来；画完围着 logo 转圈，一个光标去点 Play
                await step(s.build({
                    prepare: () => flushSync(() => {
                        setPhase("in");
                        setWordsOnly(true);
                    }),
                }));
                await step(s.clickPlay());

                // 3. 画布变透明，页面播放收拢动画：HIMICOS 放大 → 光标拍它一下弹出 Himi~ → 飞进方框位置
                s.reveal();
                flushSync(() => setWordsOnly(false));
                await step(wait(0.25));
                setPhase("collapse");
                await step(wait(TOTAL_COLLAPSE - 0.2));
                setPhase("title");
                await step(wait(GROW_DUR * 0.8));
                await step(s.tap(titleSpot));
                setHimi(true);
                await step(wait(HIMI_DUR + 0.1));
                setPhase("block");
                await step(wait(FLY_DUR + 0.15));
                // 卡顿时飞入动画可能还没走完：等标题每个字母都真正落定（没有残留的位移），再拍第二轮的快照，
                // 否则画布上保留的标题会停在半空中的位置
                for (let i = 0; i < 60; i++) {
                    const letters = [...document.querySelectorAll("main [data-swarm-keep] > span")];
                    if (letters.length && letters.every((e) => getComputedStyle(e).transform === "none")) break;
                    await step(wait(0.05));
                }

                // 4. 第二轮重建开始，底部进度条弹出。头两个 layer：一个光标把 logo 缩小、拖到方框里它的位置
                //    （其他光标一起摸着它端过去），再从上往下给它上色；logo 一放好大家就开工重建电视和方框，
                //    先干完的围着中间转，标题保持不动
                s.orbit(ring);
                await step(s.build({
                    prepare: () => flushSync(() => {
                        setCardShown(true);
                        setStandIn(true);
                    }),
                    logo: home,
                }));
                // 和第一段一样：建完才出现 Play，一个光标去按
                await step(s.clickPlay());

                // 6. 光标从两边散开离场，然后电视开机：一震一闪，视频亮起并开始播放
                await step(s.leave());
                await step(wait(0.2));
                s.close();
                flushSync(() => {
                    setStandIn(false);
                    setTvOn(true);
                });
            };
            run().catch((err) => {
                if (err !== STOP) console.error(err);
            });
        });
        return () => {
            cancelled = true;
            timers.forEach(clearTimeout);
            clearTimeout(resizeT);
            window.removeEventListener("resize", onResize);
            if (onKey) window.removeEventListener("keydown", onKey);
        };
    }, []);

    const animated = swarm === false;               // 普通开场：各元素自己做入场动画
    const collapsed = phase !== "wait" && phase !== "in";
    const tv = animated ? phase === "block" : tvOn; // 背景视频亮起 + 播放
    const decor = animated || tvOn;                 // 扫描线 / 亮带 / 颗粒 / 压暗：电视开了才有
    const fx = swarm === true && tvOn;              // 电视开机：整屏一震 + 闪

    return (
        <div className={`fixed inset-0 overflow-hidden overscroll-none touch-none select-none${fx ? " crt-jolt" : ""}`}>
            {/* 背景：字符视频，电视“开机”时开始“解码”扫描入场并播放（swarm 不拍它，用下面的黑屏替身） */}
            <div data-swarm-ignore="">
                <AsciiVideo src="/media/butterfly-720p.mp4" revealed={tv} playing={tv} className="fixed inset-0 z-0"/>
            </div>
            {/* 第二轮重建时的“关着的电视”：一块玻璃屏 + 一条条复制出来的扫描线；开机时撤掉 */}
            {standIn && (
                <div className="pointer-events-none fixed inset-0 z-0" aria-hidden="true">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={TV_GLASS} alt="" draggable={false} className="absolute inset-0 h-full w-full"/>
                    <ScanLines blocks={clamp(Math.round(window.innerHeight / (6 * SCAN_FAN * SCAN_FAN)), 3, SWARM_CREW)}/>
                </div>
            )}
            {decor && (
                <>
                    {/* 中心压暗，保证文字可读 */}
                    <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.35)_0%,rgba(0,0,0,0)_55%)]"/>
                    {/* CRT 扫描线 + 缓慢滚动的刷新亮带：只盖在背景上，不压住方框和文字 */}
                    <div className="scanlines pointer-events-none fixed inset-0 z-[1]"/>
                    <div className="crt-roll pointer-events-none fixed inset-x-0 top-0 z-[1] h-[18vh]"/>
                    {/* 全屏胶片颗粒 */}
                    <div className="grain pointer-events-none fixed inset-0 z-30 opacity-[0.06] mix-blend-overlay"/>
                </>
            )}
            {/* 显像管通电的亮线 + 闪烁 */}
            {fx && <div className="crt-flash pointer-events-none fixed inset-0 z-40" aria-hidden="true"/>}
            {/* 开场：多国语言轮流提示“点击图标” */}
            <AnimatePresence>{prompt && <ClickPrompt/>}</AnimatePresence>

            <main className="relative z-10 grid h-full place-items-center p-4 sm:p-20">
                {sizes && phase !== "wait" && (
                    <LayoutGroup>
                        {phase !== "block" ? (
                            wordsOnly ? (
                                /* 第一轮 swarm：整句由光标一词一词画出来 */
                                <WordsLine fontSize={sizes.small}/>
                            ) : (
                                /* 阶段 1~3：整句入场 → 非首字母收拢 → HIMICOS 放大 */
                                <div
                                    ref={titleRef}
                                    className={`relative flex flex-wrap justify-center items-end font-bold${himi && !animated ? " title-boop" : ""}`}
                                    style={{
                                        fontSize: phase === "title" ? sizes.big : sizes.small,
                                        transition: `font-size ${GROW_DUR}s cubic-bezier(${EASE_IN_OUT.join(",")})`,
                                    }}
                                >
                                    {splits.map(({pre, first, post}, idx) => (
                                        <span key={idx} className="inline-flex items-end leading-[1.25]">
                                            {idx > 0 && (
                                                <motion.span
                                                    className="inline-block"
                                                    initial={{width: "0.3em"}}
                                                    animate={{width: collapsed ? "0em" : "0.3em"}}
                                                    transition={{duration: COLLAPSE_DUR, ease: EASE_IN_OUT, delay: idx * COLLAPSE_STAGGER}}
                                                />
                                            )}
                                            <Rest text={pre} idx={idx} collapsed={collapsed} animated={animated}/>
                                            <motion.span
                                                layoutId={`initial-${idx}`}
                                                className="inline-block title-ink"
                                                initial={animated ? {opacity: 0, y: 24, filter: "blur(10px)"} : false}
                                                animate={{opacity: 1, y: 0, filter: "blur(0px)"}}
                                                transition={{duration: IN_DUR, ease: EASE_OUT, delay: idx * IN_STAGGER}}
                                            >
                                                {first}
                                            </motion.span>
                                            <Rest text={post} idx={idx} collapsed={collapsed} animated={animated} kern={sizes.kerns[idx]}/>
                                        </span>
                                    ))}
                                    {/* 普通开场：放大后自己冒出来；swarm 开场：光标拍了一下才冒 */}
                                    {phase === "title" && (animated ? <Himi/> : himi && <Himi delay={0}/>)}
                                </div>
                            )
                        ) : (
                            /* 阶段 4：大标题飞入方框位置；swarm 开场时方框先隐藏，第二轮由光标画出来 */
                            <div ref={cardRef} className="relative w-full max-w-[40rem]" style={cardShown ? undefined : {visibility: "hidden"}}>
                                {/* 玻璃底板：先横向展开成一条线，再纵向打开 */}
                                <motion.div
                                    className="absolute inset-0 overflow-hidden bg-black/70 backdrop-blur-xl ring-1 ring-white/10 shadow-[0_40px_120px_-30px_rgba(0,0,0,0.95)]"
                                    initial={animated ? {clipPath: "inset(50% 50% 50% 50%)"} : false}
                                    animate={{clipPath: ["inset(50% 50% 50% 50%)", "inset(50% 0% 50% 0%)", "inset(0% 0% 0% 0%)"]}}
                                    transition={{duration: 1.0, times: [0, 0.45, 1], ease: EASE_IN_OUT, delay: 0.1}}
                                >
                                    <div className="grain absolute inset-0 opacity-[0.08] mix-blend-overlay"/>
                                    <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_0%_0%,rgba(206,255,28,0.08),transparent_55%)]"/>
                                    <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent"/>
                                    <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent"/>
                                    {/* 一次性的光泽扫过（swarm 开场时在电视亮起的那一下） */}
                                    {(animated || tvOn) && (
                                        <motion.div
                                            className="absolute inset-y-0 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/[0.08] to-transparent"
                                            initial={{left: "-40%"}}
                                            animate={{left: "140%"}}
                                            transition={{duration: 1.3, ease: EASE_IN_OUT, delay: animated ? 1.0 : 0.35}}
                                        />
                                    )}
                                </motion.div>

                                {CORNERS.map(({cls, from}, i) => (
                                    <motion.span
                                        key={i}
                                        className={`absolute size-3 border-accent ${cls}`}
                                        initial={animated ? {opacity: 0, ...from} : false}
                                        animate={{opacity: 1, x: 0, y: 0}}
                                        transition={{duration: 0.6, ease: EASE_OUT, delay: 0.9}}
                                    />
                                ))}

                                <div className="relative flex flex-col md:flex-row gap-6 md:gap-8 p-6 md:p-8">
                                    {/* 左：Logo + 标题 + 副标题 */}
                                    <div className="flex flex-col flex-1">
                                        <div className="flex items-center gap-2">
                                            {/* swarm 开场时由光标拖过来、上色的就是它；第二轮快照不拍（画布上已经有那个 logo 了） */}
                                            <motion.div
                                                ref={logoRef}
                                                data-swarm-ignore=""
                                                initial={animated ? {opacity: 0, scale: 0.4, rotate: -180} : false}
                                                animate={{opacity: 1, scale: 1, rotate: 0}}
                                                transition={{type: "spring", stiffness: 140, damping: 16, delay: 0.85}}
                                                whileHover={{rotate: 90}}
                                            >
                                                <Logo/>
                                            </motion.div>
                                            {/* 标题：一直可见（方框隐藏时也是）；第二轮 swarm 里保留原样，不重画 */}
                                            <span
                                                data-swarm-keep=""
                                                className="inline-flex text-3xl md:text-4xl font-bold leading-[1.25] tracking-[0.02em]"
                                                style={{visibility: "visible"}}
                                            >
                                                {splits.map(({first}, idx) => (
                                                    <motion.span
                                                        key={idx}
                                                        layoutId={`initial-${idx}`}
                                                        className="inline-block title-ink"
                                                        transition={{layout: {duration: FLY_DUR, ease: EASE_IN_OUT}}}
                                                    >
                                                        {first}
                                                    </motion.span>
                                                ))}
                                            </span>
                                        </div>
                                        <motion.p
                                            className="mt-2 pl-10 md:pl-12 font-mono text-[11px] leading-relaxed tracking-wide text-white/50"
                                            {...fadeUp(1.0, animated)}
                                        >
                                            Small wings, long distances.
                                        </motion.p>
                                    </div>

                                    {/* 分隔线 */}
                                    <motion.div
                                        className="hidden md:block w-px self-stretch origin-top bg-gradient-to-b from-transparent via-white/20 to-transparent"
                                        initial={animated ? {scaleY: 0} : false}
                                        animate={{scaleY: 1}}
                                        transition={{duration: 0.8, ease: EASE_IN_OUT, delay: 0.95}}
                                    />

                                    {/* 右：链接 / 版权 */}
                                    <div className="flex flex-col md:items-end gap-1.5 md:min-w-[9rem]">
                                        {LINKS.map(({label, href}, i) => (
                                            <motion.a
                                                key={label}
                                                href={href}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="group relative inline-flex items-center gap-1.5 self-start md:self-end font-mono text-xs uppercase tracking-[0.18em] text-white/85 transition-colors hover:text-accent after:absolute after:left-0 after:-bottom-0.5 after:h-px after:w-full after:origin-right after:scale-x-0 after:bg-accent after:transition-transform after:duration-300 hover:after:origin-left hover:after:scale-x-100"
                                                {...fadeUp(1.1 + i * 0.08, animated)}
                                            >
                                                {label}
                                                <ArrowIcon/>
                                            </motion.a>
                                        ))}
                                        <div className="flex-1 min-h-3"/>
                                        <motion.p
                                            className="font-mono text-[10px] uppercase leading-relaxed tracking-[0.16em] text-white/35 md:text-right"
                                            {...fadeUp(1.3, animated)}
                                        >
                                            © BUTTERFLY@HIMICOS.COM
                                        </motion.p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </LayoutGroup>
                )}
            </main>
            {/* Swarm 光标（基于 Joel Califa 的 Swarm），只由上面的开场调用：不显示悬浮按钮、不绑快捷键 */}
            <Script src="/swarm-cursors.js" strategy="afterInteractive" data-trigger="none" data-hotkey=""/>
        </div>
    );
}
