/**
 * 网页端 · 预览外壳 + 启动流程
 *
 * 启动：读源码 → 注入 wx/App/Page 全局 → 执行 app.js（onLaunch）→ 打开首页（或 URL hash 指定的页面）
 * 外壳：左侧页面目录 / 中间手机 / 右侧调试面板（当前页 data、页面栈、本地存储、运行时错误）
 */
(function (global) {
  'use strict';
  var MP = global.MP;
  var Vue = global.Vue;
  var router = MP.router;
  var ui = MP.ui;

  // 页面目录（name 为空时用页面 json 的标题）；need 表示需要参数，sample() 从本地数据里找一个可用参数
  function firstId(key, field) {
    var list = MP.storage.get(key);
    if (!Array.isArray(list) || !list.length) return '';
    return list[0][field || 'id'] || '';
  }
  var DIRECTORY = [
    { title: '启动', items: [
      { route: 'pages/cover/cover', name: '启动封面' },
      { route: 'pages/login/login', name: '登录' }
    ] },
    { title: '五个 Tab', items: [
      { route: 'pages/index/index', name: '首页' },
      { route: 'pages/trainees/trainees', name: '学员' },
      { route: 'pages/schedule/schedule', name: '日程安排' },
      { route: 'pages/courses/courses', name: '定制课程' },
      { route: 'pages/plans/plans', name: '饮食' }
    ] },
    { title: '学员', items: [
      { route: 'pages/trainee-detail/trainee-detail', name: '学员详情', sample: function () { var id = firstId('trainees'); return id ? 'id=' + id : null; } },
      { route: 'pages/student-view/student-view', name: '学员视角预览', sample: function () { var id = firstId('trainees'); return id ? 'traineeId=' + id : null; } },
      { route: 'pages/student-bind/student-bind', name: '学员绑定邀请码' }
    ] },
    { title: '排课与课程', items: [
      { route: 'pages/schedule-edit/schedule-edit', name: '私教排课', sample: function () { return 'multi=1&date=' + MP.today(); } },
      { route: 'pages/schedule-detail/schedule-detail', name: '私教课详情', sample: function () { var id = firstId('schedules'); return id ? 'id=' + id : null; } },
      { route: 'pages/plan-cycle/plan-cycle', name: '多周训练计划' },
      { route: 'pages/schedule-history/schedule-history', name: '历史计划' },
      { route: 'pages/template-list/template-list', name: '模版库' },
      { route: 'pages/ai-course/ai-course', name: 'AI 定制课程' },
      { route: 'pages/courses/detail', name: '课程详情', sample: function () { return 'id=5'; } },
      { route: 'pages/course-edit/course-edit', name: '新建课程' }
    ] },
    { title: '训练', items: [
      { route: 'pages/course-training/course-training', name: '训练模式', sample: function () { return 'id=5'; } },
      { route: 'pages/quick-log/quick-log', name: '自由训练' },
      { route: 'pages/training-stats/training-stats', name: '训练日历' },
      { route: 'pages/training-stats/detail', name: '场次详情', sample: function () { var id = firstId('trainingSessions'); return id ? 'id=' + id : null; } },
      { route: 'pages/monthly-report/monthly-report', name: '月度报告' },
      { route: 'pages/share-poster/share-poster', name: '周成果 / 每日计划海报', sample: function () { var id = firstId('schedules'); return id ? 'scheduleId=' + id : 'type=weekly'; } },
      { route: 'pages/exercise-library/exercise-library', name: '动作库' },
      { route: 'pages/exercise-detail/exercise-detail', name: '动作详情', sample: function () { return 'name=' + encodeURIComponent('杠铃深蹲'); } }
    ] },
    { title: '饮食', items: [
      { route: 'pages/food-search/food-search', name: '搜索食物', sample: function () { return 'meal=lunch&date=' + MP.today(); } },
      { route: 'pages/my-foods/my-foods', name: '我的食物' },
      { route: 'pages/diet-targets/diet-targets', name: '摄入目标' },
      { route: 'pages/diet-packages/diet-packages', name: '饮食套餐' },
      { route: 'pages/diet-vision-settings/diet-vision-settings', name: '识别接口设置' }
    ] },
    { title: '体测', items: [
      { route: 'pages/body-stats/body-stats', name: '我的体测' },
      { route: 'pages/body-stats-edit/body-stats-edit', name: '体测录入' }
    ] },
    { title: '其他', items: [
      { route: 'pages/coach-edit/coach-edit', name: '教练资料' },
      { route: 'pages/help/help', name: '使用说明' },
      { route: 'pages/about/about', name: '关于' }
    ] }
  ];

  MP.today = function () {
    var d = new Date();
    var p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  };

  // ---------------- 外壳组件 ----------------
  var PickerSheet = {
    props: ['cfg'],
    data: function () { return { cols: this.cfg.columns.map(function (c) { return c.slice(); }), vals: this.cfg.values.slice() }; },
    mounted: function () { this.syncScroll(false); },
    methods: {
      syncScroll: function (smooth) {
        var vm = this;
        Vue.nextTick(function () {
          (vm.$refs.col || []).forEach(function (el, i) { el.scrollTo({ top: (vm.vals[i] || 0) * 48, behavior: smooth ? 'smooth' : 'auto' }); });
        });
      },
      onScroll: function (i, ev) {
        var vm = this;
        clearTimeout(this['t' + i]);
        this['t' + i] = setTimeout(function () {
          var idx = Math.max(0, Math.min(vm.cols[i].length - 1, Math.round(ev.target.scrollTop / 48)));
          if (vm.vals[i] === idx) return;
          vm.vals[i] = idx;
          if (vm.cfg.onColumn) vm.cfg.onColumn(i, idx);
          if (vm.cfg.adjust && i < 2) {
            var adj = vm.cfg.adjust(vm.vals);
            if (adj) {
              vm.cols[adj.col] = adj.items;
              if (vm.vals[adj.col] >= adj.items.length) { vm.vals[adj.col] = adj.items.length - 1; vm.syncScroll(true); }
            }
          }
        }, 90);
      },
      pick: function (i, j) { this.vals[i] = j; this.syncScroll(true); var ev = { target: { scrollTop: j * 48 } }; this.onScroll(i, ev); },
      ok: function () { this.cfg.confirm(this.vals.slice()); }
    },
    template:
      '<div class="wb-sheet">' +
      '  <div class="wb-picker-bar"><button @click="cfg.cancel()">取消</button><span class="wb-picker-title">{{ cfg.title }}</span><button class="is-confirm" @click="ok">确定</button></div>' +
      '  <div class="wb-picker-cols">' +
      '    <div class="wb-picker-col" v-for="(col, i) in cols" :key="i" ref="col" @scroll="onScroll(i, $event)">' +
      '      <div class="wb-picker-opt" v-for="(o, j) in col" :key="j" :class="{ \'is-on\': vals[i] === j }" @click="pick(i, j)">{{ o }}</div>' +
      '    </div>' +
      '  </div>' +
      '</div>'
  };

  var Shell = {
    components: { PickerSheet: PickerSheet },
    data: function () {
      return {
        ui: ui, router: router, stack: router.stack, alive: router.alive, leaving: router.leaving,
        directory: DIRECTORY, tab: 'page', clock: '', drawer: false, inspector: false, modalInput: '',
        mode: MP.sources.mode, storageVer: MP.storage.version, previewIdx: 0, tick: 0,
        // ?embed=1：只渲染手机屏幕（嵌入其他页面 / 截图用）
        embed: /[?&]embed=1\b/.test(location.search)
      };
    },
    computed: {
      top: function () { return this.stack[this.stack.length - 1] || null; },
      nav: function () { return this.top ? this.top.__nav : { title: '', bg: '#000', fg: '#fff', custom: false }; },
      tabBar: function () { return (router.appConfig && router.appConfig.tabBar) || null; },
      isTabPage: function () { return !!(this.top && this.tabBar && router.isTab(this.top.route)); },
      canBack: function () { return this.stack.length > 1; },
      rendered: function () {
        var list = this.alive.slice();
        this.leaving.forEach(function (p) { if (list.indexOf(p) < 0) list.push(p); });
        return list;
      },
      pageData: function () {
        this.tick; // 依赖刷新
        if (!this.top) return [];
        var d = this.top.data;
        return Object.keys(d).map(function (k) {
          var text;
          try { text = JSON.stringify(Vue.toRaw(d[k]), null, 2); } catch (e) { text = String(d[k]); }
          if (text && text.length > 6000) text = text.slice(0, 6000) + '\n…（已截断）';
          var t = Array.isArray(d[k]) ? 'Array(' + d[k].length + ')' : (d[k] === null ? 'null' : typeof d[k]);
          return { key: k, type: t, text: text };
        });
      },
      storageList: function () {
        void this.storageVer;
        return MP.storage.keys().map(function (k) {
          var raw = localStorage.getItem(MP.storage.prefix + k) || '';
          return { key: k, size: raw.length > 1024 ? (raw.length / 1024).toFixed(1) + ' KB' : raw.length + ' B', raw: raw };
        });
      }
    },
    created: function () {
      var vm = this;
      var tickClock = function () { var d = new Date(); vm.clock = d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes(); };
      tickClock(); setInterval(tickClock, 15000);
      setInterval(function () { if (vm.tab === 'page') vm.tick++; }, 1200);
    },
    methods: {
      asset: function (p) { return MP.sources.asset(p); },
      routeTitle: function (item) {
        var cfg = MP.sources.json(item.route + '.json') || {};
        return item.name || cfg.navigationBarTitleText || item.route;
      },
      sampleQuery: function (item) { return item.sample ? item.sample() : ''; },
      openRoute: function (item) {
        this.drawer = false;
        var q = this.sampleQuery(item);
        if (item.sample && q == null) { MP.showToast({ title: '先载入演示数据或新建一条记录', icon: 'none' }); return; }
        var url = '/' + item.route + (q ? '?' + q : '');
        if (router.isTab(item.route)) MP.wx.switchTab({ url: url });
        else if (item.route === 'pages/cover/cover' || item.route === 'pages/login/login') MP.wx.reLaunch({ url: url });
        else MP.wx.navigateTo({ url: url });
      },
      back: function () { MP.wx.navigateBack({ delta: 1 }); },
      home: function () { MP.wx.reLaunch({ url: '/' + router.appConfig.pages[0] }); },
      tabColor: function (item) { return this.top && this.top.route === item.pagePath ? this.tabBar.selectedColor : this.tabBar.color; },
      tabIcon: function (item) { return this.asset(this.top && this.top.route === item.pagePath ? item.selectedIconPath : item.iconPath); },
      switchTab: function (item) { MP.wx.switchTab({ url: '/' + item.pagePath }); },
      wrapClass: function (p) { var a = p.__anim.value; return a ? 'anim-' + a : ''; },
      pageBg: function (p) { return p.__config.backgroundColor || '#000'; },
      modalOk: function () { var m = ui.modal; var v = this.modalInput; this.modalInput = ''; m.resolve(true, v); },
      modalCancel: function () { var m = ui.modal; this.modalInput = ''; m.resolve(false); },
      sheetPick: function (i) { ui.actionSheet.resolve(i); },
      sheetCancel: function () { ui.actionSheet.resolve(null); },
      dismissError: function (e) { var i = ui.errors.indexOf(e); if (i >= 0) ui.errors.splice(i, 1); },
      loadDemo: function () {
        if (!confirm('载入演示数据会覆盖当前网页端的本地数据（学员、排课、训练、饮食、体测），继续？')) return;
        MP.demo.seed();
        MP.wx.reLaunch({ url: '/pages/index/index' });
        MP.showToast({ title: '演示数据已载入', icon: 'success' });
      },
      resetAll: function () {
        if (!confirm('清空网页端全部本地数据，回到「首次安装」状态？')) return;
        MP.storage.clear();
        MP.storage.set('webVisited', Date.now());   // 否则刷新后又会自动载入演示数据
        location.hash = '';
        location.reload();
      },
      exportData: function () {
        var blob = new Blob([JSON.stringify({ app: 'chenlian-web', exportedAt: new Date().toISOString(), storage: MP.storage.snapshot() }, null, 2)], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = '宸炼-网页端数据-' + MP.today() + '.json';
        a.click();
      },
      importData: function () {
        var input = document.createElement('input');
        input.type = 'file'; input.accept = 'application/json,.json';
        input.onchange = function () {
          var f = input.files && input.files[0];
          if (!f) return;
          f.text().then(function (t) {
            var obj = JSON.parse(t);
            var data = obj.storage || obj;
            MP.storage.clear();
            Object.keys(data).forEach(function (k) { MP.storage.set(k, data[k]); });
            location.reload();
          }).catch(function (e) { alert('导入失败：' + e.message); });
        };
        input.click();
      },
      delKey: function (k) { if (confirm('删除本地存储 ' + k + '？')) MP.storage.remove(k); },
      prettyRaw: function (raw) { try { var t = JSON.stringify(JSON.parse(raw), null, 2); return t.length > 8000 ? t.slice(0, 8000) + '\n…（已截断）' : t; } catch (e) { return raw; } },
      queryText: function (p) { var q = p.options || {}; var s = Object.keys(q).map(function (k) { return k + '=' + q[k]; }).join('&'); return s || '—'; },
      previewMove: function (d) { var p = ui.preview; p.index = (p.index + d + p.urls.length) % p.urls.length; }
    },
    template: '#wb-shell-template'
  };

  // ---------------- 启动 ----------------
  function fatal(html) {
    document.getElementById('wb-root').innerHTML = '<div class="wb-fatal">' + html + '</div>';
  }

  MP.boot = function () {
    MP.sources.init().then(function (ok) {
      if (!ok) {
        fatal('<h2>没有找到小程序源码</h2>' +
          '方式一（推荐，修改小程序代码后刷新即同步）：在项目根目录运行 <code>python3 -m http.server 8080</code>，然后打开 <code>http://localhost:8080/web/</code><br>' +
          '方式二（直接双击打开 / 部署静态网站）：先运行 <code>python3 web/build.py</code> 生成 <code>web/dist/mp-bundle.js</code>，再打开 <code>web/index.html</code>');
        return;
      }
      // 便于自动化测试 / 排查：<html data-mp-mode="live|bundle">
      document.documentElement.setAttribute('data-mp-mode', MP.sources.mode);
      router.appConfig = MP.sources.json('app.json') || { pages: [] };
      router.tabRoutes = ((router.appConfig.tabBar && router.appConfig.tabBar.list) || []).map(function (t) { return MP.util.normPath(t.pagePath); });

      var wx = MP.wx;
      MP.modules.globals = { wx: wx, App: MP.App, Page: MP.Page, getApp: MP.getApp, getCurrentPages: MP.getCurrentPages, Component: MP.Component, Behavior: MP.Behavior };
      global.wx = wx; global.getApp = MP.getApp; global.getCurrentPages = MP.getCurrentPages;

      // rpx 换算依据：手机屏幕宽度（桌面固定 390；手机浏览器全屏 = 窗口宽）
      var embed = /[?&]embed=1\b/.test(location.search);
      var screenWidth = function () { return (!embed && global.matchMedia('(max-width: 760px)').matches) ? global.innerWidth : 390; };
      MP.setScreenWidth(screenWidth());
      global.addEventListener('resize', function () { MP.setScreenWidth(screenWidth()); });
      MP.injectAppStyle();

      // ?fresh=1：清空本地数据，按「全新安装」启动（看开屏 / 登录流程）；处理完把参数从地址栏去掉，刷新不会再清
      if (/[?&]fresh=1\b/.test(location.search)) {
        MP.storage.clear();
        MP.storage.set('webVisited', Date.now());
        try { history.replaceState(null, '', location.pathname + location.search.replace(/([?&])fresh=1\b&?/, '$1').replace(/[?&]$/, '') + location.hash); } catch (e) {}
      }
      // 首次打开网页端：自动载入演示数据，直接进首页，方便预览（可在侧栏「清空数据」体验全新安装流程）
      var firstVisit = !MP.storage.get('webVisited');
      try {
        MP.modules.require('app.js');
        var app = MP.appInstance;
        if (app && typeof app.onLaunch === 'function') app.onLaunch({ path: router.appConfig.pages[0], query: {}, scene: 1001 });
        if (app && typeof app.onShow === 'function') app.onShow({ path: router.appConfig.pages[0], query: {}, scene: 1001 });
      } catch (e) {
        MP.reportError(e, 'app.js');
      }

      var vueApp = Vue.createApp(Shell);
      vueApp.config.compilerOptions.isCustomElement = function (tag) { return tag === 'view' || tag === 'text'; };
      vueApp.config.errorHandler = function (err, vm, info) { MP.reportError(err, '渲染 ' + (info || '')); };
      MP.installComponents(vueApp);
      document.getElementById('wb-root').innerHTML = '';
      vueApp.mount('#wb-root');

      setTimeout(function () {
        if (firstVisit) {
          MP.storage.set('webVisited', Date.now());
          try { MP.demo.seed(); } catch (e) { MP.reportError(e, '演示数据'); }
        }
        // 注意不要 decode：hash 里的查询参数保持编码原样，交给页面自己 decodeURIComponent（与小程序一致）
        var hash = location.hash.replace(/^#\/?/, '');
        var startUrl = '/' + router.appConfig.pages[0];
        if (hash && MP.sources.has(MP.util.parseUrl(hash).path + '.js')) startUrl = '/' + hash;
        else if (firstVisit) startUrl = '/pages/index/index';
        MP.wx.reLaunch({ url: startUrl });
      }, 30);
    }).catch(function (e) {
      console.error(e);
      fatal('<h2>启动失败</h2><code>' + String(e && e.message || e) + '</code>');
    });
  };
})(window);
