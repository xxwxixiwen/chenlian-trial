/** 徒手深蹲辅助：侧面二维关键点与滞回计数；角度阈值用于体验，非动作合格判定。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChenlianSquat = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  var SIDES = [[11, 23, 25, 27, 29, 31], [12, 24, 26, 28, 30, 32]];

  function visible(p) {
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) &&
      (p.visibility == null ? 0 : p.visibility) >= 0.6 &&
      (p.presence == null || p.presence >= 0.6) &&
      p.x > 0.02 && p.x < 0.98 && p.y > 0.02 && p.y < 0.98;
  }
  function distance(a, b, w, h) {
    return Math.hypot((a.x - b.x) * w, (a.y - b.y) * h);
  }
  function kneeAngle(hip, knee, ankle, w, h) {
    var ax = (hip.x - knee.x) * w, ay = (hip.y - knee.y) * h;
    var bx = (ankle.x - knee.x) * w, by = (ankle.y - knee.y) * h;
    var len = Math.hypot(ax, ay) * Math.hypot(bx, by);
    if (len < 1) return null;
    return Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / len))) * 180 / Math.PI;
  }
  function createCounter() {
    var reps = 0, shallow = 0, validMs = 0, mins = [];
    var lastAt = null, lastValid = false, angle = null, side = null;
    var phase = 'calibrating', standSince = null, downSince = null, startAt = null, minimum = 180;

    function breakCycle() {
      phase = 'calibrating'; standSince = null; downSince = null;
      startAt = null; minimum = 180; angle = null; side = null; lastValid = false;
    }
    function result(valid, hint, justCounted) {
      return { valid: valid, hint: hint, reps: reps, shallowReps: shallow,
        angle: angle == null ? null : Math.round(angle), side: side, phase: phase,
        justCounted: !!justCounted, validDurationSec: Math.round(validMs / 1000),
        minKneeAngle: mins.length ? Math.round(Math.min.apply(null, mins)) : null };
    }
    return {
      interrupt: breakCycle,
      summary: function () { return result(false, '识别已结束'); },
      update: function (poses, at, width, height) {
        if (!Number.isFinite(at) || !(width > 0 && height > 0)) {
          breakCycle(); return result(false, '等待摄像头画面');
        }
        var gap = lastAt == null ? 0 : at - lastAt;
        if (gap < 0 || gap > 500) breakCycle();
        lastAt = at;
        function reject(hint) { breakCycle(); return result(false, hint); }
        if (!poses || poses.length !== 1) return reject(poses && poses.length > 1 ? '请保持只有一人入镜' : '请侧身站好，让肩、髋、膝和脚完整入镜');
        var points = poses[0];
        if (!points || points.length < 33) return reject('等待完整人体关键点');
        var scores = SIDES.map(function (ids) {
          return ids.every(function (i) { return visible(points[i]); }) ?
            ids.reduce(function (v, i) { return v + points[i].visibility; }, 0) : -1;
        });
        var chosen = side == null ? (scores[0] >= scores[1] ? 0 : 1) : side;
        if (scores[chosen] < 0) return reject('肩到脚需完整入镜，无遮挡且光线充足');
        var ids = SIDES[chosen], shoulder = points[ids[0]], hip = points[ids[1]], knee = points[ids[2]], ankle = points[ids[3]];
        var torso = distance(shoulder, hip, width, height);
        if (torso < 20 || distance(hip, knee, width, height) < 20 || distance(knee, ankle, width, height) < 20) return reject('请靠近一些，并保持全身入镜');
        if (visible(points[11]) && visible(points[12]) &&
            Math.abs(points[11].x - points[12].x) * width > torso * 0.65) return reject('请转向侧面拍摄，镜头保持在髋部附近高度');
        var raw = kneeAngle(hip, knee, ankle, width, height);
        if (raw == null) return reject('姿态暂时不清晰，请调整位置');
        side = chosen;
        if (lastValid && gap > 0 && gap <= 500) validMs += gap;
        lastValid = true;
        // 按时间平滑，避免不同帧率导致明显不同的响应速度。
        var alpha = Math.min(1, Math.max(0.25, gap / 120));
        angle = angle == null ? raw : angle + alpha * (raw - angle);
        var counted = false, hint;
        if (phase === 'calibrating') {
          if (angle >= 160) {
            if (standSince == null) standSince = at;
            if (at - standSince >= 400) { phase = 'ready'; standSince = null; }
          } else standSince = null;
          hint = phase === 'ready' ? '准备好了，按自己的节奏下蹲' : '先站直并保持片刻，完成起始校准';
        } else if (phase === 'ready') {
          hint = '准备好了，按自己的节奏下蹲';
          if (angle < 145) {
            if (downSince == null) downSince = at;
            if (at - downSince >= 160) {
              phase = 'moving'; startAt = downSince; minimum = angle; standSince = null;
              hint = '正在下蹲，随后站直完成一次';
            }
          } else downSince = null;
        } else {
          minimum = Math.min(minimum, angle);
          hint = angle < 145 ? '保持稳定，随后站直完成一次' : '正在起身，站直后计次';
          if (angle >= 160) {
            if (standSince == null) standSince = at;
            if (at - standSince >= 240) {
              if (minimum <= 135 && at - startAt >= 600) {
                reps++; mins.push(minimum); counted = true;
                if (minimum > 115) { shallow++; hint = '完成一次，本次下蹲幅度较浅'; }
                else hint = '完成一次，准备下一次';
              } else hint = '本次幅度过小或动作过快，未计次';
              phase = 'ready'; standSince = null; downSince = null; startAt = null;
            }
          } else standSince = null;
        }
        return result(true, hint, counted);
      }
    };
  }
  return { createCounter: createCounter };
});
