/**
 * WXSS → 浏览器 CSS
 *
 *  1. @import "x.wxss"  → 内联（递归）
 *  2. 12rpx             → 按当前屏宽换算成 px（屏宽 = 750rpx；屏宽变化时整体重算）
 *  3. 选择器加作用域     → 每个页面的样式只作用于自己的容器 [data-mp-page="pages/x/x"]
 *                         `page` 选择器 → 页面容器本身（等价小程序的 page 根节点）
 *  4. @keyframes 改名    → 加页面后缀，避免不同页面同名动画互相覆盖
 *
 * 只做「块切分 + 选择器改写」，声明正文原样保留（见 parseBlocks 的说明）。
 */
(function (global) {
  'use strict';

  /**
   * unit 为数字（1rpx 对应的 px）时直接换算成 px：样式表必须这样做——
   * Chrome 的 CSSOM 在「含 var() 的简写属性 + 后面的单项覆盖」时会把其余单项序列化成空值
   * （例：padding: calc(var(--rpx)*36); padding-bottom: ... → padding-top: ;），导致样式丢失。
   * 不传 unit 时输出 calc(var(--rpx) * N)，只用于元素内联 style（不经过 CSSOM 序列化）。
   */
  function rpx(css, unit) {
    return css.replace(/(-?\d*\.?\d+)rpx\b/g, function (_, n) {
      if (typeof unit === 'number') return (Math.round(parseFloat(n) * unit * 1000) / 1000) + 'px';
      return 'calc(var(--rpx) * ' + n + ')';
    });
  }

  function dirname(p) { var i = p.lastIndexOf('/'); return i >= 0 ? p.slice(0, i) : ''; }
  function joinPath(base, rel) {
    var parts = (rel.charAt(0) === '/' ? rel.slice(1) : (base ? base + '/' : '') + rel).split('/');
    var out = [];
    parts.forEach(function (s) {
      if (!s || s === '.') return;
      if (s === '..') out.pop(); else out.push(s);
    });
    return out.join('/');
  }

  function inlineImports(css, filePath, readFile, seen) {
    seen = seen || {};
    return css.replace(/@import\s+(?:url\()?\s*['"]?([^'")\s;]+)['"]?\s*\)?\s*;/g, function (_, rel) {
      var p = joinPath(dirname(filePath), rel);
      if (!/\.wxss$/.test(p)) p += '.wxss';
      if (seen[p]) return '';
      seen[p] = 1;
      var sub = readFile(p);
      return sub == null ? '' : inlineImports(sub, p, readFile, seen);
    });
  }

  function renameKeyframes(css, suffix) {
    var names = [];
    css.replace(/@(?:-webkit-)?keyframes\s+([A-Za-z0-9_-]+)/g, function (_, n) { if (names.indexOf(n) < 0) names.push(n); });
    if (!names.length) return css;
    names.forEach(function (n) {
      var re = new RegExp('(@(?:-webkit-)?keyframes\\s+)' + n + '\\b', 'g');
      css = css.replace(re, '$1' + n + '__' + suffix);
      // animation / animation-name 声明里的引用
      var reUse = new RegExp('(animation(?:-name)?\\s*:[^;{}]*?)\\b' + n + '\\b', 'g');
      css = css.replace(reUse, '$1' + n + '__' + suffix);
    });
    return css;
  }

  function splitSelectors(sel) {
    var out = [], depth = 0, cur = '';
    for (var i = 0; i < sel.length; i++) {
      var c = sel[i];
      if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') depth--;
      if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  // 网页端渲染元素与小程序标签名不同的，把类型选择器映射过去
  var TAG_ALIAS = { button: '.wx-button', image: '.wx-image', navigator: '.wx-navigator' };

  function scopeSelector(sel, root) {
    var s = sel.replace(/(^|[\s>+~(])page(?=$|[\s.:#\[>+~,)])/g, function (_, pre) { return pre + root; });
    s = s.replace(/(^|[\s>+~(])(button|image|navigator)(?=$|[\s.:#\[>+~,)])/g, function (_, pre, tag) { return pre + TAG_ALIAS[tag]; });
    if (s.indexOf(root) === 0) return s;
    return root + ' ' + s;
  }

  /** 去掉 /* 注释 *\/（字符串里的不动） */
  function stripComments(css) {
    var out = '', i = 0, n = css.length, q = '';
    while (i < n) {
      var c = css[i];
      if (q) { out += c; if (c === '\\') { out += css[i + 1] || ''; i += 2; continue; } if (c === q) q = ''; i++; continue; }
      if (c === '"' || c === "'") { q = c; out += c; i++; continue; }
      if (c === '/' && css[i + 1] === '*') { var e = css.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
      out += c; i++;
    }
    return out;
  }

  /**
   * 极简 CSS 块解析：只切出「前缀 { 正文 }」，正文原样保留。
   * 不用浏览器 CSSOM 序列化——它在 var() 简写 + 单项覆盖时会丢值，也会丢掉不认识的属性。
   */
  function parseBlocks(css) {
    var blocks = [], i = 0, n = css.length;
    while (i < n) {
      while (i < n && /[\s}]/.test(css[i])) i++;
      if (i >= n) break;
      var start = i, q = '';
      while (i < n) {
        var c = css[i];
        if (q) { if (c === '\\') i++; else if (c === q) q = ''; i++; continue; }
        if (c === '"' || c === "'") { q = c; i++; continue; }
        if (c === '{' || c === ';') break;
        i++;
      }
      var prelude = css.slice(start, i).trim();
      if (i >= n) break;
      if (css[i] === ';') { if (prelude) blocks.push({ stmt: prelude + ';' }); i++; continue; }
      var depth = 1, bodyStart = ++i;
      q = '';
      while (i < n && depth > 0) {
        var ch = css[i];
        if (q) { if (ch === '\\') i++; else if (ch === q) q = ''; i++; continue; }
        if (ch === '"' || ch === "'") q = ch;
        else if (ch === '{') depth++;
        else if (ch === '}') depth--;
        i++;
      }
      blocks.push({ prelude: prelude, body: css.slice(bodyStart, i - 1) });
    }
    return blocks;
  }

  function rewriteBlocks(blocks, root) {
    return blocks.map(function (b) {
      if (b.stmt) return /^@(import|charset)/i.test(b.stmt) ? '' : b.stmt;
      var p = b.prelude;
      if (/^@(media|supports)/i.test(p)) return p + ' {\n' + rewriteBlocks(parseBlocks(b.body), root).join('\n') + '\n}';
      if (p.charAt(0) === '@') return p + ' {' + b.body + '}';   // @keyframes / @font-face 原样
      var sel = splitSelectors(p).map(function (x) { return scopeSelector(x, root); }).join(', ');
      return sel + ' {' + b.body + '}';
    });
  }

  /**
   * @param css       原始 WXSS 文本
   * @param opts.path      文件路径（解析相对 @import 用）
   * @param opts.readFile  function(path) → 文本 | null
   * @param opts.root      作用域根选择器
   * @param opts.suffix    keyframes 后缀
   */
  function process(css, opts) {
    var text = inlineImports(css || '', opts.path || '', opts.readFile || function () { return null; });
    text = rpx(text, opts.rpxUnit);
    if (opts.suffix) text = renameKeyframes(text, opts.suffix);
    return rewriteBlocks(parseBlocks(stripComments(text)), opts.root).join('\n');
  }

  global.Wxss = { process: process, rpx: rpx, joinPath: joinPath, dirname: dirname };
})(window);
