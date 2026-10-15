# 项目交接文档(给下一次对话用)

> 把这份文件贴给新的 Claude 对话,或直接说"读一下 HANDOFF.md",即可无缝接续。

## 项目:Arduboy FX 网页伴侣

Web Serial 直连自制 Arduboy FX(ATmega32U4),实时串流 128×64 屏幕 + 按键状态,
网页按键反向操作真机,STEP 模型转 GLB 做 3D 展示。**代码已完成并验证**,位置
`D:\Desktop\github_web`。

## 当前状态(2026-10-14)

| 项 | 状态 |
|---|---|
| 前端 + 协议 + 固件库 + 文档 | ✅ 完成,`npm run build` 通过,协议 Node 实测通过 |
| 模拟模式 | ✅ `npm run dev` → localhost:5173 → 点「模拟模式」 |
| Git push 到 GitHub | ⏳ **待办**:本地 commit `07f2add` 就绪,远程 https://github.com/baolooong/Arduboy_Web_Companion(私有)。请在用户自己的终端跑 `cd D:\Desktop\github_web && git push -u origin main`(凭证已授权,不弹窗;Claude 的沙箱终端连不上 github.com) |
| STEP → GLB 转换 | ⏳ 待办:model/model.glb 不存在;前盖.STEP/后盖.STEP 在项目根(gitignore);用 CAD Assistant 或 FreeCAD CLI,步骤见 tools/convert_model.md |
| 3D 标定 | ⏳ 待办:tools/calibrate.html 点屏幕 4 角 + 6 按键 → 存 src/config/calibration.json(现有默认占位值) |
| 真机联调 | ⏳ 待办:Arduboy2.h 打 2 行补丁 → 装 RemoteArduboy 库 → 烧 remote_demo.ino → 网页连接 COM 口 |

## 关键决策(不要推翻)

1. **通信 = WebSerial 唯一通道**(WebUSB 被 usbser.sys 挡、WebHID 对键盘类被 Chrome 屏蔽)
2. **30fps 全帧流**是 32U4 CDC 带宽上限(~40-55KB/s,帧需 31KB/s),60fps 不可行
3. **固件非阻塞**:缓冲满丢帧,绝不卡游戏;begin() 不等待主机
4. **按键注入** = pollButtons 后 OR 远端字节经补丁 setter 写回,游戏只改 3 行
5. 用户 STEP 无零件名 → 3D 定位靠标定;three.js 无 STEPLoader(已实测)

## 环境须知

- 这台机器**没有真 Python**(WindowsApps 占位符,静默失败);用 Node 或 bash
- Claude 沙箱连不上 github.com/raw.githubusercontent.com;npm 正常
- git 本地身份已配:baolooong / baolooong@users.noreply.github.com

## 文件地图

```
src/protocol.js      协议(与固件逐字节一致,含 CRC/解析器)
src/serial.js        Web Serial 连接(serialConnect(回调),断线回调 null)
src/simulator.js     模拟设备(simulatorStart(回调事件))
src/main.js          整合(状态机 off/live/sim)
src/viewer3d.js      3D(initViewer(容器, onStatus), 三个 viewer* 模块函数)
firmware/libraries/RemoteArduboy/   固件库(补丁说明在它的 README)
firmware/remote_demo/               演示 sketch
tools/calibrate.html                标定工具(独立页面)
```

## 上轮对话小结

研究阶段用过多 agent 工作流(web 平台调研、固件调研、3D 管线调研均已产出结论并
落入 README 和本文件);固件调研 agent 曾卡在抓取 cathy3k 仓库,已止损换方案。
用户对 token 消耗/耗时敏感,后续干活要报进度、给预估、卡住果断止损。
