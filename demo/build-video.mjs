// Builds demo/out/mama-pos-daybook-demo.mp4 from the recorder's frames: real frame times, the Gemma reading part
// sped up (and labelled), captions burned in at the recorded step times, title and end cards. Usage: node demo/build-video.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const ffmpeg = createRequire("C:/Users/DELL/tools/testreel/package.json")("ffmpeg-static");
const OUT = "demo/out";
const frames = JSON.parse(readFileSync(`${OUT}/frames.json`, "utf8"));
const m = JSON.parse(readFileSync(`${OUT}/marks.json`, "utf8"));
const SPEED = 1, CARD = 4;   // names took ~5 s each in the recording, so real speed; title/end cards 4 s each

// Map recorded time -> output time (reading..names_done runs SPEED x faster), then shift by the title card.
const slow0 = m.reading, slow1 = m.names_done;
const map = (t) => CARD + (t <= slow0 ? t : t <= slow1 ? slow0 + (t - slow0) / SPEED : slow0 + (slow1 - slow0) / SPEED + (t - slow1));

// Concat list with each frame's real duration (frames only arrive when the screen changes).
const vis = frames.filter((f) => f.t >= 0);
let list = "";
for (let i = 0; i < vis.length; i++) {
  const t1 = i + 1 < vis.length ? vis[i + 1].t : m.end + 1.5;
  const d = Math.max(0.001, map(t1) - map(vis[i].t));
  list += `file '${process.cwd().replace(/\\/g, "/")}/${vis[i].f}'\nduration ${d.toFixed(3)}\n`;
}
list += `file '${process.cwd().replace(/\\/g, "/")}/${vis.at(-1).f}'\n`;
writeFileSync(`${OUT}/list.txt`, list);
const mainEnd = map(m.end + 1.5);

// Captions (ASS). Text from demo/captions.md, times from the recorded marks.
const ts = (s) => { const h = Math.floor(s / 3600), mi = Math.floor(s / 60) % 60, se = (s % 60).toFixed(2).padStart(5, "0"); return `${h}:${String(mi).padStart(2, "0")}:${se}`; };
const caps = [
  [0, CARD, "Title", "MAMA POS DAY-BOOK\\N{\\fs40}a day-book for a POS operator in Port Harcourt, Nigeria"],
  [map(m.start), map(m.paste), "Cap", "She gives customers cash for bank transfers. Her bank emails her an alert for each payment."],
  [map(m.paste), map(m.reading), "Cap", "She pastes the alert emails. Code reads the amount, time and kind of money.\\N(Her real alerts. Names redacted to NAME.)"],
  [map(m.reading), map(m.names_done) + 2.5, "Cap", "Gemma 3 1B, on this laptop's GPU, reads each customer's name. No internet needed."],
  ...(SPEED > 1 ? [[map(m.reading), map(m.names_done), "Tag", `sped up ${SPEED}x`]] : []),
  [map(m.jul), map(m.land), "Cap", "Her bank writes \"TRANSFER TO <customer>\" on money that came in.\\NKeyword rules found 0 of 3 names. Gemma: 3 of 3 in this run, 2 of 3 in an earlier test."],
  [map(m.land), map(m.day), "Cap", "A customer says \"I sent ₦10,000.\" Two payments of that amount came in that day,\\Nso the app asks for the name."],
  [map(m.day), mainEnd, "Cap", "End of day: money in, estimated charges, rows to check, and a text for WhatsApp."],
  [mainEnd, mainEnd + CARD, "Title", "{\\fs40}Gemma runs on a laptop: her phone gives no GPU.\\NThe rest of the app works on her phone.\\N\\N{\\fs34}github.com/dannwaneri/mama-pos-daybook"],
];
const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Segoe UI,38,&H00FFFFFF,&H00FFFFFF,&H00000000,&HC0201810,0,0,0,0,100,100,0,0,3,18,0,2,120,120,28,1
Style: Tag,Segoe UI,34,&H0000D7FF,&H00FFFFFF,&H00000000,&HC0201810,1,0,0,0,100,100,0,0,3,12,0,9,60,60,40,1
Style: Title,Segoe UI,72,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,0,0,5,120,120,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${caps.map(([a, b, st, tx]) => `Dialogue: 0,${ts(a)},${ts(b)},${st},,0,0,0,,${tx}`).join("\n")}
`;
writeFileSync(`${OUT}/captions.ass`, "\ufeff" + ass);

// Video: dark card, then the frames scaled to 1080 high and centred, then a dark card; captions on top.
const total = mainEnd + CARD;
const vf = [
  `[1:v]scale=-2:860:flags=lanczos,setsar=1,fps=25[app]`,
  `[0:v][app]overlay=x=(W-w)/2:y=14:enable='between(t,${CARD},${mainEnd.toFixed(3)})':eof_action=pass[v0]`,
  `[v0]subtitles=${OUT}/captions.ass[v]`,
].join(";");
execFileSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error",
  "-f", "lavfi", "-i", `color=c=0x101826:s=1920x1080:r=25:d=${total.toFixed(3)}`,
  "-f", "concat", "-safe", "0", "-itsoffset", String(CARD), "-i", `${OUT}/list.txt`,
  "-filter_complex", vf, "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "25", "-movflags", "+faststart",
  `${OUT}/mama-pos-daybook-demo.mp4`], { stdio: "inherit" });
console.log("built", `${OUT}/mama-pos-daybook-demo.mp4`, `${total.toFixed(1)} s`);
