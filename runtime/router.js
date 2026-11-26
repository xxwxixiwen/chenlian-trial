/**
 * 网页端运行时 · App / Page / 路由
 *
 * 页面栈语义与小程序一致：
 *   navigateTo  入栈（上一页 onHide）        redirectTo 替换栈顶（onUnload）
 *   navigateBack 出栈（onUnload，新栈顶 onShow）
 *   switchTab   关闭所有非 tab 页，tab 页实例常驻（首次 onLoad，之后只 onShow/onHide）
 *   reLaunch    关闭全部页面（含 tab 页）后打开
 */
(function (global) {
  'use strict';
  var MP = global.MP;
  var Vue = global.Vue;
  var util = MP.util;
  var sources = MP.sources;

  var router = MP.router = {
    stack: Vue.shallowReactive([]),     // 当前页面栈
    alive: Vue.shallowReactive([]),     // 需要渲染（保活）的全部页面实例：栈 + 后台 tab 页
    tabInstances: {},                   // route → tab 页实例
    leaving: Vue.shallowReactive([]),   // 正在播放退场动画的页面
    appConfig: null,
    tabRoutes: [],
    pageDefs: {},
    pageComponents: {},
    styledRoutes: {},
    loadingRoute: '',
    uid: 0
  };

  router.isTab = function (route) { return router.tabRoutes.indexOf(route) >= 0; };
  router.top = function () { return router.stack[router.stack.length - 1] || null; };

  // ---------------- App() ----------------
  MP.App = function (def) {
    var app = Object.assign({}, def);
    app.globalData = util.cloneData(def.globalData || {});
    MP.appInstance = app;
  };
  MP.getApp = function () { return MP.appInstance; };
  MP.getCurrentPages = function () { return router.stack.slice(); };

  // ---------------- Page() ----------------
  MP.Page = function (def) {
    var route = router.loadingRoute;
    if (!route) { console.warn('[web] Page() 在非页面文件中调用，已忽略'); return; }
    router.pageDefs[route] = def || {};
  };
  MP.Component = function () { console.warn('[web] 网页端暂不支持自定义组件 Component()'); };
  MP.Behavior = function (b) { return b; };

  function loadPageDef(route) {
    if (router.pageDefs[route]) return router.pageDefs[route];
    var path = route + '.js';
    if (!sources.has(path)) throw new Error('页面不存在：' + route);
    router.loadingRoute = route;
    try {
      MP.modules.require(path);
    } finally {
      router.loadingRoute = '';
    }
    if (!router.pageDefs[route]) router.pageDefs[route] = {};
    return router.pageDefs[route];
  }

  function pageConfig(route) {
    var win = (router.appConfig && router.appConfig.window) || {};
    var own = sources.json(route + '.json') || {};
    return Object.assign({
      navigationBarTitleText: '',
      navigationBarBackgroundColor: '#000000',
      navigationBarTextStyle: 'white',
      navigationStyle: 'default',
      backgroundColor: '#ffffff'
    }, win, own);
  }

  // 已注入的样式登记：屏幕宽度变化时（手机横竖屏 / 窗口缩放）按新的 rpx 重新生成
  var styleRegistry = {};
  MP.rpxUnit = 390 / 750;
  MP.setScreenWidth = function (w) {
    var unit = w / 750;
    if (Math.abs(unit - MP.rpxUnit) < 0.0001) return;
    MP.rpxUnit = unit;
    Object.keys(styleRegistry).forEach(function (id) {
      var r = styleRegistry[id];
      injectStyle(id, MP.processWxss(r.css, r.path, r.root, r.suffix));
    });
  };

  function injectStyle(id, css) {
    var el = document.getElementById(id);
    if (!el) {
      el = document.createElement('style');
      el.id = id;
      document.head.appendChild(el);
    }
    el.textContent = css;
  }

  function registerStyle(id, css, path, root, suffix) {
    styleRegistry[id] = { css: css, path: path, root: root, suffix: suffix };
    injectStyle(id, MP.processWxss(css, path, root, suffix));
  }

  MP.injectAppStyle = function () {
    registerStyle('mp-style-app', sources.get('app.wxss') || '', 'app.wxss', '.mp-page', 'app');
  };
  MP.processWxss = function (css, path, root, suffix) {
    try {
      return global.Wxss.process(css, {
        path: path, root: root, suffix: suffix, rpxUnit: MP.rpxUnit,
        readFile: function (p) { return sources.get(p); }
      });
    } catch (e) {
      MP.reportError(e, 'WXSS ' + path);
      return '';
    }
  };

  function evalWxs(mod) {
    var module = { exports: {} };
    var fn = new Function('module', 'exports', 'getRegExp', 'getDate', '"use strict";\n' + mod.code);
    fn(module, module.exports,
      function (p, f) { return new RegExp(p, f); },
      function () { return arguments.length ? new (Function.prototype.bind.apply(Date, [null].concat([].slice.call(arguments))))() : new Date(); });
    return module.exports;
  }

  /** 编译页面组件（每个路由只编译一次） */
  function getPageComponent(route) {
    if (router.pageComponents[route]) return router.pageComponents[route];
    var wxml = sources.get(route + '.wxml') || '';
    var compiled = global.WxmlCompiler.compile(wxml);
    var wxsModules = {};
    compiled.wxs.forEach(function (m) {
      try { wxsModules[m.name] = evalWxs(m); } catch (e) { MP.reportError(e, 'WXS ' + route + ' ' + m.name); }
    });
    var render;
    try {
      render = Vue.compile(compiled.template || '<view></view>', {
        whitespace: 'condense',
        isCustomElement: function (tag) { return tag === 'view' || tag === 'text'; },
        onError: function (err) { MP.reportError(err, '模板编译 ' + route); }
      });
    } catch (e) {
      MP.reportError(e, '模板编译 ' + route);
      render = function () { return Vue.h('view', '页面模板编译失败：' + route); };
    }
    if (!router.styledRoutes[route]) {
      router.styledRoutes[route] = true;
      registerStyle('mp-style-' + route.replace(/[^\w]/g, '_'), sources.get(route + '.wxss') || '',
        route + '.wxss', '[data-mp-page="' + route + '"]', route.replace(/[^\w]/g, '_'));
    }
    var comp = Vue.markRaw({
      name: 'MpPage',
      props: { inst: Object },
      setup: function (props) {
        var inst = props.inst;
        return Object.assign({ wxd: inst.data, wxe: inst.__wxe, wxc: inst.__wxc, wxu: MP.wxu }, wxsModules);
      },
      mounted: function () { this.inst.__root = this.$el && this.$el.parentElement; },
      render: render
    });
    router.pageComponents[route] = comp;
    return comp;
  }

  // ---------------- 页面实例 ----------------
  var PageProto = {
    setData: function (obj, cb) {
      var data = this.data;
      Object.keys(obj || {}).forEach(function (key) {
        var v = util.cloneData(obj[key]);
        if (key.indexOf('.') < 0 && key.indexOf('[') < 0) data[key] = v;
        else util.setByPath(data, key, v);
      });
      if (typeof cb === 'function') Vue.nextTick(cb);
    },
    createSelectorQuery: function () { return MP.createSelectorQuery().in(this); },
    createIntersectionObserver: function () {
      return { relativeTo: function () { return this; }, relativeToViewport: function () { return this; }, observe: function () {}, disconnect: function () {} };
    },
    selectComponent: function () { return null; },
    selectAllComponents: function () { return []; },
    getOpenerEventChannel: function () { return this.__eventChannel || (this.__eventChannel = new MP.EventChannel()); }
  };

  function callHook(inst, name, arg) {
    var fn = inst[name];
    if (typeof fn !== 'function') return;
    try { return fn.call(inst, arg); } catch (e) { MP.reportError(e, inst.route + ' ' + name); }
  }

  function buildTarget(el) {
    if (!el || el.nodeType !== 1) return { id: '', dataset: {}, offsetLeft: 0, offsetTop: 0 };
    return {
      id: el.id || '',
      dataset: Object.assign({}, el.__wxds || {}),
      offsetLeft: el.offsetLeft || 0,
      offsetTop: el.offsetTop || 0
    };
  }

  function dispatch(inst, handlerName, event) {
    if (!handlerName) return;
    var fn = inst[handlerName];
    if (typeof fn !== 'function') {
      console.warn('[web] 页面 "' + inst.route + '" 没有方法 "' + handlerName + '" 来处理 ' + event.type + ' 事件');
      return;
    }
    try { fn.call(inst, event); } catch (e) { MP.reportError(e, inst.route + ' ' + handlerName); }
  }

  function createInstance(route, query, opts) {
    var def = loadPageDef(route);
    var inst = Object.create(PageProto);
    Object.keys(def).forEach(function (k) {
      if (k === 'data') return;
      inst[k] = typeof def[k] === 'function' ? def[k] : util.cloneData(def[k]);
    });
    var cfg = pageConfig(route);
    inst.data = Vue.reactive(util.cloneData(def.data || {}));
    inst.route = route;
    inst.__route__ = route;
    inst.options = query || {};
    inst.__uid = ++router.uid;
    inst.__config = cfg;
    inst.__nav = Vue.reactive({
      title: cfg.navigationBarTitleText || '',
      bg: cfg.navigationBarBackgroundColor,
      fg: cfg.navigationBarTextStyle === 'black' ? '#000000' : '#ffffff',
      custom: cfg.navigationStyle === 'custom'
    });
    inst.__anim = Vue.ref((opts && opts.anim) || '');
    inst.__wxe = function (ev, handlerName, isCatch) {
      if (isCatch && ev && ev.stopPropagation) ev.stopPropagation();
      if (!handlerName) return;
      var type = ev.type === 'click' ? 'tap' : ev.type;
      var t = ev.target && ev.target.nodeType === 3 ? ev.target.parentElement : ev.target;
      var touch = ev.changedTouches && ev.changedTouches[0];
      dispatch(inst, handlerName, {
        type: type,
        timeStamp: Math.round(ev.timeStamp || 0),
        currentTarget: buildTarget(ev.__wxCurrent || ev.currentTarget),
        target: buildTarget(t),
        detail: { x: touch ? touch.clientX : ev.clientX, y: touch ? touch.clientY : ev.clientY },
        touches: ev.touches ? [].slice.call(ev.touches).map(function (x) { return { clientX: x.clientX, clientY: x.clientY, pageX: x.pageX, pageY: x.pageY }; }) : [],
        changedTouches: ev.changedTouches ? [].slice.call(ev.changedTouches).map(function (x) { return { clientX: x.clientX, clientY: x.clientY, pageX: x.pageX, pageY: x.pageY }; }) : [],
        mark: {}
      });
    };
    inst.__wxc = function (payload, handlerName, isCatch) {
      if (!payload) return;
      if (isCatch && payload.native && payload.native.stopPropagation) payload.native.stopPropagation();
      if (!handlerName) return;
      var target = buildTarget(payload.el);
      dispatch(inst, handlerName, {
        type: payload.type,
        timeStamp: Math.round(performance.now()),
        currentTarget: target,
        target: target,
        detail: payload.detail || {},
        mark: {}
      });
    };
    inst.__comp = getPageComponent(route);
    if (opts && opts.eventChannel) inst.__eventChannel = opts.eventChannel;
    return Vue.markRaw(inst);
  }

  function syncAlive() {
    var list = router.stack.slice();
    Object.keys(router.tabInstances).forEach(function (r) {
      var t = router.tabInstances[r];
      if (t && list.indexOf(t) < 0) list.unshift(t);
    });
    router.alive.splice(0, router.alive.length);
    list.forEach(function (x) { router.alive.push(x); });
    var top = router.top();
    if (top) {
      var qs = Object.keys(top.options || {}).map(function (k) { return k + '=' + top.options[k]; }).join('&');
      try { history.replaceState(null, '', '#/' + top.route + (qs ? '?' + qs : '')); } catch (e) {}
    }
  }

  function unload(inst) {
    callHook(inst, 'onUnload');
    if (router.tabInstances[inst.route] === inst) delete router.tabInstances[inst.route];
  }

  function animateLeave(inst) {
    inst.__anim.value = 'leave';
    router.leaving.push(inst);
    setTimeout(function () {
      var i = router.leaving.indexOf(inst);
      if (i >= 0) router.leaving.splice(i, 1);
    }, 260);
  }

  function afterShow(inst) {
    Vue.nextTick(function () {
      if (!inst.__readyCalled) { inst.__readyCalled = true; callHook(inst, 'onReady'); }
    });
  }

  function cb(opts, ok, res) {
    opts = opts || {};
    try {
      if (ok && typeof opts.success === 'function') opts.success(res);
      if (!ok && typeof opts.fail === 'function') opts.fail(res);
      if (typeof opts.complete === 'function') opts.complete(res);
    } catch (e) { MP.reportError(e, '路由回调'); }
  }

  router.navigateTo = function (opts) {
    var u = util.parseUrl(opts.url);
    if (!sources.has(u.path + '.js')) return cb(opts, false, { errMsg: 'navigateTo:fail page "' + u.path + '" is not found' });
    if (router.isTab(u.path)) return cb(opts, false, { errMsg: 'navigateTo:fail can not navigateTo a tabbar page' });
    var prev = router.top();
    var channel = new MP.EventChannel();
    if (opts.events) Object.keys(opts.events).forEach(function (k) { channel.on(k, opts.events[k]); });
    var inst;
    try { inst = createInstance(u.path, u.query, { anim: prev ? 'enter' : '', eventChannel: channel }); }
    catch (e) { MP.reportError(e, 'navigateTo ' + u.path); return cb(opts, false, { errMsg: 'navigateTo:fail ' + e.message }); }
    if (prev) callHook(prev, 'onHide');
    router.stack.push(inst);
    syncAlive();
    callHook(inst, 'onLoad', u.query);
    callHook(inst, 'onShow');
    afterShow(inst);
    cb(opts, true, { errMsg: 'navigateTo:ok', eventChannel: channel });
  };

  router.redirectTo = function (opts) {
    var u = util.parseUrl(opts.url);
    if (!sources.has(u.path + '.js')) return cb(opts, false, { errMsg: 'redirectTo:fail page "' + u.path + '" is not found' });
    if (router.isTab(u.path)) return cb(opts, false, { errMsg: 'redirectTo:fail can not redirectTo a tabbar page' });
    var inst;
    try { inst = createInstance(u.path, u.query, { anim: 'fade' }); }
    catch (e) { MP.reportError(e, 'redirectTo ' + u.path); return cb(opts, false, { errMsg: 'redirectTo:fail ' + e.message }); }
    var old = router.stack.pop();
    if (old) unload(old);
    router.stack.push(inst);
    syncAlive();
    callHook(inst, 'onLoad', u.query);
    callHook(inst, 'onShow');
    afterShow(inst);
    cb(opts, true, { errMsg: 'redirectTo:ok' });
  };

  router.navigateBack = function (opts) {
    opts = opts || {};
    var delta = Math.max(1, parseInt(opts.delta, 10) || 1);
    if (router.stack.length <= 1) return cb(opts, false, { errMsg: 'navigateBack:fail cannot navigate back at first page.' });
    delta = Math.min(delta, router.stack.length - 1);
    for (var i = 0; i < delta; i++) {
      var p = router.stack.pop();
      if (i === 0) animateLeave(p);
      unload(p);
    }
    syncAlive();
    var top = router.top();
    if (top) { callHook(top, 'onShow'); }
    cb(opts, true, { errMsg: 'navigateBack:ok' });
  };

  function openTab(route, opts, fromRelaunch) {
    var top = router.top();
    // 关闭所有非 tab 页
    while (router.stack.length) {
      var p = router.stack[router.stack.length - 1];
      if (router.isTab(p.route)) break;
      router.stack.pop();
      unload(p);
    }
    var current = router.top();
    if (current && current.route === route) {
      router.stack.splice(0, router.stack.length, current);
      syncAlive();
      if (top !== current) callHook(current, 'onShow');
      return cb(opts, true, { errMsg: 'switchTab:ok' });
    }
    if (current) callHook(current, 'onHide');
    var inst = router.tabInstances[route];
    var isNew = !inst;
    if (isNew) {
      try { inst = createInstance(route, {}, { anim: fromRelaunch ? '' : 'fade' }); }
      catch (e) { MP.reportError(e, 'switchTab ' + route); return cb(opts, false, { errMsg: 'switchTab:fail ' + e.message }); }
      router.tabInstances[route] = inst;
    }
    router.stack.splice(0, router.stack.length, inst);
    syncAlive();
    if (isNew) callHook(inst, 'onLoad', {});
    callHook(inst, 'onShow');
    afterShow(inst);
    cb(opts, true, { errMsg: 'switchTab:ok' });
  }

  router.switchTab = function (opts) {
    var u = util.parseUrl(opts.url);
    if (!router.isTab(u.path)) return cb(opts, false, { errMsg: 'switchTab:fail can not switch to no-tabBar page' });
    openTab(u.path, opts, false);
  };

  router.reLaunch = function (opts) {
    var u = util.parseUrl(opts.url);
    if (!sources.has(u.path + '.js')) return cb(opts, false, { errMsg: 'reLaunch:fail page "' + u.path + '" is not found' });
    while (router.stack.length) unload(router.stack.pop());
    Object.keys(router.tabInstances).forEach(function (r) {
      var t = router.tabInstances[r];
      delete router.tabInstances[r];
      callHook(t, 'onUnload');
    });
    if (router.isTab(u.path)) return openTab(u.path, opts, true);
    var inst;
    try { inst = createInstance(u.path, u.query, { anim: '' }); }
    catch (e) { MP.reportError(e, 'reLaunch ' + u.path); return cb(opts, false, { errMsg: 'reLaunch:fail ' + e.message }); }
    router.stack.push(inst);
    syncAlive();
    callHook(inst, 'onLoad', u.query);
    callHook(inst, 'onShow');
    afterShow(inst);
    cb(opts, true, { errMsg: 'reLaunch:ok' });
  };

  /** 网页切到后台 / 回到前台 → 当前页 onHide / onShow（与小程序切后台一致） */
  document.addEventListener('visibilitychange', function () {
    var top = router.top();
    var app = MP.appInstance;
    if (document.hidden) {
      if (top) callHook(top, 'onHide');
      if (app && app.onHide) try { app.onHide(); } catch (e) {}
    } else {
      if (app && app.onShow) try { app.onShow({}); } catch (e) {}
      if (top) callHook(top, 'onShow');
    }
  });

  // ---------------- SelectorQuery ----------------
  function pageRoot(inst) {
    inst = inst || router.top();
    if (!inst) return document;
    return document.querySelector('[data-mp-uid="' + inst.__uid + '"]') || document;
  }

  function canvasNode(el) {
    if (!el.__mpPatched) {
      el.__mpPatched = true;
      el.createImage = function () { return new Image(); };
      el.requestAnimationFrame = function (f) { return global.requestAnimationFrame(f); };
      el.cancelAnimationFrame = function (id) { return global.cancelAnimationFrame(id); };
      el.createPath2D = function (p) { return new Path2D(p); };
    }
    return el;
  }

  function nodeInfo(el, fields, rootEl) {
    if (!el) return null;
    var res = {};
    var rect = el.getBoundingClientRect();
    var rootRect = rootEl && rootEl.getBoundingClientRect ? rootEl.getBoundingClientRect() : { left: 0, top: 0 };
    if (fields.id) res.id = el.id || '';
    if (fields.dataset) res.dataset = Object.assign({}, el.__wxds || {});
    if (fields.rect) {
      res.left = rect.left - rootRect.left; res.top = rect.top - rootRect.top;
      res.right = res.left + rect.width; res.bottom = res.top + rect.height;
    }
    if (fields.size) { res.width = rect.width; res.height = rect.height; }
    if (fields.scrollOffset) {
      res.scrollLeft = el.scrollLeft; res.scrollTop = el.scrollTop;
      res.scrollWidth = el.scrollWidth; res.scrollHeight = el.scrollHeight;
    }
    if (fields.node) res.node = el.tagName === 'CANVAS' ? canvasNode(el) : el;
    if (fields.computedStyle) {
      var cs = getComputedStyle(el);
      fields.computedStyle.forEach(function (k) { res[k] = cs.getPropertyValue(k.replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); })); });
    }
    return res;
  }

  function SelectorQuery() { this._inst = null; this._tasks = []; }
  SelectorQuery.prototype.in = function (comp) { if (comp && comp.__uid) this._inst = comp; return this; };
  function NodesRef(query, selector, all, viewport) { this._q = query; this._sel = selector; this._all = all; this._vp = viewport; }
  NodesRef.prototype.fields = function (f, fn) { this._q._tasks.push({ ref: this, fields: f || {}, cb: fn }); return this._q; };
  NodesRef.prototype.boundingClientRect = function (fn) { return this.fields({ id: true, dataset: true, rect: true, size: true }, fn); };
  NodesRef.prototype.scrollOffset = function (fn) { return this.fields({ id: true, dataset: true, scrollOffset: true }, fn); };
  NodesRef.prototype.node = function (fn) { return this.fields({ node: true }, fn); };
  NodesRef.prototype.context = function (fn) { return this.fields({ node: true }, function (r) { if (fn) fn(r && r.node ? { context: r.node.getContext('2d') } : null); }); };
  SelectorQuery.prototype.select = function (s) { return new NodesRef(this, s, false); };
  SelectorQuery.prototype.selectAll = function (s) { return new NodesRef(this, s, true); };
  SelectorQuery.prototype.selectViewport = function () { return new NodesRef(this, null, false, true); };
  SelectorQuery.prototype.exec = function (fn) {
    var self = this;
    Vue.nextTick(function () {
      setTimeout(function () {
        var root = pageRoot(self._inst);
        var results = self._tasks.map(function (t) {
          var r;
          if (t.ref._vp) {
            var sc = root.querySelector ? root.querySelector('.mp-page') : null;
            r = sc ? { id: '', dataset: {}, left: 0, top: 0, width: sc.clientWidth, height: sc.clientHeight, scrollTop: sc.scrollTop, scrollLeft: sc.scrollLeft, scrollHeight: sc.scrollHeight, scrollWidth: sc.scrollWidth } : null;
          } else if (t.ref._all) {
            var list = root.querySelectorAll ? [].slice.call(root.querySelectorAll(t.ref._sel)) : [];
            r = list.map(function (el) { return nodeInfo(el, t.fields, root); });
          } else {
            r = nodeInfo(root.querySelector ? root.querySelector(t.ref._sel) : null, t.fields, root);
          }
          if (typeof t.cb === 'function') { try { t.cb(r); } catch (e) { MP.reportError(e, 'SelectorQuery'); } }
          return r;
        });
        if (typeof fn === 'function') { try { fn(results); } catch (e) { MP.reportError(e, 'SelectorQuery.exec'); } }
      }, 16);
    });
    return this;
  };
  MP.createSelectorQuery = function () { return new SelectorQuery(); };
  MP.pageRoot = pageRoot;

  // 模板辅助函数（模板里以 wxu.xxx 调用）
  MP.wxu = {
    s: function (v) { return v == null ? '' : v; },
    list: function (v) {
      if (v == null || v === false) return [];
      if (Array.isArray(v)) return v;
      if (typeof v === 'number') { var a = []; for (var i = 0; i < v; i++) a.push(i); return a; }
      if (typeof v === 'string') return v.split('');
      return v;
    },
    rpx: function (s) { return s == null ? '' : global.Wxss.rpx(String(s)); }
  };
})(window);
