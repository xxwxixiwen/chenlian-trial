/**
 * 网页端运行时 · 核心
 *   - MP.sources  小程序源码读取（live：直接 fetch 仓库里的文件；bundle：读 dist/mp-bundle.js）
 *   - MP.storage  wx.*StorageSync 的 localStorage 实现
 *   - MP.modules  CommonJS 模块系统（require / module.exports）
 *   - MP.ui       全局浮层状态（toast / modal / actionSheet / picker / 预览图），由 shell 渲染
 */
(function (global) {
  'use strict';
  var MP = global.MP = global.MP || {};
  var Vue = global.Vue;

  // ---------------- 工具 ----------------
  function normPath(p) {
    var parts = String(p || '').replace(/^\/+/, '').split('/');
    var out = [];
    parts.forEach(function (s) {
      if (!s || s === '.') return;
      if (s === '..') out.pop(); else out.push(s);
    });
    return out.join('/');
  }
  function dirname(p) { var i = p.lastIndexOf('/'); return i >= 0 ? p.slice(0, i) : ''; }
  function resolvePath(from, rel) {
    if (rel.charAt(0) === '/') return normPath(rel);
    return normPath((dirname(from) ? dirname(from) + '/' : '') + rel);
  }

  /** setData / 存储使用的深拷贝：等价小程序的「序列化」语义（函数丢弃，Date 转字符串） */
  function cloneData(v) {
    if (v === null || typeof v !== 'object') return typeof v === 'function' ? undefined : v;
    if (v instanceof Date) return v.toISOString();
    if (Array.isArray(v)) return v.map(function (x) { var c = cloneData(x); return c === undefined ? null : c; });
    var raw = Vue ? Vue.toRaw(v) : v;
    var out = {};
    Object.keys(raw).forEach(function (k) {
      var c = cloneData(raw[k]);
      if (c !== undefined) out[k] = c;
    });
    return out;
  }

  /** 'a.b[0].c' → ['a','b',0,'c'] */
  function parsePath(path) {
    var keys = [];
    String(path).replace(/[^.[\]]+|\[(\d+)\]/g, function (m, idx) {
      keys.push(idx !== undefined ? Number(idx) : m);
    });
    return keys;
  }
  function setByPath(obj, path, value) {
    var keys = parsePath(path);
    var cur = obj;
    for (var i = 0; i < keys.length - 1; i++) {
      var k = keys[i];
      if (cur[k] === null || typeof cur[k] !== 'object') cur[k] = typeof keys[i + 1] === 'number' ? [] : {};
      cur = cur[k];
    }
    cur[keys[keys.length - 1]] = value;
  }

  function parseUrl(url) {
    url = String(url || '');
    var q = url.indexOf('?');
    var path = normPath(q >= 0 ? url.slice(0, q) : url);
    var query = {};
    if (q >= 0) {
      url.slice(q + 1).split('&').forEach(function (kv) {
        if (!kv) return;
        var e = kv.indexOf('=');
        // 与小程序一致：参数值不自动 decode（页面自己会 decodeURIComponent）
        if (e < 0) query[kv] = '';
        else query[kv.slice(0, e)] = kv.slice(e + 1);
      });
    }
    return { path: path, query: query };
  }

  MP.util = {
    normPath: normPath, dirname: dirname, resolvePath: resolvePath,
    cloneData: cloneData, parsePath: parsePath, setByPath: setByPath, parseUrl: parseUrl
  };

  // ---------------- 源码 ----------------
  var sources = MP.sources = {
    mode: '',
    base: '../',
    files: Object.create(null),
    assets: Object.create(null),
    get: function (p) { p = normPath(p); return this.files[p] != null ? this.files[p] : null; },
    has: function (p) { return this.files[normPath(p)] != null; },
    asset: function (p) {
      if (!p) return '';
      if (/^(data:|blob:|https?:|wxfile:)/.test(p)) return p;
      var k = normPath(p);
      if (this.assets[k]) return this.assets[k];
      return this.base + k;
    },
    json: function (p) {
      var t = this.get(p);
      if (t == null) return null;
      try { return JSON.parse(t); } catch (e) { console.warn('[web] JSON 解析失败', p, e); return null; }
    }
  };

  // 并发上限 + 网络错误重试：python3 -m http.server 的监听队列只有 5，一次发上百个请求会被拒连
  var MAX_CONCURRENT = 6;
  var active = 0;
  var waiting = [];
  function withSlot(task) {
    return new Promise(function (resolve) {
      function run() {
        active++;
        task().then(function (v) { active--; resolve(v); if (waiting.length) waiting.shift()(); });
      }
      if (active < MAX_CONCURRENT) run(); else waiting.push(run);
    });
  }
  function fetchText(url, attempt) {
    attempt = attempt || 0;
    return withSlot(function () {
      return fetch(url, { cache: 'no-store' })
        .then(function (r) { return { text: r.ok ? r.text() : null }; })    // 404 等：文件不存在，不重试
        .catch(function (e) { return { error: e }; });
    }).then(function (res) {
      if (!res.error) return res.text;
      if (attempt < 3) return new Promise(function (r) { setTimeout(r, 200 * (attempt + 1)); }).then(function () { return fetchText(url, attempt + 1); });
      console.warn('[web] 读取源码失败', url, res.error && res.error.message);
      return null;
    });
  }

  var REQUIRE_RE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  var IMPORT_RE = /@import\s+(?:url\()?\s*['"]?([^'")\s;]+)/g;

  function loadLive() {
    var base = sources.base;
    return fetchText(base + 'app.json').then(function (appJson) {
      if (appJson == null) return false;
      sources.files['app.json'] = appJson;
      var app = JSON.parse(appJson);
      var wanted = ['app.js', 'app.wxss', 'project.config.json'];
      (app.pages || []).forEach(function (p) {
        ['.js', '.json', '.wxml', '.wxss'].forEach(function (ext) { wanted.push(p + ext); });
      });
      var seen = {};
      function loadBatch(list) {
        list = list.filter(function (p) { if (seen[p]) return false; seen[p] = 1; return true; });
        if (!list.length) return Promise.resolve();
        return Promise.all(list.map(function (p) {
          return fetchText(base + p).then(function (t) { if (t != null) sources.files[p] = t; return { p: p, t: t }; });
        })).then(function (res) {
          var next = [];
          res.forEach(function (r) {
            if (r.t == null) return;
            var m;
            if (/\.js$/.test(r.p)) {
              REQUIRE_RE.lastIndex = 0;
              while ((m = REQUIRE_RE.exec(r.t))) {
                var rp = resolvePath(r.p, m[1]);
                if (!/\.js$/.test(rp)) rp += '.js';
                next.push(rp);
              }
            } else if (/\.wxss$/.test(r.p)) {
              IMPORT_RE.lastIndex = 0;
              while ((m = IMPORT_RE.exec(r.t))) {
                var ip = resolvePath(r.p, m[1]);
                if (!/\.wxss$/.test(ip)) ip += '.wxss';
                next.push(ip);
              }
            }
          });
          return loadBatch(next);
        });
      }
      return loadBatch(wanted).then(function () { return true; });
    });
  }

  sources.init = function () {
    var forceBundle = true;
    var bundle = global.__MP_BUNDLE__;
    function useBundle() {
      if (!bundle) return false;
      sources.mode = 'bundle';
      Object.keys(bundle.files).forEach(function (k) { sources.files[k] = bundle.files[k]; });
      Object.keys(bundle.assets || {}).forEach(function (k) { sources.assets[k] = bundle.assets[k]; });
      sources.builtAt = bundle.builtAt || '';
      return true;
    }
    if (forceBundle || location.protocol === 'file:') return Promise.resolve(useBundle());
    return loadLive().then(function (ok) {
      if (ok) { sources.mode = 'live'; return true; }
      console.warn('[web] 实时模式不可用（读不到 ../app.json），改用打包模式');
      return useBundle();
    });
  };

  // ---------------- 本地存储（wx.*StorageSync） ----------------
  var PREFIX = 'chenlian-mp:';
  var storage = MP.storage = {
    prefix: PREFIX,
    version: Vue ? Vue.ref(0) : { value: 0 },   // 每次写入 +1，供 shell 的数据面板刷新
    get: function (key) {
      var raw = null;
      try { raw = localStorage.getItem(PREFIX + key); } catch (e) {}
      if (raw == null) return '';
      try { return JSON.parse(raw); } catch (e) { return ''; }
    },
    set: function (key, value) {
      var text = JSON.stringify(cloneData(value === undefined ? null : value));
      try {
        localStorage.setItem(PREFIX + key, text);
      } catch (e) {
        throw new Error('setStorageSync:fail exceed storage max size（浏览器 localStorage 已满）');
      }
      this.version.value++;
    },
    remove: function (key) {
      try { localStorage.removeItem(PREFIX + key); } catch (e) {}
      this.version.value++;
    },
    keys: function () {
      var out = [];
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.indexOf(PREFIX) === 0) out.push(k.slice(PREFIX.length));
        }
      } catch (e) {}
      return out.sort();
    },
    clear: function () {
      this.keys().forEach(function (k) { try { localStorage.removeItem(PREFIX + k); } catch (e) {} });
      this.version.value++;
    },
    sizeKB: function () {
      var n = 0;
      this.keys().forEach(function (k) { n += (localStorage.getItem(PREFIX + k) || '').length; });
      return Math.ceil(n * 2 / 1024);
    },
    snapshot: function () {
      var out = {};
      this.keys().forEach(function (k) { out[k] = storage.get(k); });
      return out;
    }
  };

  // ---------------- 模块系统 ----------------
  var modules = MP.modules = {
    cache: Object.create(null),
    globals: null,   // { wx, App, Page, getApp, getCurrentPages, Component, Behavior }
    beforeExec: null,
    require: function (path) {
      path = normPath(path);
      if (!/\.js$/.test(path) && !sources.has(path)) path += '.js';
      var cached = this.cache[path];
      if (cached) return cached.exports;
      var code = sources.get(path);
      if (code == null) throw new Error('module "' + path + '" is not defined');
      var module = { exports: {}, id: path };
      this.cache[path] = module;
      var g = this.globals;
      var localRequire = function (rel) { return modules.require(resolvePath(path, rel)); };
      if (this.beforeExec) this.beforeExec(path);
      try {
        var fn = new Function(
          'require', 'module', 'exports', 'wx', 'App', 'Page', 'getApp', 'getCurrentPages', 'Component', 'Behavior',
          '"use strict";\n' + code + '\n//# sourceURL=mp:///' + path
        );
        fn.call(undefined, localRequire, module, module.exports, g.wx, g.App, g.Page, g.getApp, g.getCurrentPages, g.Component, g.Behavior);
      } catch (e) {
        delete this.cache[path];
        throw e;
      }
      return module.exports;
    }
  };

  // ---------------- 浮层状态 ----------------
  MP.ui = Vue.reactive({
    toast: null,
    loading: null,
    modal: null,
    actionSheet: null,
    picker: null,
    preview: null,
    errors: [],
    drawer: false
  });

  /** 运行时错误：控制台 + 屏幕顶部红条 + App.onError（与小程序一致） */
  MP.reportError = function (err, where) {
    var msg = (err && (err.stack || err.message)) || String(err);
    console.error('[小程序运行时错误]' + (where ? ' ' + where : ''), err);
    MP.ui.errors.unshift({ id: Date.now() + Math.random(), where: where || '', msg: String((err && err.message) || err) });
    if (MP.ui.errors.length > 20) MP.ui.errors.length = 20;
    try {
      var app = MP.appInstance;
      if (app && typeof app.onError === 'function') app.onError(msg);
    } catch (e) {}
  };

  /** 简易 EventChannel（wx.navigateTo 的 events / getOpenerEventChannel） */
  function EventChannel() { this._l = {}; this._q = {}; }
  EventChannel.prototype.on = function (name, fn) { (this._l[name] = this._l[name] || []).push(fn); (this._q[name] || []).forEach(function (a) { fn.apply(null, a); }); };
  EventChannel.prototype.once = function (name, fn) { var self = this; var w = function () { self.off(name, w); fn.apply(null, arguments); }; this.on(name, w); };
  EventChannel.prototype.off = function (name, fn) { this._l[name] = (this._l[name] || []).filter(function (x) { return fn && x !== fn; }); };
  EventChannel.prototype.emit = function (name) {
    var args = Array.prototype.slice.call(arguments, 1);
    var ls = this._l[name] || [];
    if (!ls.length) (this._q[name] = this._q[name] || []).push(args);
    ls.forEach(function (fn) { fn.apply(null, args); });
  };
  MP.EventChannel = EventChannel;
})(window);
