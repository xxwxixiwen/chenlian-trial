/**
 * WXML → Vue 3 模板编译器（网页端运行时核心之一）
 *
 * 输入：小程序页面的 .wxml 源码
 * 输出：{ template: Vue 模板字符串, wxs: [{ name, code }] }
 *
 * 关键转换规则（与小程序语义对齐）：
 *   - {{ expr }}           → 自由变量改写为 wxd.xxx（wxd = 页面 data），成员访问改为可选链 ?.
 *                            这样 a.b.c 在 a 为空时渲染为空，而不是像普通 JS 一样抛错（小程序就是这样）
 *   - wx:for / wx:if        → v-for / v-if（同一节点上同时存在时外包 <template v-for>，保证先 for 后 if）
 *   - bindtap / catchtap    → @click="wxe($event,'handler',catch)"
 *   - bindinput 等组件事件   → @input="wxc($event,'handler',catch)"
 *   - data-*                → v-wxds="{...}"（保留原始类型，挂到 el.__wxds 供 e.currentTarget.dataset 使用）
 *   - style 中的 rpx         → calc(var(--rpx) * N)
 *   - <block>               → <template>
 *   - 内联 <wxs module="x"> → 抽出代码，页面渲染上下文里以 x 暴露
 */
(function (global) {
  'use strict';

  var VOID_TAGS = { input: 1, image: 1, icon: 1, progress: 1, br: 1, img: 1, hr: 1 };

  // ---------------- 1. 解析 ----------------
  function parse(src) {
    var root = { type: 'root', children: [] };
    var stack = [root];
    var wxs = [];
    var i = 0, n = src.length;

    function top() { return stack[stack.length - 1]; }

    while (i < n) {
      if (src.startsWith('<!--', i)) {
        var endC = src.indexOf('-->', i + 4);
        i = endC < 0 ? n : endC + 3;
        continue;
      }
      if (src.startsWith('</', i)) {
        var endT = src.indexOf('>', i);
        var closeName = src.slice(i + 2, endT < 0 ? n : endT).trim();
        i = endT < 0 ? n : endT + 1;
        for (var s = stack.length - 1; s > 0; s--) {
          if (stack[s].tag === closeName) { stack.length = s; break; }
        }
        continue;
      }
      if (src[i] === '<' && /[a-zA-Z]/.test(src[i + 1] || '')) {
        var j = i + 1;
        while (j < n && /[a-zA-Z0-9\-_:.]/.test(src[j])) j++;
        var tag = src.slice(i + 1, j);
        var attrs = [];
        var selfClose = false;
        while (j < n) {
          while (j < n && /\s/.test(src[j])) j++;
          if (src.startsWith('/>', j)) { selfClose = true; j += 2; break; }
          if (src[j] === '>') { j++; break; }
          var a0 = j;
          while (j < n && !/[\s=>]/.test(src[j]) && !src.startsWith('/>', j)) j++;
          var name = src.slice(a0, j);
          while (j < n && /\s/.test(src[j])) j++;
          var value = true;
          if (src[j] === '=') {
            j++;
            while (j < n && /\s/.test(src[j])) j++;
            var q = src[j];
            if (q === '"' || q === "'") {
              var endQ = src.indexOf(q, j + 1);
              if (endQ < 0) endQ = n;
              value = src.slice(j + 1, endQ);
              j = endQ + 1;
            } else {
              var v0 = j;
              while (j < n && !/[\s>]/.test(src[j])) j++;
              value = src.slice(v0, j);
            }
          }
          if (name) attrs.push({ name: name, value: value });
          else j++;
        }
        i = j;
        if (tag === 'wxs') {
          var endW = src.indexOf('</wxs>', i);
          var code = src.slice(i, endW < 0 ? n : endW);
          i = endW < 0 ? n : endW + 6;
          var mod = attrs.find(function (a) { return a.name === 'module'; });
          if (mod) wxs.push({ name: mod.value, code: code });
          continue;
        }
        var node = { type: 'el', tag: tag, attrs: attrs, children: [] };
        top().children.push(node);
        if (!selfClose && !VOID_TAGS[tag]) stack.push(node);
        continue;
      }
      // 文本：直到下一个标签，跳过 {{ }} 内部（里面可能有 < 比较运算）
      var t0 = i;
      while (i < n) {
        if (src.startsWith('{{', i)) {
          var endM = src.indexOf('}}', i + 2);
          i = endM < 0 ? n : endM + 2;
          continue;
        }
        if (src[i] === '<' && (src[i + 1] === '/' || src[i + 1] === '!' || /[a-zA-Z]/.test(src[i + 1] || ''))) break;
        i++;
      }
      var text = src.slice(t0, i);
      if (text) top().children.push({ type: 'text', text: text });
    }
    return { root: root, wxs: wxs };
  }

  // ---------------- 2. 表达式改写 ----------------
  var KEYWORDS = {
    'true': 1, 'false': 1, 'null': 1, 'undefined': 1, 'typeof': 1, 'instanceof': 1, 'in': 1,
    'new': 1, 'void': 1, 'NaN': 1, 'Infinity': 1, 'this': 1
  };
  var GLOBALS = {
    Math: 1, Number: 1, String: 1, Boolean: 1, Array: 1, Object: 1, JSON: 1, Date: 1,
    parseInt: 1, parseFloat: 1, isNaN: 1, isFinite: 1, encodeURIComponent: 1, decodeURIComponent: 1
  };

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function tokenizeExpr(src) {
    var toks = [];
    var i = 0, n = src.length;
    while (i < n) {
      var c = src[i];
      if (/\s/.test(c)) { toks.push({ t: 'ws', v: c }); i++; continue; }
      if (c === '"' || c === "'" || c === '`') {
        var j = i + 1;
        while (j < n && src[j] !== c) { if (src[j] === '\\') j++; j++; }
        toks.push({ t: 'str', v: src.slice(i, j + 1) });
        i = j + 1; continue;
      }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
        var m = /^(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/.exec(src.slice(i));
        toks.push({ t: 'num', v: m[0] });
        i += m[0].length; continue;
      }
      if (/[A-Za-z_$À-￿]/.test(c)) {
        var mm = /^[A-Za-z_$0-9À-￿]+/.exec(src.slice(i));
        toks.push({ t: 'id', v: mm[0] });
        i += mm[0].length; continue;
      }
      var p3 = src.substr(i, 3), p2 = src.substr(i, 2);
      if (p3 === '===' || p3 === '!==' || p3 === '...') { toks.push({ t: 'p', v: p3 }); i += 3; continue; }
      if (['==', '!=', '<=', '>=', '&&', '||', '?.', '??'].indexOf(p2) >= 0 && !(p2 === '?.' && /[0-9]/.test(src[i + 2] || ''))) {
        toks.push({ t: 'p', v: p2 }); i += 2; continue;
      }
      toks.push({ t: 'p', v: c }); i++;
    }
    return toks;
  }

  /**
   * 把小程序表达式改写成可在 Vue 渲染上下文执行的安全表达式
   * scope: 当前可见的局部名（wx:for 的 item/index、wxs 模块名）
   */
  function transformExpr(src, scope) {
    var toks = tokenizeExpr(src);
    var out = [];
    var brackets = [];          // 记录 { [ ( 的嵌套，用于识别对象字面量的 key
    var prevSig = null;         // 上一个非空白 token
    function nextSig(k) {
      for (var x = k + 1; x < toks.length; x++) if (toks[x].t !== 'ws') return toks[x];
      return null;
    }
    for (var k = 0; k < toks.length; k++) {
      var tk = toks[k];
      if (tk.t === 'ws') { out.push(tk.v); continue; }
      var v = tk.v;
      if (tk.t === 'id') {
        var afterDot = prevSig && prevSig.t === 'p' && (prevSig.v === '.' || prevSig.v === '?.');
        var nx = nextSig(k);
        var inObj = brackets[brackets.length - 1] === '{';
        var isKey = inObj && nx && nx.v === ':' && prevSig && (prevSig.v === '{' || prevSig.v === ',');
        if (!afterDot && !isKey && !has(KEYWORDS, v) && !has(GLOBALS, v) && !has(scope, v)) v = 'wxd.' + v;
      } else if (tk.t === 'p') {
        var memberable = prevSig && (prevSig.t === 'id' || prevSig.t === 'str' || prevSig.v === ')' || prevSig.v === ']');
        if (v === '.' && memberable) v = '?.';
        else if (v === '[' && memberable && !(prevSig.t === 'id' && has(KEYWORDS, prevSig.v))) { v = '?.['; brackets.push('['); }
        else if (v === '{' || v === '[' || v === '(') brackets.push(v);
        else if (v === '}' || v === ']' || v === ')') brackets.pop();
      }
      out.push(v);
      prevSig = tk;
    }
    return out.join('');
  }

  // 把 "a {{b}} c" 拆成片段
  function splitMustache(str) {
    var parts = [];
    var re = /\{\{([\s\S]*?)\}\}/g;
    var last = 0, m;
    while ((m = re.exec(str))) {
      if (m.index > last) parts.push({ lit: str.slice(last, m.index) });
      parts.push({ expr: m[1] });
      last = re.lastIndex;
    }
    if (last < str.length) parts.push({ lit: str.slice(last) });
    return parts;
  }

  function jsStr(s) { return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'"; }

  /** 属性值 → { dynamic, code }；单个 {{x}} 保留原类型，混合文本拼成字符串 */
  function attrValue(value, scope) {
    if (value === true) return { dynamic: false, code: '' };
    var parts = splitMustache(value);
    if (!parts.some(function (p) { return p.expr != null; })) return { dynamic: false, code: value };
    if (parts.length === 1) return { dynamic: true, code: '(' + transformExpr(parts[0].expr, scope) + ')' };
    return {
      dynamic: true,
      code: parts.map(function (p) {
        return p.expr != null ? 'wxu.s(' + transformExpr(p.expr, scope) + ')' : jsStr(p.lit);
      }).join(' + ')
    };
  }

  function escAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }
  function escText(s) { return String(s).replace(/&(?![a-zA-Z#0-9]+;)/g, '&amp;').replace(/</g, '&lt;'); }

  function rpxStatic(s) {
    return String(s).replace(/(-?\d*\.?\d+)rpx/g, function (_, num) { return 'calc(var(--rpx) * ' + num + ')'; });
  }

  // ---------------- 3. 生成 Vue 模板 ----------------
  // 小程序标签 → 渲染标签（view/text 用同名自定义元素，WXSS 的标签选择器可以直接命中）
  var TAG_MAP = {
    view: 'view', text: 'text', block: 'template', label: 'view', icon: 'wx-icon',
    image: 'wx-image', input: 'wx-input', textarea: 'wx-textarea', button: 'wx-button',
    picker: 'wx-picker', 'scroll-view': 'wx-scroll-view', navigator: 'wx-navigator',
    'switch': 'wx-switch', canvas: 'wx-canvas', 'web-view': 'wx-web-view', slider: 'wx-slider',
    'rich-text': 'wx-rich-text', swiper: 'view', 'swiper-item': 'view', form: 'view',
    'movable-area': 'view', 'movable-view': 'view', 'cover-view': 'view', 'cover-image': 'wx-image'
  };
  // 这些是 Vue 组件，事件走组件 emit；其余（view/text）走原生 DOM 事件
  var COMPONENT_EVENTS = {
    input: 1, change: 1, blur: 1, focus: 1, confirm: 1, scroll: 1, scrolltolower: 1, scrolltoupper: 1,
    columnchange: 1, cancel: 1, chooseavatar: 1, getuserinfo: 1, getphonenumber: 1, error: 1, load: 1,
    message: 1, linechange: 1, keyboardheightchange: 1, changing: 1, contact: 1, opensetting: 1
  };
  var DEFAULT_HOVER = { button: 'button-hover', navigator: 'navigator-hover' };

  function datasetKey(attrName) {
    // 小程序规则：data-foo-bar → fooBar；data-fooBar → foobar（属性名不区分大小写）
    return attrName.slice(5).toLowerCase().replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); });
  }

  function genChildren(children, scope) {
    var out = '';
    for (var i = 0; i < children.length; i++) out += genNode(children[i], scope);
    return out;
  }

  function genText(node, scope, inText) {
    var text = node.text;
    if (inText) {
      // <text> 里模板源码自身的「换行 + 缩进」只是排版，不应显示（数据里的 \n 仍保留）
      text = text.replace(/^\s*\n\s*/, '').replace(/\s*\n\s*$/, '').replace(/\s*\n\s*/g, ' ');
    }
    var parts = splitMustache(text);
    return parts.map(function (p) {
      if (p.expr != null) return '{{ wxu.s(' + transformExpr(p.expr, scope) + ') }}';
      return escText(p.lit);
    }).join('');
  }

  function genNode(node, scope, inText) {
    if (node.type === 'text') return genText(node, scope, inText);
    var tag = node.tag;
    var outTag = TAG_MAP[tag] || tag;
    var attrs = {};
    node.attrs.forEach(function (a) { attrs[a.name] = a.value; });

    // ---- wx:for ----
    var forExpr = attrs['wx:for'] != null ? attrs['wx:for'] : attrs['wx:for-items'];
    var localScope = scope;
    var forCode = '';
    if (forExpr != null) {
      var itemName = attrs['wx:for-item'] || 'item';
      var indexName = attrs['wx:for-index'] || 'index';
      var listCode = attrValue(forExpr, scope);
      var listJs = listCode.dynamic ? listCode.code : jsStr(listCode.code);
      localScope = Object.assign({}, scope);
      localScope[itemName] = 1;
      localScope[indexName] = 1;
      forCode = '(' + itemName + ', ' + indexName + ') in wxu.list(' + listJs + ')';
    }

    var parts = [];
    var ifDirective = '';
    if (attrs['wx:if'] != null) ifDirective = 'v-if="' + escAttr(attrValue(attrs['wx:if'], localScope).code || 'true') + '"';
    else if (attrs['wx:elif'] != null) ifDirective = 'v-else-if="' + escAttr(attrValue(attrs['wx:elif'], localScope).code || 'true') + '"';
    else if (attrs['wx:else'] != null) ifDirective = 'v-else';

    var dataset = [];
    var isComponent = outTag.indexOf('wx-') === 0;
    var hoverClass = attrs['hover-class'] != null ? attrs['hover-class'] : DEFAULT_HOVER[tag];

    node.attrs.forEach(function (a) {
      var name = a.name, value = a.value;
      if (/^wx:/.test(name)) return;
      if (name === 'hover-class' || name === 'hover-stop-propagation' || name === 'hover-start-time' || name === 'hover-stay-time') return;
      if (name === 'slot') return;

      var ev = /^(bind|catch|capture-bind|capture-catch|mut-bind):?(.+)$/.exec(name);
      if (ev) {
        var isCatch = ev[1].indexOf('catch') >= 0 ? 1 : 0;
        var evName = ev[2].toLowerCase();
        var handler = attrValue(value === true ? '' : value, localScope);
        var hcode = handler.dynamic ? handler.code : jsStr(handler.code);
        if (evName === 'tap') {
          parts.push('@click="' + escAttr('wxe($event, ' + hcode + ', ' + isCatch + ')') + '"');
        } else if (evName === 'longpress' || evName === 'longtap') {
          parts.push('v-wxlongpress="' + escAttr('[' + hcode + ', ' + isCatch + ', wxe]') + '"');
        } else if (evName === 'touchstart' || evName === 'touchmove' || evName === 'touchend' || evName === 'touchcancel') {
          parts.push('@' + evName + '="' + escAttr('wxe($event, ' + hcode + ', ' + isCatch + ')') + '"');
        } else if (isComponent && COMPONENT_EVENTS[evName]) {
          parts.push('@' + evName + '="' + escAttr('wxc($event, ' + hcode + ', ' + isCatch + ')') + '"');
        } else {
          parts.push('@' + evName + '="' + escAttr('wxe($event, ' + hcode + ', ' + isCatch + ')') + '"');
        }
        return;
      }

      if (/^data-/.test(name)) {
        var dv = attrValue(value === true ? '' : value, localScope);
        dataset.push(jsStr(datasetKey(name)) + ': ' + (dv.dynamic ? dv.code : jsStr(dv.code)));
        return;
      }

      if (name === 'hidden') {
        var hv = attrValue(value, localScope);
        parts.push('v-show="' + escAttr(hv.dynamic ? '!(' + hv.code + ')' : (value === true || value === 'true' ? 'false' : 'true')) + '"');
        return;
      }

      if (name === 'style') {
        var sv = attrValue(value === true ? '' : value, localScope);
        if (sv.dynamic) parts.push(':style="' + escAttr('wxu.rpx(' + sv.code + ')') + '"');
        else if (sv.code) parts.push('style="' + escAttr(rpxStatic(sv.code)) + '"');
        return;
      }

      var av = attrValue(value, localScope);
      // 组件的布尔开关属性（如 scroll-y / disabled / password）静态写法 → 传 true
      if (value === true) { parts.push(isComponent ? ':' + name + '="true"' : name); return; }
      if (av.dynamic) parts.push(':' + name + '="' + escAttr(av.code) + '"');
      else parts.push(name + '="' + escAttr(av.code) + '"');
    });

    if (dataset.length) parts.push('v-wxds="' + escAttr('{' + dataset.join(', ') + '}') + '"');
    if (hoverClass && hoverClass !== 'none' && outTag !== 'template') parts.push('v-wxhover="' + escAttr(jsStr(hoverClass)) + '"');
    if (outTag !== 'template' && !isComponent && TAG_MAP[tag] === undefined) {
      // 未知标签按 view 渲染，避免 Vue 把它当组件
      outTag = 'view';
      parts.push('data-wx-tag="' + escAttr(tag) + '"');
    }

    var childInText = inText || tag === 'text';
    var inner = node.children.map(function (c) { return genNode(c, localScope, childInText); }).join('');
    var attrStr = parts.length ? ' ' + parts.join(' ') : '';

    var el;
    if (forCode && ifDirective) {
      // 小程序同节点 wx:for + wx:if：先循环后判断（Vue 里 v-if 优先级更高，必须拆开）
      el = '<template v-for="' + escAttr(forCode) + '"><' + outTag + ' ' + ifDirective + attrStr + '>' + inner + '</' + outTag + '></template>';
    } else if (forCode) {
      el = '<' + outTag + ' v-for="' + escAttr(forCode) + '"' + attrStr + '>' + inner + '</' + outTag + '>';
    } else {
      el = '<' + outTag + (ifDirective ? ' ' + ifDirective : '') + attrStr + '>' + inner + '</' + outTag + '>';
    }
    return el;
  }

  function compile(src) {
    var parsed = parse(src || '');
    var scope = {};
    parsed.wxs.forEach(function (w) { scope[w.name] = 1; });
    var body = genChildren(parsed.root.children, scope);
    return { template: body, wxs: parsed.wxs };
  }

  global.WxmlCompiler = {
    compile: compile,
    parse: parse,
    transformExpr: transformExpr,
    rpxStatic: rpxStatic
  };
})(typeof window !== 'undefined' ? window : this);
