# MediaPipe 本地运行文件

- SDK：`@mediapipe/tasks-vision` **0.10.21**，来自 npm 官方发布包。
- 下载地址：https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-0.10.21.tgz
- 发布包完整性：`sha512-TuhKH+credq4zLksGbYrnvJ1aLIWMc5r0UHwzxzql4BHECJwIAoBR61ZrqwGOW6ZmSBIzU1t4VtKj8hbxFaKeA==`，下载后已核验。
- 模型：Google Pose Landmarker Lite，float16，版本 **1**。
- 模型来源：https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task
- 模型 SHA-256：`59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`。
- SDK 开源许可见同目录 `LICENSE`，上游：https://github.com/google-ai-edge/mediapipe/tree/v0.10.21。

包含 SIMD 和非 SIMD 两组 WASM，由 SDK 选择兼容版本。不要只部署 JS 而漏掉 `wasm/` 和 `.task` 模型。本目录属于网页端，项目配置已将 `web/` 排除在小程序包外。

识别通过 `web/pose/squat-assist.js` 按需加载；初始化和推理资源均取自同源，无需运行时访问 CDN。本功能不录制、存储或上传摄像头画面。升级依赖后需重新核对 SDK 的数据收集说明。
