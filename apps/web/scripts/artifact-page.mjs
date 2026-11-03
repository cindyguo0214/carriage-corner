// 把 Vite 產出的完整 index.html 轉成 Artifact 頁面：Artifact 發布時會自行包上
// <!doctype html><html><head>…<body> 骨架，所以這裡只留下 <title>、<style>、資源標籤與 body 內容。
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist-artifact');
const html = readFileSync(join(dist, 'index.html'), 'utf8');

const head = html.match(/<head>([\s\S]*?)<\/head>/i)?.[1] ?? '';
const body = html.match(/<body>([\s\S]*?)<\/body>/i)?.[1] ?? '';
const pick = re => [...head.matchAll(re)].map(m => m[0]);

const title = pick(/<title>[\s\S]*?<\/title>/gi);
const styles = pick(/<style>[\s\S]*?<\/style>/gi);
const links = pick(/<link\b[^>]*rel="(?:stylesheet|modulepreload)"[^>]*>/gi);
const scripts = pick(/<script\b[^>]*type="module"[^>]*><\/script>/gi);

if (!title.length || !scripts.length) throw new Error('artifact-page: index.html 缺少 <title> 或入口 script');

const page = [...title, ...styles, ...links, body.trim(), ...scripts].join('\n');
writeFileSync(join(dist, 'page.html'), `${page}\n`);
console.log(`artifact-page: wrote dist-artifact/page.html (${page.length} chars)`);
