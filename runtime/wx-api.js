/**
 * 网页端运行时 · wx.* API 实现
 *
 * 覆盖本项目实际用到的 API（见 HANDOFF 文档「网页端」一节的清单）。
 * 网页端无法实现的能力（云开发、订阅消息、真实相册等）统一走 fail 回调，
 * 让小程序代码里已有的兜底逻辑生效，而不是静默成功误导用户。
 */
(function (global) {
  'use strict';
  var MP = global.MP;
  var Vue = global.Vue;
  var router = MP.router;
  var ui = MP.ui;

  /** 统一回调风格：opts.success/fail/complete；未传回调时返回 Promise（与新版基础库一致） */
  function api(name, impl) {
    return function (opts) {
      opts = opts || {};
      var hasCb = typeof opts.success === 'function' || typeof opts.fail === 'function' || typeof opts.complete === 'function';
      var p = new Promise(function (resolve, reject) {
        try {
          Promise.resolve(impl(opts)).then(function (res) {
            res = Object.assign({ errMsg: name + ':ok' }, res || {});
            try {
              if (typeof opts.success === 'function') opts.success(res);
              if (typeof opts.complete === 'function') opts.complete(res);
            } catch (e) { MP.reportError(e, 'wx.' + name + ' 回调'); }
            resolve(res);
          }, function (err) {
            var res = { errMsg: name + ':fail ' + ((err && err.message) || err || '') };
            try {
              if (typeof opts.fail === 'function') opts.fail(res);
              if (typeof opts.complete === 'function') opts.complete(res);
            } catch (e) { MP.reportError(e, 'wx.' + name + ' 回调'); }
            reject(res);
          });
        } catch (e) { reject({ errMsg: name + ':fail ' + e.message }); }
      });
      if (hasCb) { p.catch(function () {}); return undefined; }
      return p;
    };
  }

  function screenSize() {
    var el = document.querySelector('.wb-screen');
    var w = el ? el.clientWidth : global.innerWidth;
    var h = el ? el.clientHeight : global.innerHeight;
    return { w: w, h: h };
  }

  // ---------------- 反馈类 UI ----------------
  var toastTimer = null;
  function showToast(opts) {
    clearTimeout(toastTimer);
    ui.loading = null;
    ui.toast = { title: opts.title || '', icon: opts.icon || 'success', image: opts.image || '', mask: !!opts.mask };
    toastTimer = setTimeout(function () { ui.toast = null; }, opts.duration || 1500);
  }

  // ---------------- 图片 / 文件 ----------------
  function pickFiles(accept, count, capture) {
    return new Promise(function (resolve, reject) {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = accept || 'image/*';
      if (count > 1) input.multiple = true;
      if (capture) input.setAttribute('capture', 'environment');
      input.style.display = 'none';
      document.body.appendChild(input);
      var done = false;
      input.addEventListener('change', function () {
        done = true;
        var files = [].slice.call(input.files || []).slice(0, count || 9);
        document.body.removeChild(input);
        if (!files.length) reject(new Error('cancel'));
        else resolve(files);
      });
      // 用户关掉选择框不会触发 change：页面重新获得焦点后判定为取消
      global.addEventListener('focus', function onFocus() {
        global.removeEventListener('focus', onFocus);
        setTimeout(function () {
          if (!done) { if (input.parentNode) document.body.removeChild(input); reject(new Error('cancel')); }
        }, 800);
      });
      input.click();
    });
  }

  /** 读图并缩到最长边 ≤ 1280，转成 dataURL —— 这样存进 storage 后刷新页面仍可显示 */
  function fileToDataUrl(file, maxSide) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var img = new Image();
        img.onload = function () {
          var s = Math.min(1, (maxSide || 1280) / Math.max(img.width, img.height));
          var c = document.createElement('canvas');
          c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve({ url: c.toDataURL('image/jpeg', 0.85), width: c.width, height: c.height });
        };
        img.onerror = function () { reject(new Error('图片解码失败')); };
        img.src = reader.result;
      };
      reader.onerror = function () { reject(new Error('读取文件失败')); };
      reader.readAsDataURL(file);
    });
  }

  function dataUrlToBase64(url) {
    if (/^data:/.test(url)) return Promise.resolve(url.slice(url.indexOf(',') + 1));
    return fetch(url).then(function (r) { return r.blob(); }).then(function (b) {
      return new Promise(function (resolve) {
        var fr = new FileReader();
        fr.onload = function () { resolve(String(fr.result).slice(String(fr.result).indexOf(',') + 1)); };
        fr.readAsDataURL(b);
      });
    });
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('图片加载失败')); };
      img.src = MP.sources.asset(src);
    });
  }

  // ---------------- 旧版 canvas 上下文（wx.createCanvasContext） ----------------
  function findLegacyCanvas(canvasId, comp) {
    var root = MP.pageRoot(comp && comp.__uid ? comp : null);
    return root.querySelector('canvas[canvas-id="' + canvasId + '"]');
  }
  function LegacyCanvasContext(canvas) {
    this.canvas = canvas;
    this.ops = [];
  }
  ['fillRect', 'strokeRect', 'clearRect', 'fillText', 'strokeText', 'moveTo', 'lineTo', 'stroke', 'fill', 'beginPath', 'closePath',
    'arc', 'arcTo', 'rect', 'quadraticCurveTo', 'bezierCurveTo', 'save', 'restore', 'translate', 'rotate', 'scale', 'clip', 'drawImage', 'setLineDash'
  ].forEach(function (m) {
    LegacyCanvasContext.prototype[m] = function () {
      var args = [].slice.call(arguments);
      this.ops.push(function (ctx) {
        if (m === 'drawImage' && typeof args[0] === 'string') {
          var img = new Image(); img.src = MP.sources.asset(args[0]);
          try { ctx.drawImage.apply(ctx, [img].concat(args.slice(1))); } catch (e) {}
          return;
        }
        ctx[m].apply(ctx, args);
      });
    };
  });
  var LEGACY_SETTERS = {
    setFillStyle: 'fillStyle', setStrokeStyle: 'strokeStyle', setLineWidth: 'lineWidth', setLineCap: 'lineCap',
    setLineJoin: 'lineJoin', setGlobalAlpha: 'globalAlpha', setTextAlign: 'textAlign', setTextBaseline: 'textBaseline',
    setShadow: null, setFontSize: null
  };
  Object.keys(LEGACY_SETTERS).forEach(function (m) {
    LegacyCanvasContext.prototype[m] = function () {
      var args = [].slice.call(arguments);
      this.ops.push(function (ctx) {
        if (m === 'setFontSize') ctx.font = args[0] + 'px sans-serif';
        else if (m === 'setShadow') { ctx.shadowOffsetX = args[0]; ctx.shadowOffsetY = args[1]; ctx.shadowBlur = args[2]; ctx.shadowColor = args[3]; }
        else ctx[LEGACY_SETTERS[m]] = args[0];
      });
    };
  });
  LegacyCanvasContext.prototype.measureText = function (t) { return this.canvas.getContext('2d').measureText(t); };
  LegacyCanvasContext.prototype.createLinearGradient = function () { var c = this.canvas.getContext('2d'); return c.createLinearGradient.apply(c, arguments); };
  LegacyCanvasContext.prototype.createCircularGradient = function (x, y, r) { return this.canvas.getContext('2d').createRadialGradient(x, y, 0, x, y, r); };
  LegacyCanvasContext.prototype.draw = function (reserve, done) {
    var canvas = this.canvas;
    var w = canvas.clientWidth || 300, h = canvas.clientHeight || 150;
    var dpr = global.devicePixelRatio || 1;
    var ctx = canvas.getContext('2d');
    if (!reserve) {
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
    }
    this.ops.forEach(function (op) { try { op(ctx); } catch (e) {} });
    this.ops = [];
    if (typeof done === 'function') setTimeout(done, 0);
  };

  // ---------------- 云开发（网页端不可用） ----------------
  var CLOUD_MSG = '网页预览版不连接微信云开发，请在小程序中使用该功能';
  var cloud = {
    DYNAMIC_CURRENT_ENV: 'web-preview',
    init: function () {},
    callFunction: api('cloud.callFunction', function (opts) {
      // 登录在网页端本地模拟，方便预览完整流程；其余云函数一律失败，走小程序自带的兜底提示
      if (opts.name === 'user-login') {
        var key = 'webUserOpenId';
        var openid = MP.storage.get(key);
        var isNew = !openid;
        if (!openid) { openid = 'web_' + Math.random().toString(36).slice(2, 10); MP.storage.set(key, openid); }
        var d = opts.data || {};
        return {
          result: {
            ok: true, isNew: isNew,
            user: {
              openid: openid, nickName: d.nickName || '网页预览用户', avatarUrl: d.avatarUrl || '', role: d.role || 'coach',
              firstLoginAt: new Date().toISOString(), lastLoginAt: new Date().toISOString(), loginCount: 1
            }
          }
        };
      }
      return Promise.reject(new Error(CLOUD_MSG));
    }),
    uploadFile: api('cloud.uploadFile', function () { return Promise.reject(new Error(CLOUD_MSG)); }),
    downloadFile: api('cloud.downloadFile', function () { return Promise.reject(new Error(CLOUD_MSG)); }),
    getTempFileURL: api('cloud.getTempFileURL', function () { return Promise.reject(new Error(CLOUD_MSG)); }),
    database: function () { throw new Error(CLOUD_MSG); }
  };

  // ---------------- wx 对象 ----------------
  var wx = {
    env: { USER_DATA_PATH: 'wxfile://usr' },
    cloud: cloud,

    // 存储
    getStorageSync: function (k) { return MP.storage.get(k); },
    setStorageSync: function (k, v) { MP.storage.set(k, v); },
    removeStorageSync: function (k) { MP.storage.remove(k); },
    clearStorageSync: function () { MP.storage.clear(); },
    getStorageInfoSync: function () { return { keys: MP.storage.keys(), currentSize: MP.storage.sizeKB(), limitSize: 10240 }; },
    getStorage: api('getStorage', function (o) { return { data: MP.storage.get(o.key) }; }),
    setStorage: api('setStorage', function (o) { MP.storage.set(o.key, o.data); }),
    removeStorage: api('removeStorage', function (o) { MP.storage.remove(o.key); }),
    clearStorage: api('clearStorage', function () { MP.storage.clear(); }),
    getStorageInfo: api('getStorageInfo', function () { return wx.getStorageInfoSync(); }),

    // 路由
    navigateTo: function (o) { router.navigateTo(o || {}); },
    redirectTo: function (o) { router.redirectTo(o || {}); },
    navigateBack: function (o) { router.navigateBack(o || {}); },
    switchTab: function (o) { router.switchTab(o || {}); },
    reLaunch: function (o) { router.reLaunch(o || {}); },

    // 界面反馈
    showToast: api('showToast', function (o) { showToast(o); }),
    hideToast: api('hideToast', function () { ui.toast = null; }),
    showLoading: api('showLoading', function (o) { ui.toast = null; ui.loading = { title: o.title || '', mask: !!o.mask }; }),
    hideLoading: api('hideLoading', function () { ui.loading = null; }),
    showModal: api('showModal', function (o) {
      return new Promise(function (resolve) {
        ui.modal = {
          title: o.title || '', content: o.content || '',
          showCancel: o.showCancel !== false,
          cancelText: o.cancelText || '取消', confirmText: o.confirmText || '确定',
          cancelColor: o.cancelColor || '', confirmColor: o.confirmColor || '',
          editable: !!o.editable, placeholderText: o.placeholderText || '', inputValue: '',
          resolve: function (confirm, content) {
            ui.modal = null;
            resolve({ confirm: !!confirm, cancel: !confirm, content: content });
          }
        };
      });
    }),
    showActionSheet: api('showActionSheet', function (o) {
      return new Promise(function (resolve, reject) {
        ui.actionSheet = {
          itemList: o.itemList || [], itemColor: o.itemColor || '', alertText: o.alertText || '',
          resolve: function (idx) {
            ui.actionSheet = null;
            if (idx == null) reject(new Error('cancel'));
            else resolve({ tapIndex: idx });
          }
        };
      });
    }),
    setNavigationBarTitle: api('setNavigationBarTitle', function (o) { var t = router.top(); if (t) t.__nav.title = o.title || ''; }),
    setNavigationBarColor: api('setNavigationBarColor', function (o) {
      var t = router.top();
      if (t) { if (o.backgroundColor) t.__nav.bg = o.backgroundColor; if (o.frontColor) t.__nav.fg = o.frontColor; }
    }),
    showNavigationBarLoading: function () {}, hideNavigationBarLoading: function () {},
    hideHomeButton: function () {},
    setBackgroundColor: function () {}, setBackgroundTextStyle: function () {},
    showShareMenu: function () {}, hideShareMenu: function () {}, updateShareMenu: function () {},
    stopPullDownRefresh: function () {}, startPullDownRefresh: function () {},
    pageScrollTo: api('pageScrollTo', function (o) {
      var root = MP.pageRoot(router.top());
      var sc = root && root.querySelector ? root.querySelector('.mp-page') : null;
      if (!sc) return;
      var top = o.scrollTop || 0;
      if (o.selector) {
        var el = sc.querySelector(o.selector);
        if (el) top = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop + (o.offsetTop || 0);
      }
      sc.scrollTo({ top: Math.min(top, sc.scrollHeight), behavior: o.duration === 0 ? 'auto' : 'smooth' });
    }),
    nextTick: function (fn) { Vue.nextTick(fn); },

    // 媒体
    chooseMedia: api('chooseMedia', function (o) {
      var types = o.mediaType || ['image', 'video'];
      var accept = types.indexOf('video') >= 0 && types.indexOf('image') < 0 ? 'video/*' : 'image/*';
      var camera = (o.sourceType || []).length === 1 && o.sourceType[0] === 'camera';
      return pickFiles(accept, o.count || 9, camera).then(function (files) {
        return Promise.all(files.map(function (f) {
          if (!/^image\//.test(f.type)) return { tempFilePath: URL.createObjectURL(f), size: f.size, fileType: 'video' };
          return fileToDataUrl(f).then(function (r) { return { tempFilePath: r.url, size: Math.round(r.url.length * 0.75), width: r.width, height: r.height, fileType: 'image' }; });
        })).then(function (list) { return { tempFiles: list, type: list[0] && list[0].fileType === 'video' ? 'video' : 'image' }; });
      });
    }),
    chooseImage: api('chooseImage', function (o) {
      var camera = (o.sourceType || []).length === 1 && o.sourceType[0] === 'camera';
      return pickFiles('image/*', o.count || 9, camera).then(function (files) {
        return Promise.all(files.map(function (f) { return fileToDataUrl(f); })).then(function (list) {
          return {
            tempFilePaths: list.map(function (x) { return x.url; }),
            tempFiles: list.map(function (x) { return { path: x.url, size: Math.round(x.url.length * 0.75) }; })
          };
        });
      });
    }),
    compressImage: api('compressImage', function (o) { return { tempFilePath: o.src }; }),
    getImageInfo: api('getImageInfo', function (o) {
      return loadImage(o.src).then(function (img) { return { width: img.naturalWidth, height: img.naturalHeight, path: o.src, type: 'jpeg', orientation: 'up' }; });
    }),
    previewImage: api('previewImage', function (o) {
      var urls = o.urls || [];
      ui.preview = { urls: urls.map(function (u) { return MP.sources.asset(u); }), index: Math.max(0, urls.indexOf(o.current)) };
    }),
    saveImageToPhotosAlbum: api('saveImageToPhotosAlbum', function (o) {
      var a = document.createElement('a');
      a.href = o.filePath;
      a.download = '宸炼-' + Date.now() + '.png';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      showToast({ title: '已下载到本地', icon: 'success' });
    }),
    saveFile: api('saveFile', function (o) { return { savedFilePath: o.tempFilePath }; }),
    getFileSystemManager: function () {
      return {
        readFile: api('readFile', function (o) {
          if (o.encoding === 'base64') return dataUrlToBase64(o.filePath).then(function (d) { return { data: d }; });
          return fetch(o.filePath).then(function (r) { return r.text(); }).then(function (t) { return { data: t }; });
        }),
        saveFile: api('saveFile', function (o) { return { savedFilePath: o.tempFilePath }; }),
        getFileInfo: api('getFileInfo', function (o) {
          var p = o.filePath || '';
          var size = /^data:/.test(p) ? Math.round((p.length - p.indexOf(',') - 1) * 0.75) : 0;
          return { size: size };
        }),
        writeFile: api('writeFile', function () {}),
        unlink: api('unlink', function () {}),
        access: api('access', function () {}),
        mkdir: api('mkdir', function () {}),
        readdir: api('readdir', function () { return { files: [] }; }),
        removeSavedFile: api('removeSavedFile', function () {})
      };
    },
    createCanvasContext: function (id, comp) {
      var c = findLegacyCanvas(id, comp);
      if (!c) { console.warn('[web] 找不到 canvas-id=' + id); c = document.createElement('canvas'); }
      return new LegacyCanvasContext(c);
    },
    canvasToTempFilePath: api('canvasToTempFilePath', function (o, comp) {
      var canvas = o.canvas || findLegacyCanvas(o.canvasId, comp);
      if (!canvas) throw new Error('canvas 不存在');
      var type = o.fileType === 'jpg' ? 'image/jpeg' : 'image/png';
      // x/y/width/height 是逻辑像素；页面通常把画布按 pixelRatio 放大过（node.width = W * dpr）
      var dpr = global.devicePixelRatio || 1;
      if (o.width != null && o.width * dpr > canvas.width + 1) dpr = 1;
      if (o.x != null || o.width != null || o.destWidth != null) {
        var sx = (o.x || 0) * dpr, sy = (o.y || 0) * dpr;
        var sw = (o.width != null ? o.width * dpr : canvas.width - sx);
        var sh = (o.height != null ? o.height * dpr : canvas.height - sy);
        var out = document.createElement('canvas');
        out.width = Math.round(o.destWidth || sw); out.height = Math.round(o.destHeight || sh);
        out.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);
        return { tempFilePath: out.toDataURL(type, o.quality || 0.92) };
      }
      return { tempFilePath: canvas.toDataURL(type, o.quality || 0.92) };
    }),
    createSelectorQuery: function () { return MP.createSelectorQuery(); },
    createIntersectionObserver: function () { return { relativeTo: function () { return this; }, relativeToViewport: function () { return this; }, observe: function () {}, disconnect: function () {} }; },
    createInnerAudioContext: function () {
      var a = new Audio();
      return { set src(v) { a.src = v; }, get src() { return a.src; }, play: function () { a.play().catch(function () {}); }, pause: function () { a.pause(); }, stop: function () { a.pause(); a.currentTime = 0; }, destroy: function () { a.pause(); }, onEnded: function (f) { a.onended = f; }, onError: function (f) { a.onerror = f; } };
    },

    // 设备 / 系统
    getSystemInfoSync: function () {
      var s = screenSize();
      return {
        brand: 'Web', model: 'Browser', pixelRatio: global.devicePixelRatio || 2,
        screenWidth: s.w, screenHeight: s.h, windowWidth: s.w, windowHeight: s.h,
        statusBarHeight: 20, language: 'zh_CN', version: '8.0.50', system: navigator.platform || 'Web',
        platform: 'web', SDKVersion: '3.14.3', theme: 'dark', safeArea: { top: 20, left: 0, right: s.w, bottom: s.h, width: s.w, height: s.h - 20 }
      };
    },
    getWindowInfo: function () { var s = wx.getSystemInfoSync(); return { pixelRatio: s.pixelRatio, screenWidth: s.screenWidth, screenHeight: s.screenHeight, windowWidth: s.windowWidth, windowHeight: s.windowHeight, statusBarHeight: 20, safeArea: s.safeArea }; },
    getDeviceInfo: function () { return { brand: 'Web', model: 'Browser', platform: 'web', system: navigator.platform || 'Web' }; },
    getAppBaseInfo: function () { return { SDKVersion: '3.14.3', language: 'zh_CN', version: '8.0.50', theme: 'dark' }; },
    getAccountInfoSync: function () { return { miniProgram: { appId: 'web-preview', envVersion: 'develop', version: '' } }; },
    getLaunchOptionsSync: function () { return { path: 'pages/cover/cover', query: {}, scene: 1001 }; },
    getMenuButtonBoundingClientRect: function () { var s = screenSize(); return { width: 87, height: 32, top: 26, bottom: 58, left: s.w - 94, right: s.w - 7 }; },
    canIUse: function () { return true; },
    getSystemSetting: function () { return {}; },
    onAppShow: function () {}, onAppHide: function () {}, offAppShow: function () {}, offAppHide: function () {},
    onMemoryWarning: function () {}, onError: function () {}, onUnhandledRejection: function () {},
    getUpdateManager: function () { return { onCheckForUpdate: function () {}, onUpdateReady: function () {}, onUpdateFailed: function () {}, applyUpdate: function () {} }; },
    reportAnalytics: function () {}, reportEvent: function () {},
    vibrateShort: api('vibrateShort', function () { if (navigator.vibrate) navigator.vibrate(15); }),
    vibrateLong: api('vibrateLong', function () { if (navigator.vibrate) navigator.vibrate(400); }),
    setKeepScreenOn: api('setKeepScreenOn', function (o) {
      try {
        if (o.keepScreenOn && navigator.wakeLock) navigator.wakeLock.request('screen').then(function (l) { wx.__wakeLock = l; }).catch(function () {});
        else if (wx.__wakeLock) { wx.__wakeLock.release(); wx.__wakeLock = null; }
      } catch (e) {}
    }),
    setScreenBrightness: api('setScreenBrightness', function () {}),
    makePhoneCall: api('makePhoneCall', function (o) {
      return wx.showModal({ title: '拨打电话', content: o.phoneNumber, confirmText: '拨打' }).then(function (r) {
        if (r.confirm) global.location.href = 'tel:' + o.phoneNumber;
      });
    }),
    setClipboardData: api('setClipboardData', function (o) {
      var text = String(o.data == null ? '' : o.data);
      function fallback() {
        var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta);
      }
      var p = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(text).catch(fallback) : Promise.resolve(fallback());
      return p.then(function () { showToast({ title: '内容已复制', icon: 'none' }); });
    }),
    getClipboardData: api('getClipboardData', function () {
      if (!navigator.clipboard || !navigator.clipboard.readText) throw new Error('浏览器不允许读取剪贴板');
      return navigator.clipboard.readText().then(function (t) { return { data: t }; });
    }),
    openSetting: api('openSetting', function () { showToast({ title: '网页端无需授权设置', icon: 'none' }); return { authSetting: {} }; }),
    getSetting: api('getSetting', function () { return { authSetting: {} }; }),
    authorize: api('authorize', function () {}),
    login: api('login', function () { return { code: 'web-preview' }; }),
    checkSession: api('checkSession', function () {}),
    getUserProfile: api('getUserProfile', function () { throw new Error('网页端不支持获取微信资料'); }),
    getUserInfo: api('getUserInfo', function () { throw new Error('网页端不支持获取微信资料'); }),
    requestSubscribeMessage: api('requestSubscribeMessage', function () { throw new Error('网页端不支持订阅消息'); }),
    request: api('request', function (o) {
      var method = (o.method || 'GET').toUpperCase();
      var headers = Object.assign({}, o.header || {});
      var body;
      if (method !== 'GET' && o.data != null) {
        body = typeof o.data === 'string' ? o.data : JSON.stringify(o.data);
        if (!headers['content-type'] && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
      }
      var url = o.url;
      if (method === 'GET' && o.data && typeof o.data === 'object') {
        var qs = Object.keys(o.data).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(o.data[k]); }).join('&');
        if (qs) url += (url.indexOf('?') >= 0 ? '&' : '?') + qs;
      }
      return fetch(url, { method: method, headers: headers, body: body }).then(function (r) {
        return r.text().then(function (t) {
          var data = t;
          if (o.dataType !== '其他') { try { data = JSON.parse(t); } catch (e) {} }
          var header = {}; r.headers.forEach(function (v, k) { header[k] = v; });
          return { data: data, statusCode: r.status, header: header };
        });
      }, function () { throw new Error('网络请求失败（网页端受浏览器跨域限制）'); });
    }),
    uploadFile: api('uploadFile', function () { throw new Error('网页端不支持 uploadFile'); }),
    downloadFile: api('downloadFile', function (o) { return { tempFilePath: o.url, statusCode: 200 }; })
  };

  // createCanvasContext / canvasToTempFilePath 第二个参数是组件实例（this）
  var rawC2T = wx.canvasToTempFilePath;
  wx.canvasToTempFilePath = function (o, comp) {
    if (o && !o.canvas && o.canvasId) {
      var c = findLegacyCanvas(o.canvasId, comp);
      if (c) { c.__legacy = true; o = Object.assign({}, o, { canvas: c }); }
    }
    return rawC2T(o);
  };

  MP.wx = wx;
  MP.showToast = showToast;
})(window);
