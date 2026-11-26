/**
 * 网页端运行时 · 小程序内置组件的 Vue 实现 + 指令
 *
 * 组件事件统一 emit 一个 payload：{ type, detail, el, native }
 * 编译后的模板用 wxc($event, 'handler') 把它转成小程序的事件对象（含 currentTarget.dataset）。
 */
(function (global) {
  'use strict';
  var MP = global.MP;
  var Vue = global.Vue;
  var h = Vue.h;

  function emitWx(vm, type, detail, native) {
    vm.$emit(type, { type: type, detail: detail || {}, el: vm.$el, native: native || null });
  }
  function bool(v) { return v === true || v === '' || v === 'true'; }

  var directives = {
    // data-* → el.__wxds（保留数字/布尔等原始类型，与小程序 dataset 一致）
    wxds: {
      mounted: function (el, b) { el.__wxds = b.value || {}; },
      updated: function (el, b) { el.__wxds = b.value || {}; }
    },
    // hover-class：按下时加类名
    wxhover: {
      mounted: function (el, b) {
        var timer = null;
        function cls() { return String(el.__wxhover || '').split(/\s+/).filter(Boolean); }
        el.__wxhover = b.value;
        el.addEventListener('pointerdown', function () {
          if (el.hasAttribute('disabled')) return;
          clearTimeout(timer);
          cls().forEach(function (c) { el.classList.add(c); });
        });
        var up = function () {
          clearTimeout(timer);
          timer = setTimeout(function () { cls().forEach(function (c) { el.classList.remove(c); }); }, 90);
        };
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
        el.addEventListener('pointerleave', up);
      },
      updated: function (el, b) { el.__wxhover = b.value; }
    },
    // bindlongpress：按住 350ms 触发，并吞掉随后的 click
    wxlongpress: {
      mounted: function (el, b) {
        var timer = null, fired = false, sx = 0, sy = 0;
        el.__wxlp = b.value;
        el.addEventListener('pointerdown', function (ev) {
          fired = false; sx = ev.clientX; sy = ev.clientY;
          clearTimeout(timer);
          timer = setTimeout(function () {
            fired = true;
            var v = el.__wxlp || [];
            var fake = { type: 'longpress', timeStamp: ev.timeStamp, target: ev.target, currentTarget: el, __wxCurrent: el, clientX: sx, clientY: sy, stopPropagation: function () {} };
            if (typeof v[2] === 'function') v[2](fake, v[0], v[1]);
          }, 350);
        });
        el.addEventListener('pointermove', function (ev) {
          if (Math.abs(ev.clientX - sx) > 8 || Math.abs(ev.clientY - sy) > 8) clearTimeout(timer);
        });
        ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (n) { el.addEventListener(n, function () { clearTimeout(timer); }); });
        el.addEventListener('click', function (ev) { if (fired) { fired = false; ev.stopImmediatePropagation(); ev.preventDefault(); } }, true);
        el.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
      },
      updated: function (el, b) { el.__wxlp = b.value; }
    }
  };

  // ---------------- image ----------------
  var WxImage = {
    name: 'wx-image',
    props: { src: String, mode: { type: String, default: 'scaleToFill' }, lazyLoad: null, showMenuByLongpress: null, webp: null },
    emits: ['load', 'error'],
    render: function () {
      var vm = this;
      var mode = this.mode || 'scaleToFill';
      return h('img', {
        class: ['wx-image', 'wx-image--' + mode],
        src: this.src ? MP.sources.asset(this.src) : undefined,
        alt: '',
        draggable: 'false',
        loading: bool(this.lazyLoad) ? 'lazy' : undefined,
        onLoad: function (e) { emitWx(vm, 'load', { width: e.target.naturalWidth, height: e.target.naturalHeight }, e); },
        onError: function (e) { if (vm.src) emitWx(vm, 'error', { errMsg: 'image load error' }, e); }
      });
    }
  };

  // ---------------- input ----------------
  function inputAttrs(vm) {
    var t = vm.type || 'text';
    var a = { type: bool(vm.password) || t === 'safe-password' ? 'password' : 'text' };
    if (t === 'number') a.inputmode = 'numeric';
    else if (t === 'digit') a.inputmode = 'decimal';
    else if (t === 'idcard') a.inputmode = 'text';
    var ml = parseInt(vm.maxlength, 10);
    if (isNaN(ml)) ml = 140;
    if (ml >= 0) a.maxlength = ml;
    return a;
  }
  function filterNumeric(value, type) {
    if (type === 'number') return value.replace(/[^\d]/g, '');
    if (type === 'digit') return value.replace(/[^\d.]/g, '');
    return value;
  }
  var WxInput = {
    name: 'wx-input',
    props: {
      value: null, type: { type: String, default: 'text' }, password: null, placeholder: String,
      placeholderClass: String, placeholderStyle: String, disabled: null, maxlength: null,
      focus: null, autoFocus: null, confirmType: String, confirmHold: null, cursorSpacing: null, alwaysEmbed: null, adjustPosition: null, holdKeyboard: null
    },
    emits: ['input', 'focus', 'blur', 'confirm', 'keyboardheightchange', 'nicknamereview'],
    mounted: function () { if (bool(this.focus) || bool(this.autoFocus)) this.$el.focus(); },
    watch: { focus: function (v) { if (bool(v)) this.$el.focus(); } },
    render: function () {
      var vm = this;
      var attrs = inputAttrs(this);
      return h('input', Object.assign(attrs, {
        class: 'wx-input',
        value: this.value == null ? '' : String(this.value),
        placeholder: this.placeholder || '',
        disabled: bool(this.disabled),
        enterkeyhint: this.confirmType === 'search' ? 'search' : (this.confirmType === 'send' ? 'send' : 'done'),
        onInput: function (e) {
          var v = e.target.value;
          var f = filterNumeric(v, vm.type);
          if (f !== v) e.target.value = v = f;
          emitWx(vm, 'input', { value: v, cursor: e.target.selectionStart, keyCode: 0 }, e);
        },
        onFocus: function (e) { emitWx(vm, 'focus', { value: e.target.value, height: 0 }, e); },
        onBlur: function (e) { emitWx(vm, 'blur', { value: e.target.value }, e); },
        onKeydown: function (e) {
          if (e.key === 'Enter') {
            emitWx(vm, 'confirm', { value: e.target.value }, e);
            if (!bool(vm.confirmHold)) e.target.blur();
          }
        }
      }));
    }
  };

  // ---------------- textarea ----------------
  var WxTextarea = {
    name: 'wx-textarea',
    props: {
      value: null, placeholder: String, placeholderClass: String, placeholderStyle: String, disabled: null,
      maxlength: null, focus: null, autoFocus: null, autoHeight: null, fixed: null, cursorSpacing: null,
      showConfirmBar: null, adjustPosition: null, disableDefaultPadding: null, confirmType: String
    },
    emits: ['input', 'focus', 'blur', 'confirm', 'linechange'],
    mounted: function () { this.resize(); if (bool(this.focus) || bool(this.autoFocus)) this.$el.focus(); },
    updated: function () { this.resize(); },
    methods: {
      resize: function () {
        if (!bool(this.autoHeight)) return;
        var el = this.$el;
        el.style.height = 'auto';
        el.style.height = el.scrollHeight + 'px';
      }
    },
    render: function () {
      var vm = this;
      var ml = parseInt(this.maxlength, 10);
      if (isNaN(ml)) ml = 140;
      return h('textarea', {
        class: ['wx-textarea', bool(this.autoHeight) ? 'wx-textarea--auto' : ''],
        value: this.value == null ? '' : String(this.value),
        placeholder: this.placeholder || '',
        disabled: bool(this.disabled),
        maxlength: ml >= 0 ? ml : undefined,
        rows: bool(this.autoHeight) ? 1 : undefined,
        onInput: function (e) { vm.resize(); emitWx(vm, 'input', { value: e.target.value, cursor: e.target.selectionStart }, e); },
        onFocus: function (e) { emitWx(vm, 'focus', { value: e.target.value }, e); },
        onBlur: function (e) { emitWx(vm, 'blur', { value: e.target.value }, e); }
      });
    }
  };

  // ---------------- button ----------------
  var WxButton = {
    name: 'wx-button',
    props: {
      type: { type: String, default: 'default' }, size: String, plain: null, disabled: null, loading: null,
      formType: String, openType: String, hoverClass: String, lang: String, sessionFrom: String,
      sendMessageTitle: String, appParameter: String, showMessageCard: null
    },
    emits: ['chooseavatar', 'getuserinfo', 'getphonenumber', 'contact', 'opensetting', 'launchapp', 'error'],
    render: function () {
      var vm = this;
      // 用块级自定义元素而不是原生 <button>：原生按钮 display:block 也不会撑满父容器，
      // 小程序的 button 会。WXSS 里的 button 选择器在 wxss.js 中映射为 .wx-button
      return h('mp-button', {
        class: ['wx-button', 'wx-button--' + (this.type || 'default'), this.size === 'mini' ? 'wx-button--mini' : '', bool(this.plain) ? 'wx-button--plain' : ''],
        disabled: bool(this.disabled) ? '' : undefined,
        role: 'button',
        tabindex: bool(this.disabled) ? -1 : 0,
        onClick: function (e) {
          var ot = vm.openType;
          if (!ot) return;
          if (ot === 'chooseAvatar') {
            MP.wx.chooseImage({
              count: 1,
              success: function (r) { emitWx(vm, 'chooseavatar', { avatarUrl: r.tempFilePaths[0] }, e); },
              fail: function () {}
            });
          } else if (ot === 'share') {
            MP.showToast({ title: '网页端不支持转发，可复制链接分享', icon: 'none' });
          } else if (ot === 'contact' || ot === 'feedback') {
            MP.showToast({ title: '网页端不支持客服会话', icon: 'none' });
          } else if (ot === 'getUserInfo') {
            emitWx(vm, 'getuserinfo', { errMsg: 'getUserInfo:fail web' }, e);
          } else if (ot === 'getPhoneNumber') {
            emitWx(vm, 'getphonenumber', { errMsg: 'getPhoneNumber:fail web' }, e);
          } else if (ot === 'openSetting') {
            emitWx(vm, 'opensetting', { authSetting: {} }, e);
          }
        }
      }, [bool(this.loading) ? h('i', { class: 'wx-button__spinner' }) : null, this.$slots.default ? this.$slots.default() : null]);
    }
  };

  // ---------------- switch ----------------
  var WxSwitch = {
    name: 'wx-switch',
    props: { checked: null, disabled: null, type: { type: String, default: 'switch' }, color: String },
    emits: ['change'],
    data: function () { return { on: bool(this.checked) }; },
    watch: { checked: function (v) { this.on = bool(v); } },
    render: function () {
      var vm = this;
      var style = this.on && this.color ? { background: this.color, borderColor: this.color } : null;
      return h('wx-switch-el', {
        class: ['wx-switch', this.on ? 'is-on' : '', bool(this.disabled) ? 'is-disabled' : ''],
        role: 'switch', 'aria-checked': String(this.on),
        onClick: function (e) {
          if (bool(vm.disabled)) return;
          vm.on = !vm.on;
          emitWx(vm, 'change', { value: vm.on }, e);
        }
      }, [h('i', { class: 'wx-switch__track', style: style }, [h('i', { class: 'wx-switch__knob' })])]);
    }
  };

  // ---------------- picker ----------------
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function labelOf(item, key) {
    if (item != null && typeof item === 'object') return key ? String(item[key] == null ? '' : item[key]) : JSON.stringify(item);
    return String(item == null ? '' : item);
  }
  function range(a, b) { var o = []; for (var i = a; i <= b; i++) o.push(i); return o; }
  function parseYMD(s, fb) {
    var m = /^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/.exec(s || '');
    if (!m) return fb;
    return { y: +m[1], m: m[2] ? +m[2] : 1, d: m[3] ? +m[3] : 1 };
  }

  var WxPicker = {
    name: 'wx-picker',
    props: {
      mode: { type: String, default: 'selector' }, range: null, rangeKey: String, value: null,
      start: String, end: String, fields: { type: String, default: 'day' }, disabled: null, headerText: String,
      customItem: String, level: String
    },
    emits: ['change', 'cancel', 'columnchange'],
    methods: {
      open: function (e) {
        if (bool(this.disabled)) return;
        var vm = this;
        var mode = this.mode || 'selector';
        if (mode === 'selector') this.openSelector(e);
        else if (mode === 'multiSelector') this.openMulti(e);
        else if (mode === 'date') this.openDate(e);
        else if (mode === 'time') this.openTime(e);
        else MP.showToast({ title: '网页端暂不支持该选择器', icon: 'none' });
        void vm;
      },
      show: function (cfg, e) {
        var vm = this;
        MP.ui.picker = Object.assign({ title: this.headerText || '' }, cfg, {
          cancel: function () { MP.ui.picker = null; emitWx(vm, 'cancel', {}, e); },
          confirm: function (values) { MP.ui.picker = null; cfg.done(values); }
        });
      },
      openSelector: function (e) {
        var vm = this;
        var list = Array.isArray(this.range) ? this.range : [];
        if (!list.length) return;
        var idx = parseInt(this.value, 10);
        if (isNaN(idx) || idx < 0 || idx >= list.length) idx = 0;
        this.show({
          columns: [list.map(function (x) { return labelOf(x, vm.rangeKey); })],
          values: [idx],
          done: function (v) { emitWx(vm, 'change', { value: v[0] }, e); }
        }, e);
      },
      openMulti: function (e) {
        var vm = this;
        var cols = (Array.isArray(this.range) ? this.range : []).map(function (c) {
          return (c || []).map(function (x) { return labelOf(x, vm.rangeKey); });
        });
        var vals = cols.map(function (_, i) { return (Array.isArray(vm.value) && parseInt(vm.value[i], 10)) || 0; });
        this.show({
          columns: cols, values: vals,
          onColumn: function (col, val) { emitWx(vm, 'columnchange', { column: col, value: val }, e); },
          done: function (v) { emitWx(vm, 'change', { value: v }, e); }
        }, e);
      },
      openDate: function (e) {
        var vm = this;
        var today = new Date();
        var start = parseYMD(this.start, { y: 1900, m: 1, d: 1 });
        var end = parseYMD(this.end, { y: 2100, m: 12, d: 31 });
        var cur = parseYMD(this.value, { y: today.getFullYear(), m: today.getMonth() + 1, d: today.getDate() });
        var years = range(start.y, end.y);
        var fields = this.fields || 'day';
        function daysIn(y, m) { return new Date(y, m, 0).getDate(); }
        var cols = [years.map(function (y) { return y + '年'; })];
        var vals = [Math.max(0, years.indexOf(cur.y))];
        if (fields !== 'year') { cols.push(range(1, 12).map(function (m) { return m + '月'; })); vals.push(cur.m - 1); }
        if (fields === 'day') { cols.push(range(1, daysIn(cur.y, cur.m)).map(function (d) { return d + '日'; })); vals.push(Math.min(cur.d, daysIn(cur.y, cur.m)) - 1); }
        this.show({
          columns: cols, values: vals,
          // 年 / 月变化时刷新天数列
          adjust: function (values) {
            if (fields !== 'day') return null;
            var y = years[values[0]] || cur.y, m = values[1] + 1;
            var n = daysIn(y, m);
            return { col: 2, items: range(1, n).map(function (d) { return d + '日'; }) };
          },
          done: function (v) {
            var y = years[v[0]];
            var s = String(y);
            if (fields !== 'year') s += '-' + pad(v[1] + 1);
            if (fields === 'day') s += '-' + pad(v[2] + 1);
            emitWx(vm, 'change', { value: s }, e);
          }
        }, e);
      },
      openTime: function (e) {
        var vm = this;
        var m = /^(\d{1,2}):(\d{1,2})/.exec(this.value || '');
        var now = new Date();
        var hh = m ? +m[1] : now.getHours(), mm = m ? +m[2] : now.getMinutes();
        this.show({
          columns: [range(0, 23).map(pad), range(0, 59).map(pad)],
          values: [hh, mm],
          done: function (v) { emitWx(vm, 'change', { value: pad(v[0]) + ':' + pad(v[1]) }, e); }
        }, e);
      }
    },
    render: function () {
      var vm = this;
      return h('picker', { class: 'wx-picker', onClick: function (e) { vm.open(e); } }, this.$slots.default ? this.$slots.default() : []);
    }
  };

  // ---------------- scroll-view ----------------
  var WxScrollView = {
    name: 'wx-scroll-view',
    props: {
      scrollX: null, scrollY: null, scrollTop: null, scrollLeft: null, scrollIntoView: String,
      scrollWithAnimation: null, enhanced: null, showScrollbar: null, upperThreshold: { default: 50 }, lowerThreshold: { default: 50 },
      enableBackToTop: null, refresherEnabled: null, bounces: null, pagingEnabled: null, enableFlex: null
    },
    emits: ['scroll', 'scrolltoupper', 'scrolltolower', 'refresherrefresh'],
    mounted: function () { this.applyScroll(); },
    watch: {
      scrollIntoView: function () { this.applyScroll(); },
      scrollTop: function () { this.applyScroll(); },
      scrollLeft: function () { this.applyScroll(); }
    },
    methods: {
      applyScroll: function () {
        var vm = this;
        Vue.nextTick(function () {
          var el = vm.$el;
          if (!el) return;
          var behavior = bool(vm.scrollWithAnimation) ? 'smooth' : 'auto';
          if (vm.scrollIntoView) {
            var target = el.querySelector('#' + CSS.escape(vm.scrollIntoView));
            if (target) {
              var top = target.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
              var left = target.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft;
              el.scrollTo({ top: bool(vm.scrollY) ? top : el.scrollTop, left: bool(vm.scrollX) ? left : el.scrollLeft, behavior: behavior });
            }
            return;
          }
          if (vm.scrollTop != null && vm.scrollTop !== '') el.scrollTo({ top: parseFloat(vm.scrollTop) || 0, behavior: behavior });
          if (vm.scrollLeft != null && vm.scrollLeft !== '') el.scrollTo({ left: parseFloat(vm.scrollLeft) || 0, behavior: behavior });
        });
      }
    },
    render: function () {
      var vm = this;
      var lastTop = 0, lastLeft = 0, lowerFired = false;
      return h('scroll-view', {
        class: ['wx-scroll-view', bool(this.scrollX) ? 'is-x' : '', bool(this.scrollY) ? 'is-y' : '', this.showScrollbar === false ? 'no-bar' : ''],
        onScroll: function (e) {
          var el = e.target;
          emitWx(vm, 'scroll', {
            scrollTop: el.scrollTop, scrollLeft: el.scrollLeft, scrollHeight: el.scrollHeight, scrollWidth: el.scrollWidth,
            deltaX: el.scrollLeft - lastLeft, deltaY: el.scrollTop - lastTop
          }, e);
          lastTop = el.scrollTop; lastLeft = el.scrollLeft;
          var th = parseFloat(vm.lowerThreshold) || 50;
          var nearBottom = bool(vm.scrollX) && !bool(vm.scrollY)
            ? el.scrollLeft + el.clientWidth >= el.scrollWidth - th
            : el.scrollTop + el.clientHeight >= el.scrollHeight - th;
          if (nearBottom && !lowerFired) { lowerFired = true; emitWx(vm, 'scrolltolower', { direction: 'bottom' }, e); }
          if (!nearBottom) lowerFired = false;
          if (el.scrollTop <= (parseFloat(vm.upperThreshold) || 50) && bool(vm.scrollY)) emitWx(vm, 'scrolltoupper', { direction: 'top' }, e);
        }
      }, this.$slots.default ? this.$slots.default() : []);
    }
  };

  // ---------------- navigator ----------------
  var WxNavigator = {
    name: 'wx-navigator',
    props: { url: String, openType: { type: String, default: 'navigate' }, delta: { default: 1 }, hoverClass: String, target: String },
    render: function () {
      var vm = this;
      return h('navigator', {
        class: 'wx-navigator',
        onClick: function () {
          var t = vm.openType || 'navigate';
          var o = { url: vm.url };
          if (t === 'navigate') MP.wx.navigateTo(o);
          else if (t === 'redirect') MP.wx.redirectTo(o);
          else if (t === 'switchTab') MP.wx.switchTab(o);
          else if (t === 'reLaunch') MP.wx.reLaunch(o);
          else if (t === 'navigateBack') MP.wx.navigateBack({ delta: vm.delta });
        }
      }, this.$slots.default ? this.$slots.default() : []);
    }
  };

  // ---------------- canvas ----------------
  var WxCanvas = {
    name: 'wx-canvas',
    props: { type: String, canvasId: String, disableScroll: null },
    emits: ['error'],
    render: function () {
      return h('canvas', { class: 'wx-canvas', 'canvas-id': this.canvasId || undefined, 'data-type': this.type || undefined });
    }
  };

  // ---------------- web-view ----------------
  var WxWebView = {
    name: 'wx-web-view',
    props: { src: String },
    emits: ['message', 'load', 'error'],
    render: function () {
      var vm = this;
      return h('wx-webview-el', { class: 'wx-web-view' }, [
        h('iframe', {
          src: this.src || 'about:blank',
          referrerpolicy: 'no-referrer',
          onLoad: function (e) { emitWx(vm, 'load', { src: vm.src }, e); }
        }),
        this.src ? h('a', { class: 'wx-web-view__open', href: this.src, target: '_blank', rel: 'noopener' }, '页面打不开？在新窗口打开 ↗') : null
      ]);
    }
  };

  // ---------------- icon / slider / rich-text（本项目基本未用，给最小实现） ----------------
  var ICONS = { success: '✓', success_no_circle: '✓', info: 'i', warn: '!', waiting: '…', cancel: '✕', download: '↓', search: '⌕', clear: '✕' };
  var WxIcon = {
    name: 'wx-icon',
    props: { type: String, size: { default: 23 }, color: String },
    render: function () {
      return h('i', { class: 'wx-icon wx-icon--' + this.type, style: { fontSize: (parseFloat(this.size) || 23) + 'px', color: this.color || undefined } }, ICONS[this.type] || '•');
    }
  };
  var WxSlider = {
    name: 'wx-slider',
    props: { min: { default: 0 }, max: { default: 100 }, step: { default: 1 }, value: { default: 0 }, disabled: null, showValue: null, activeColor: String },
    emits: ['change', 'changing'],
    render: function () {
      var vm = this;
      return h('wx-slider-el', { class: 'wx-slider' }, [h('input', {
        type: 'range', min: this.min, max: this.max, step: this.step, value: this.value, disabled: bool(this.disabled),
        onInput: function (e) { emitWx(vm, 'changing', { value: +e.target.value }, e); },
        onChange: function (e) { emitWx(vm, 'change', { value: +e.target.value }, e); }
      }), bool(this.showValue) ? h('span', { class: 'wx-slider__value' }, String(this.value)) : null]);
    }
  };
  var WxRichText = {
    name: 'wx-rich-text',
    props: { nodes: null },
    render: function () {
      var html = typeof this.nodes === 'string' ? this.nodes.replace(/<script[\s\S]*?<\/script>/gi, '') : '';
      return h('wx-rich-text-el', { class: 'wx-rich-text', innerHTML: html });
    }
  };

  MP.installComponents = function (app) {
    Object.keys(directives).forEach(function (k) { app.directive(k, directives[k]); });
    [WxImage, WxInput, WxTextarea, WxButton, WxSwitch, WxPicker, WxScrollView, WxNavigator, WxCanvas, WxWebView, WxIcon, WxSlider, WxRichText]
      .forEach(function (c) { app.component(c.name, c); });
  };
})(window);
