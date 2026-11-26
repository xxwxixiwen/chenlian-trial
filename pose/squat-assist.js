/** 网页端深蹲辅助：按需加载模型，摄像头生命周期和结果确认。 */
(function (global) {
  'use strict';
  var MP = global.MP;
  var base = new URL('../vendor/mediapipe/', document.currentScript.src).href;
  var active = null;
  var BONES = [[11, 12], [11, 23], [12, 24], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28], [27, 29], [28, 30], [29, 31], [30, 32], [11, 13], [12, 14], [13, 15], [14, 16]];

  function open(options) {
    options = options || {};
    if (active) return Promise.resolve(null);
    return new Promise(function (resolve) {
      var dialog = document.createElement('dialog');
      dialog.className = 'mp-page sa-dialog';
      dialog.setAttribute('aria-labelledby', 'sa-title');
      dialog.innerHTML =
        '<div class="sa-heading"><div><span class="sa-eyebrow">摄像头辅助 · 体验版</span><h2 id="sa-title">徒手深蹲</h2><p class="sa-context"></p></div><button class="sa-close" aria-label="关闭深蹲辅助">×</button></div>' +
        '<div class="sa-layout"><div class="sa-stage"><video playsinline muted aria-label="摄像头实时画面"></video><canvas aria-hidden="true"></canvas>' +
        '<div class="sa-placeholder"><img src="' + MP.sources.asset('/images/icons/camera-brand.svg') + '" alt=""><strong>侧身站好，从肩到脚完整入镜</strong><p>手机固定在髋部附近高度<br>保持只有一人入镜，留出下蹲空间</p></div>' +
        '<span class="sa-camera-state">摄像头未开启</span></div>' +
        '<div class="sa-panel"><div class="sa-count"><span class="sa-number">0</span><span>次完成</span></div>' +
        '<div class="sa-hint" role="status" aria-live="polite">准备好后开启摄像头，先站直校准，再开始下蹲。</div>' +
        '<div class="sa-metrics"><div><span>当前膝角</span><strong class="sa-angle">—</strong></div><div><span>浅幅次数</span><strong class="sa-shallow">0</strong></div></div>' +
        '<p class="sa-explain">完整下蹲并站直后计次。基础幅度提示仅供训练参考，按自己的舒适范围练习。</p>' +
        '<p class="sa-privacy">画面在本机分析，本功能不录制或上传视频。首次开启需允许摄像头。</p>' +
        '<div class="sa-controls"><button class="sa-primary sa-start">开启摄像头</button><button class="sa-secondary sa-finish" hidden>结束并核对次数</button></div>' +
        '<form class="sa-review" hidden><label for="sa-reps">确认本组次数</label><input id="sa-reps" type="number" inputmode="numeric" min="0" max="999" step="1" required><p class="sa-review-note"></p><p class="sa-validation" role="alert"></p><button class="sa-primary sa-confirm" type="submit">使用本组次数</button><button class="sa-secondary sa-again" type="button">重新识别</button></form>' +
        '</div></div><div class="sa-footer">仅支持侧面拍摄的徒手深蹲 · 结束前可暂停，结果可手动修正</div>';
      document.body.appendChild(dialog);
      var $ = function (selector) { return dialog.querySelector(selector); };
      var video = $('video'), canvas = $('canvas'), ctx = canvas.getContext('2d');
      var counter = global.ChenlianSquat.createCounter();
      var stream = null, model = null, raf = null, lastFrame = -1, lastTime = -1;
      var mode = 'ready', disposed = false, generation = 0, elapsedStart = null;
      var originalFocus = document.activeElement;
      var last = counter.summary();
      $('.sa-context').textContent = options.context || '独立体验 · 结束后查看结果，不写入训练记录';
      $('.sa-confirm').textContent = options.context ? '使用本组次数' : '完成体验';
      function hint(message, warn) {
        $('.sa-hint').textContent = message;
        $('.sa-hint').classList.toggle('is-warning', !!warn);
      }
      function stopCamera() {
        if (raf != null) cancelAnimationFrame(raf);
        raf = null;
        if (stream) stream.getTracks().forEach(function (track) { track.stop(); });
        stream = null;
        video.srcObject = null;
        $('.sa-camera-state').textContent = '摄像头已关闭';
        $('.sa-placeholder').hidden = false;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        counter.interrupt();
      }
      function close(value) {
        if (disposed) return;
        disposed = true; generation++;
        stopCamera();
        if (model) { model.close(); model = null; }
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('hashchange', onRoute);
        window.removeEventListener('pagehide', onRoute);
        active = null;
        dialog.close(); dialog.remove();
        if (originalFocus && originalFocus.isConnected) originalFocus.focus();
        resolve(value || null);
      }
      function pause(message) {
        if (mode !== 'running' && mode !== 'loading') return;
        generation++; stopCamera(); mode = 'paused';
        $('.sa-start').disabled = false; $('.sa-start').textContent = '继续识别';
        $('.sa-finish').hidden = elapsedStart == null;
        hint(message || '已暂停，摄像头已关闭。继续后请先站直校准。');
      }
      function onVisibility() { if (document.hidden) pause('切到后台已暂停，返回后点击继续识别。'); }
      function onRoute() { close(null); }
      function draw(points) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!points) return;
        ctx.strokeStyle = getComputedStyle(dialog).getPropertyValue('--c-brand').trim();
        ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = Math.max(2, canvas.width / 250);
        function good(p) { return p && p.visibility >= 0.6; }
        BONES.forEach(function (pair) {
          var a = points[pair[0]], b = points[pair[1]];
          if (!good(a) || !good(b)) return;
          ctx.beginPath(); ctx.moveTo(a.x * canvas.width, a.y * canvas.height);
          ctx.lineTo(b.x * canvas.width, b.y * canvas.height); ctx.stroke();
        });
        points.forEach(function (p, i) {
          if (i < 11 || !good(p)) return;
          ctx.beginPath(); ctx.arc(p.x * canvas.width, p.y * canvas.height, Math.max(3, canvas.width / 180), 0, Math.PI * 2); ctx.fill();
        });
      }
      function frame(at) {
        if (disposed || mode !== 'running') return;
        try {
          // 限制推理频率，优先留出界面交互时间；仅处理新视频帧。
          if (at - lastTime >= 66 && video.readyState >= 2 && video.currentTime !== lastFrame) {
            lastTime = at; lastFrame = video.currentTime;
            var result = model.detectForVideo(video, at);
            last = counter.update(result.landmarks, at, video.videoWidth, video.videoHeight);
            draw(result.landmarks.length === 1 ? result.landmarks[0] : null);
            $('.sa-number').textContent = last.reps;
            $('.sa-angle').textContent = last.angle == null ? '—' : last.angle + '°';
            $('.sa-shallow').textContent = last.shallowReps;
            hint(last.hint, !last.valid);
          }
          raf = requestAnimationFrame(frame);
        } catch (error) {
          pause('识别暂时中断，请重新开启；也可结束后手动填写次数。');
        }
      }
      async function start() {
        if (mode === 'running') { pause(); return; }
        if (mode === 'loading' || disposed) return;
        if (!global.isSecureContext || location.protocol === 'file:') {
          hint('摄像头需要安全连接。请在本机通过 localhost 打开；手机访问需使用 HTTPS。', true); return;
        }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          hint('当前浏览器不支持摄像头，请使用新版 Chrome 或 Safari。', true); return;
        }
        var token = ++generation;
        mode = 'loading'; $('.sa-start').disabled = true; $('.sa-finish').hidden = true;
        hint('正在加载动作识别模型，首次开启请稍候…');
        try {
          if (!model) {
            var sdk = await import(base + 'vision_bundle.mjs');
            if (disposed || token !== generation) return;
            var files = await sdk.FilesetResolver.forVisionTasks(base + 'wasm');
            if (disposed || token !== generation) return;
            var created = await sdk.PoseLandmarker.createFromOptions(files, {
              baseOptions: { modelAssetPath: base + 'pose_landmarker_lite.task', delegate: 'CPU' },
              runningMode: 'VIDEO', numPoses: 2,
              minPoseDetectionConfidence: 0.6, minPosePresenceConfidence: 0.6,
              minTrackingConfidence: 0.6, outputSegmentationMasks: false
            });
            if (disposed || token !== generation) { created.close(); return; }
            model = created;
          }
          hint('请在浏览器提示中允许摄像头访问。');
          var acquired = await navigator.mediaDevices.getUserMedia({ audio: false,
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } } });
          if (disposed || token !== generation) { acquired.getTracks().forEach(function (t) { t.stop(); }); return; }
          stream = acquired; video.srcObject = stream;
          stream.getVideoTracks().forEach(function (track) {
            track.addEventListener('ended', function () { pause('摄像头已断开，请检查设备后继续识别。'); });
          });
          await video.play();
          if (disposed || token !== generation) return;
          mode = 'running'; lastFrame = -1; lastTime = -1;
          if (elapsedStart == null) elapsedStart = Date.now();
          $('.sa-placeholder').hidden = true; $('.sa-camera-state').textContent = '本机识别中';
          $('.sa-start').disabled = false; $('.sa-start').textContent = '暂停识别';
          $('.sa-finish').hidden = false;
          hint('请先侧身站直，让肩到脚完整入镜。');
          raf = requestAnimationFrame(frame);
        } catch (error) {
          if (disposed || token !== generation) return;
          stopCamera(); mode = 'paused';
          $('.sa-start').disabled = false; $('.sa-start').textContent = '重新开启';
          var messages = {
            NotAllowedError: '摄像头权限未开启。请在浏览器地址栏的权限设置中允许摄像头，再重试。',
            NotFoundError: '未找到摄像头。请连接摄像头，或换到带摄像头的设备。',
            NotReadableError: '摄像头暂时无法使用，请关闭占用它的其他应用后重试。',
            OverconstrainedError: '当前摄像头不支持所需画面，请更换设备后重试。'
          };
          hint(messages[error.name] || '动作模型未能加载，请确认本地模型文件完整，刷新页面后重试。', true);
          if (elapsedStart != null) $('.sa-finish').hidden = false;
        }
      }
      function finish() {
        generation++; stopCamera(); mode = 'review';
        $('.sa-controls').hidden = true; $('.sa-review').hidden = false;
        $('#sa-reps').value = last.reps;
        $('.sa-review-note').textContent = '识别到 ' + last.reps + ' 次，其中浅幅 ' + last.shallowReps + ' 次。' +
          (options.context ? '可修正次数，回填后仍需点击“完成本组”。' : '本次为独立体验，不会计入训练统计。');
        hint('摄像头已关闭，请核对本次结果。');
        $('#sa-reps').focus();
      }
      $('.sa-close').onclick = function () { close(null); };
      dialog.addEventListener('cancel', function (event) { event.preventDefault(); close(null); });
      $('.sa-start').onclick = start;
      $('.sa-finish').onclick = finish;
      $('.sa-again').onclick = function () {
        counter = global.ChenlianSquat.createCounter(); last = counter.summary(); elapsedStart = null;
        $('.sa-number').textContent = '0'; $('.sa-shallow').textContent = '0'; $('.sa-angle').textContent = '—';
        $('.sa-controls').hidden = false; $('.sa-review').hidden = true;
        mode = 'ready'; start();
      };
      $('.sa-review').onsubmit = function (event) {
        event.preventDefault();
        var text = $('#sa-reps').value.trim(), count = Number(text);
        if (!/^\d+$/.test(text) || !Number.isInteger(count) || count < 0 || count > 999) {
          $('.sa-validation').textContent = '请输入 0–999 之间的整数次数。'; return;
        }
        close({ source: 'mediapipe-pose', exercise: 'bodyweight-squat', version: 1,
          detectedReps: last.reps, confirmedReps: count, shallowReps: last.shallowReps,
          minKneeAngle: last.minKneeAngle, validDurationSec: last.validDurationSec,
          durationSec: elapsedStart == null ? 0 : Math.round((Date.now() - elapsedStart) / 1000),
          capturedAt: Date.now() });
      };
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('hashchange', onRoute);
      window.addEventListener('pagehide', onRoute);
      active = { close: close };
      dialog.showModal();
      $('.sa-start').focus();
    });
  }
  MP.squatAssist = { open: open, close: function () { if (active) active.close(null); } };
  // 专用于网页运行时的能力检测；原生小程序不提供此入口。
  MP.wx.openSquatAssist = open;
  MP.wx.closeSquatAssist = MP.squatAssist.close;
  // 运行时的 onHide 同时代表切后台和导航；后台由弹层暂停，只有换页才取消结果。
  global.Vue.watch(function () { return MP.router.top(); }, function () { MP.squatAssist.close(); });
})(window);
