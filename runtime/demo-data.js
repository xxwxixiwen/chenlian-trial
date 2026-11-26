/**
 * 网页端演示数据
 *
 * 数据通过小程序自己的工具模块生成（default-course-plans / schedule-plan / diet-calc），
 * 字段结构与真机完全一致，日期全部相对「今天」计算，任何时候载入都是新鲜的。
 * 只在网页端使用，不会进入小程序包（project.config.json 已忽略 web/ 目录）。
 */
(function (global) {
  'use strict';
  var MP = global.MP;

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function fmt(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function dayOffset(n) { var d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d; }
  // 固定种子的伪随机：每次载入结果一致，便于截图对比
  var seedVal = 7;
  function rnd() { seedVal = (seedVal * 16807) % 2147483647; return (seedVal - 1) / 2147483646; }

  var TRAINEES = [
    { name: '林晓雨', gender: '女', age: '28', height: '163', weight: '61.5', level: '初级', coursePackage: '24节正式课', target: '减脂 5kg、改善久坐腰酸', note: '久坐办公，下背偶有不适', goal: '减脂', plan: ['7', '2'], times: ['19:00', '19:30'], lastDays: -2, nextDays: 1 },
    { name: '陈浩然', gender: '男', age: '31', height: '178', weight: '74.2', level: '中级', coursePackage: '48节正式课', target: '增肌 4kg，卧推突破 80kg', note: '', goal: '增肌', plan: ['5', '12'], times: ['07:30', '20:00'], lastDays: -1, nextDays: 0 },
    { name: '王思琪', gender: '女', age: '25', height: '166', weight: '52.0', level: '初级', coursePackage: '12节正式课', target: '体态矫正：圆肩驼背', note: '颈肩紧张', goal: '体态', plan: ['4', '6'], times: ['18:30'], lastDays: -3, nextDays: 2 },
    { name: '赵一鸣', gender: '男', age: '42', height: '172', weight: '81.0', level: '初级', coursePackage: '36节正式课', target: '膝关节术后康复，恢复跑步', note: '右膝半月板术后 6 个月', goal: '康复', plan: ['9'], times: ['10:00'], lastDays: -24, nextDays: null },
    { name: '刘佳怡', gender: '女', age: '34', height: '160', weight: '58.3', level: '中级', coursePackage: '8节正式课', target: '产后塑形、核心力量', note: '', goal: '减脂', plan: ['10', '2'], times: ['15:00'], lastDays: -5, nextDays: 3 },
    { name: '孙博文', gender: '男', age: '22', height: '183', weight: '68.0', level: '初级', coursePackage: '9.9元体验课', target: '体验课，了解训练', note: '', goal: '其他', plan: ['1'], times: ['21:00'], lastDays: null, nextDays: 4 }
  ];

  var COACH_SESSIONS = [
    // [几天前, 时:分, 课程标题, [[动作, 组数, 重量, 次数], ...]]
    [-40, '07:10', '增肌力量课', [['杠铃深蹲', 4, 80, 8], ['杠铃卧推', 4, 62.5, 8], ['杠铃划船', 3, 55, 10]]],
    [-37, '07:05', '上肢推拉', [['杠铃卧推', 4, 65, 8], ['引体向上', 4, 0, 8], ['哑铃推举（坐姿）', 3, 22, 10]]],
    [-33, '06:55', '增肌力量课', [['杠铃深蹲', 4, 82.5, 8], ['罗马尼亚硬拉', 3, 90, 8], ['杠铃划船', 3, 57.5, 10]]],
    [-30, '07:20', '上肢推拉', [['杠铃卧推', 4, 65, 9], ['高位下拉', 4, 60, 10], ['哑铃推举（坐姿）', 3, 22, 11]]],
    [-26, '07:00', '增肌力量课', [['杠铃深蹲', 5, 85, 6], ['杠铃卧推', 4, 67.5, 8], ['杠铃划船', 3, 60, 8]]],
    [-22, '19:40', '下肢力量', [['杠铃深蹲', 4, 87.5, 6], ['罗马尼亚硬拉', 3, 95, 8], ['保加利亚分腿蹲', 3, 16, 10]]],
    [-19, '07:10', '上肢推拉', [['杠铃卧推', 4, 70, 6], ['引体向上', 4, 5, 7], ['哑铃推举（坐姿）', 3, 24, 9]]],
    [-15, '07:00', '增肌力量课', [['杠铃深蹲', 4, 90, 6], ['杠铃卧推', 4, 70, 7], ['杠铃划船', 4, 60, 10]]],
    [-12, '20:10', '下肢力量', [['杠铃深蹲', 5, 90, 5], ['罗马尼亚硬拉', 4, 100, 6], ['保加利亚分腿蹲', 3, 18, 10]]],
    [-8, '07:05', '上肢推拉', [['杠铃卧推', 5, 72.5, 5], ['高位下拉', 4, 65, 10], ['哑铃推举（坐姿）', 3, 24, 10]]],
    [-5, '07:15', '增肌力量课', [['杠铃深蹲', 4, 92.5, 5], ['杠铃卧推', 4, 72.5, 6], ['杠铃划船', 4, 62.5, 8]]],
    [-2, '19:50', '下肢力量', [['杠铃深蹲', 5, 95, 4], ['罗马尼亚硬拉', 4, 105, 5], ['保加利亚分腿蹲', 3, 20, 10]]],
    [-1, '07:00', '上肢推拉', [['杠铃卧推', 5, 75, 5], ['引体向上', 4, 7.5, 6], ['哑铃推举（坐姿）', 3, 26, 8]]]
  ];

  var MEALS = {
    breakfast: [['燕麦', 50], ['鸡蛋', 100], ['牛奶', 250]],
    lunch: [['米饭', 180], ['鸡胸肉', 150], ['西兰花', 150]],
    dinner: [['红薯', 150], ['三文鱼', 120], ['菠菜', 150]],
    snack: [['香蕉', 120], ['酸奶', 150]]
  };

  function seed() {
    seedVal = 7;
    var st = MP.storage;
    var req = function (p) { return MP.modules.require(p); };
    var schedulePlan = req('utils/schedule-plan.js');
    var dietCalc = req('utils/diet-calc.js');
    var coursePlans = req('utils/default-course-plans.js');
    var now = Date.now();

    // 教练 + 登录态 + 已看过开屏
    st.set('coach', { name: '李锐', phone: '13800138000', gym: '宸炼健身 · 滨江店', intro: '国家职业健身教练 · 擅长增肌减脂与体态矫正', avatarUrl: '' });
    st.set('currentUser', { openid: 'web_demo_coach', nickName: '李锐', avatarUrl: '', role: 'coach', firstLoginAt: new Date(now - 90 * 864e5).toISOString(), lastLoginAt: new Date().toISOString(), loginCount: 42 });
    st.set('coverSeenAt', now);

    // 学员
    var trainees = TRAINEES.map(function (t, i) {
      var join = dayOffset(-120 + i * 13);
      var bodyData = [];
      for (var k = 0; k < 3; k++) {
        bodyData.push({
          date: fmt(dayOffset(-60 + k * 28)),
          weight: String(Math.round((parseFloat(t.weight) + (2 - k) * 0.9) * 10) / 10),
          bodyFat: t.gender === '女' ? String(29 - k * 1.2) : String(21 - k * 1.1)
        });
      }
      bodyData.sort(function (a, b) { return b.date.localeCompare(a.date); });
      return {
        id: 'demo_t' + (i + 1), name: t.name, phone: '138' + pad(10 + i) + '00' + pad(20 + i * 7) + pad(i),
        status: t.lastDays !== null && t.lastDays < -20 ? 'paused' : 'active',
        level: t.level, joinDate: fmt(join), startDate: fmt(join), endDate: fmt(dayOffset(60 + i * 10)),
        target: t.target, note: t.note, bodyData: bodyData, avatarUrl: '', gender: t.gender,
        coursePackage: t.coursePackage, age: t.age, height: t.height, weight: t.weight
      };
    });
    // 赵一鸣保持「在练」，好让教学看板出现「断练跟进」
    trainees[3].status = 'active';
    st.set('trainees', trainees);

    // 课程（保留 app.js 初始化的内置课程）
    var courses = st.get('courses') || [];
    function courseById(id) { return courses.find(function (c) { return c.id === id; }) || coursePlans.applyPlan({ id: id, title: '训练课', duration: 60 }); }

    // 排课：过去 3 周 + 未来 2 周
    var schedules = [];
    TRAINEES.forEach(function (t, i) {
      var tr = trainees[i];
      var days = [];
      if (t.lastDays !== null) {
        if (t.lastDays > -20) { for (var d = t.lastDays; d >= -21; d -= (i % 2 ? 4 : 3)) days.push(d); }
        else days.push(t.lastDays, t.lastDays - 4, t.lastDays - 8);
      }
      if (t.nextDays !== null) days.push(t.nextDays, t.nextDays + 4, t.nextDays + 8);
      days.forEach(function (off, k) {
        var c = courseById(t.plan[k % t.plan.length]);
        var phases = schedulePlan.normalizeIncomingPlanPhases(schedulePlan.getPlanPhasesFromCourse(c));
        var flat = schedulePlan.flattenLegacy(phases);
        var s = {
          id: 'demo_s' + (i + 1) + '_' + k,
          date: fmt(dayOffset(off)), time: t.times[k % t.times.length],
          courseId: c.id, courseTitle: c.title, duration: c.duration || 60,
          traineeId: tr.id, traineeName: tr.name, venue: '宸炼健身 · 滨江店',
          goal: t.goal, bodyPart: '', planPhases: phases,
          exerciseIds: flat.exerciseIds, exerciseNames: flat.exerciseNames
        };
        if (off < 0) s.completedAt = dayOffset(off).getTime() + 20 * 3600e3;
        schedules.push(s);
      });
    });
    st.set('schedules', schedules);

    // 教练自训：训练场次 + 按动作历史（PR 数据源）
    var sessions = [];
    var byEx = {};
    COACH_SESSIONS.forEach(function (row, i) {
      var hm = row[1].split(':');
      var start = dayOffset(row[0]); start.setHours(+hm[0], +hm[1], 0, 0);
      var startedAt = start.getTime();
      var sid = 'sess_demo_' + (i + 1);
      var volume = 0, setsDone = 0, ts = startedAt;
      var exercises = row[3].map(function (ex, order) {
        var sets = [];
        for (var k = 1; k <= ex[1]; k++) {
          ts += 150000 + Math.round(rnd() * 60000);
          var reps = ex[3] - (k === ex[1] && rnd() > 0.5 ? 1 : 0);
          sets.push({ set: k, weight: String(ex[2]), reps: String(reps), ts: ts });
          volume += ex[2] * reps; setsDone++;
          (byEx[ex[0]] = byEx[ex[0]] || []).unshift({ ts: ts, weight: String(ex[2]), reps: String(reps), courseId: '5', sessionId: sid, set: k });
        }
        return { name: ex[0], order: order + 1, plannedSets: ex[1], sets: sets };
      });
      sessions.unshift({
        id: sid, courseId: '5', courseTitle: row[2], startedAt: startedAt, endedAt: ts + 60000,
        durationSec: Math.round((ts + 60000 - startedAt) / 1000), stepCount: exercises.length + 4, mainCount: exercises.length,
        setsDone: setsDone, totalVolume: Math.round(volume), exercises: exercises, synced: false
      });
    });
    // 带学员上过的课：为已完成的排课生成训练场次（带 traineeId，学员详情「训练记录」里能看到，不计入教练自训）
    schedules.forEach(function (sc) {
      if (!sc.completedAt) return;
      var hm2 = String(sc.time || '18:00').split(':');
      var parts = sc.date.split('-');
      var start = new Date(+parts[0], +parts[1] - 1, +parts[2], +hm2[0], +hm2[1]).getTime();
      var sid2 = 'sess_demo_' + sc.id;
      var main = (sc.planPhases || []).find(function (p) { return p.key === 'main'; }) || { items: [] };
      var vol = 0, done = 0, t = start + 8 * 60000;
      var exs = main.items.slice(0, 4).map(function (it, order) {
        var rows = it.rows && it.rows.length ? it.rows : [{ weight: it.weight, reps: it.reps }];
        var sets = rows.map(function (r, k) {
          t += 150000;
          var w = parseFloat(r.weight) || 0, rp = parseInt(r.reps, 10) || 10;
          vol += w * rp; done++;
          (byEx[it.name] = byEx[it.name] || []).push({ ts: t, weight: String(w || ''), reps: String(rp), courseId: sc.courseId, sessionId: sid2, set: k + 1, traineeId: sc.traineeId });
          return { set: k + 1, weight: String(w || ''), reps: String(rp), ts: t };
        });
        return { name: it.name, order: order + 1, plannedSets: rows.length, sets: sets };
      });
      if (!done) return;
      sessions.push({
        id: sid2, courseId: sc.courseId, courseTitle: sc.courseTitle, scheduleId: sc.id,
        traineeId: sc.traineeId, traineeName: sc.traineeName,
        startedAt: start, endedAt: t + 5 * 60000, durationSec: Math.round((t + 5 * 60000 - start) / 1000),
        stepCount: exs.length + 4, mainCount: exs.length, setsDone: done, totalVolume: Math.round(vol), exercises: exs, synced: false
      });
      sc.sessionId = sid2;
      sc.completedAt = t + 5 * 60000;
    });
    st.set('schedules', schedules);
    sessions.sort(function (a, b) { return b.startedAt - a.startedAt; });

    Object.keys(byEx).forEach(function (k) { byEx[k].sort(function (a, b) { return b.ts - a.ts; }); });
    st.set('trainingSessions', sessions);
    st.set('trainingHistoryByExercise', byEx);
    st.remove('trainingInProgress');

    // 饮食：近 7 天（今天只到午餐）
    var log = {};
    for (var d = -6; d <= 0; d++) {
      var day = { breakfast: [], lunch: [], dinner: [], snack: [] };
      Object.keys(MEALS).forEach(function (meal) {
        if (d === 0 && (meal === 'dinner' || meal === 'snack')) return;
        MEALS[meal].forEach(function (f, k) {
          var grams = Math.round(f[1] * (0.85 + rnd() * 0.3));
          var item = dietCalc.ensureFoodMacros({ name: f[0], weight: grams });
          item.id = 'demo_f_' + (d + 10) + '_' + meal + '_' + k;
          day[meal].push(item);
        });
      });
      log[fmt(dayOffset(d))] = day;
    }
    st.set('dietLogByDate', log);
    st.set('dietTargets', { calories: 2100, protein: 140, carb: 230, fat: 62 });
    st.set('dietHowToSeen', true);

    // 体测：近 8 周
    var body = {};
    for (var w = 7; w >= 0; w--) {
      var date = fmt(dayOffset(-w * 7));
      var p = (7 - w) / 7;
      body[date] = {
        date: date, ts: dayOffset(-w * 7).getTime() + 8 * 3600e3,
        weight: Math.round((76.8 - p * 2.9) * 10) / 10,
        bodyFat: Math.round((19.6 - p * 2.4) * 10) / 10,
        muscleMass: Math.round((35.2 + p * 0.9) * 10) / 10,
        waist: Math.round((86 - p * 3.5) * 2) / 2,
        chest: Math.round((101 + p * 1.5) * 2) / 2,
        hip: 97, arm: Math.round((36 + p * 1) * 2) / 2, thigh: 58, calf: 38, shoulder: 47
      };
    }
    st.set('bodyStatsByDate', body);
    st.set('cloudDirty', false);
  }

  MP.demo = { seed: seed };
})(window);
