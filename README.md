# Arduboy Remote 🎮

自制 Arduboy FX 的网页伴侣:USB 直连浏览器,实时显示屏幕与按键,网页按键反向操作真机,3D 模型(由 STEP 转换)叠加实时画面 + 按键动画。

```
┌─ 设备:Arduboy FX(ATmega32U4)──────────┐        USB CDC(COM 口)
│  游戏 + Arduboy2 + RemoteArduboy 库    │ ──────────────────────┐
└────────────────────────────────────────┘                       ▼
                                            ┌─ 浏览器 http://localhost:5173 ─┐
                                            │ 屏幕 128×64(~30fps)·按键面板·3D │
                                            │ Web Serial ↔ 串口协议(双向)      │
                                            │ 模拟模式(无硬件也可体验)         │
                                            └──────────────────────────────────┘
```

## 功能特性

- **实时屏幕**:128×64 单色 OLED ~30fps 串流(USB CDC,每块 64B,非阻塞)
- **按键状态**:上/下/左/右/A/B 实时高亮(设备侧状态每帧回传)
- **反向操作**:网页/键盘按键注入固件,游戏只改 4 处调用,`pressed()/justPressed()` 照常工作
- **3D 展示**:STEP 离线转 GLB,实时画面贴到模型屏幕,按键按下有下沉动画
- **模拟模式**:无硬件也能开发调试 UI;断线自动回退,拔线不卡游戏

## 环境要求

| 项目 | 要求 |
|---|---|
| 浏览器 | Chrome / Edge 89+(Firefox 151+ 亦支持 Web Serial;**Safari 不支持**) |
| 运行环境 | Node.js ≥ 18(仅用于跑 Vite;打包后是纯静态站点) |
| 操作系统 | Windows 10/11(usbser.sys 对规范 CDC 设备自动绑定,零驱动安装) |
| 硬件 | 自制 Arduboy FX(ATmega32U4 类)+ USB 线 |
| 固件 | Arduino IDE + [Arduboy2 库](https://github.com/MLXXXp/Arduboy2) |

## 快速开始

```bash
npm install
npm run dev        # 打开 http://localhost:5173(Chrome/Edge)
```

**没有硬件?** 点页面上的「模拟模式」:屏幕跑马灯、按键面板/键盘都有完整交互回显。

**有硬件?** 三步接入:

1. 给 Arduboy2 库打一次性补丁(见 [固件接入](#固件接入))
2. 把 `firmware/libraries/RemoteArduboy` 拷到 Arduino 的 `libraries/` 目录
3. 烧录 `firmware/remote_demo/remote_demo.ino`,网页点「连接设备」→ 选择设备 COM 口

## 网页操作

| 操作 | 说明 |
|---|---|
| 连接设备 | 弹出设备选择框,选 Arduboy 的 COM 口(一次授权,浏览器按站点记忆) |
| 断开 | 关闭端口,回到未连接状态 |
| 模拟模式 | 不接硬件,跑内置假设备(与真机走同一套协议) |
| 3D 模型 | 开关:默认关闭(未转换模型时隐藏);打开后懒加载 three.js 视图,再点关闭 |
| 按键面板 | 鼠标点击 / 触摸按住;上/下/左/右 + A/B |
| 键盘 | `WASD` 方向 · `J`=A · `K`=B |
| 3D 视图 | 拖拽旋转、滚轮缩放、右键平移(OrbitControls) |
| 状态栏 | 实时 fps + 丢帧计数;拔线自动提示断开 |

## 固件接入

详见 [firmware/libraries/RemoteArduboy/README.md](firmware/libraries/RemoteArduboy/README.md),要点:

**① Arduboy2 补丁(一次性,两处小改)** — Arduboy2 的 `pressed()` 直接读引脚
`buttonsState()`,所以远端按键必须叠加进 `buttonsState()` 才生效。在
`Arduboy2Core.h` 加一个静态成员、`Arduboy2Core.cpp` 的 `buttonsState()`
末尾 OR 上它(详见 [固件 README](firmware/libraries/RemoteArduboy/README.md)):

```cpp
// Arduboy2Core.h(公共区)
static uint8_t remoteButtonsState;

// Arduboy2Core.cpp(buttonsState() 末尾)
return buttons | remoteButtonsState;
```

**② 游戏代码(每个游戏只改 4 处调用 + 1 行 include)**

```cpp
#include <RemoteArduboy.h>

void setup() {
  arduboy.begin();
  RemoteArduboy::begin();                 // ① 启动串口(不等待主机,离线也能玩)
}

void loop() {
  RemoteArduboy::update();                // ② 收主机命令(O(1),放 loop 最前)
  // ...
  RemoteArduboy::pollButtons(arduboy);    // ③ = 物理按键 | 远端按键(见下:只用 pressed() 的可跳过)
  // 之后 pressed()/justPressed() 与原来完全一样(原始状态在 currentButtonState)
  // ...
  arduboy.display();
  RemoteArduboy::sendFrame();             // ④ 发送本帧(缓冲满丢帧,绝不卡游戏)
}
```

> ③ 是否必要取决于游戏怎么读按键:只用 `pressed()` / `anyPressed()` 的游戏
> (直接读引脚)可以**不改按键代码**——远端按键经 ① 的 `buttonsState()` 补丁自动生效;
> 只有用 `pollButtons()` + `justPressed()` / `justReleased()` 做边缘检测的游戏才需要换 ③。

**设计取舍(为什么这样安全)**:`Serial.write()` 在 USB 缓冲满时会忙等阻塞,
RemoteArduboy 发送前检查 `availableForWrite()`,不够一块就丢本帧——主机慢或
拔线只会丢帧,**游戏永不卡死**。主机没开串口时 `sendFrame()` 直接返回,零开销。

## 移植现有游戏源码

把任意 Arduboy2 游戏接上 RemoteArduboy,只在 `.ino` 主文件动 4 处调用(外加 1 行
`#include`)。仓库里已有一个完整实例:[firmware/games/Arduboy3D/](firmware/games/Arduboy3D/)
——经典游戏 **Catacombs of the Damned**(源码 [jhhoward/Arduboy3D](https://github.com/jhhoward/Arduboy3D),MIT 许可)。

**先判断游戏怎么读按键,决定要不要改按键那行:**

| 游戏读按键方式 | 按键代码改动 |
|---|---|
| 只用 `pressed()` / `anyPressed()`(直接读引脚) | **不用改** —— 远端按键经 `buttonsState()` 补丁自动生效 |
| 用 `pollButtons()` + `justPressed()` / `justReleased()`(边缘检测) | `arduboy.pollButtons()` → `RemoteArduboy::pollButtons(arduboy)` |

**通用步骤(以 Catacombs 为例):**

1. 游戏 `.ino` 顶部加 `#include <RemoteArduboy.h>`
2. `setup()` 里 `arduboy.boot()` / `arduboy.begin()` 之后加 `RemoteArduboy::begin();`
3. `loop()` 最前加 `RemoteArduboy::update();`
4. 若游戏用 `pollButtons()`,替换为 `RemoteArduboy::pollButtons(arduboy)`;只用 `pressed()` 的跳过
5. `arduboy.display(...)` 之后加 `RemoteArduboy::sendFrame();`

Catacombs 是"只用 `pressed()`"的情况,所以实际只动了 4 处:include、begin、update、
sendFrame,按键逻辑原样未改,网页按键即可直接操作游戏。

**移植时的三个坑:**

- **依赖库**:游戏用到的其他库要一并装好。Catacombs 依赖 **ArduboyTones**(Arduino IDE「管理库」搜 `ArduboyTones` 安装),否则编译报错。
- **flash / RAM 余量**:3D 类游戏很吃内存。RemoteArduboy 的 CRC 用 16 字节半字节查表(放 PROGMEM),零 RAM 占用;Catacombs 集成后总占用约 28608 / 28672 字节,**余量仅 64 字节**。若你的游戏更大,优先优化游戏自身资源,别动 RemoteArduboy。
- **帧率对齐**:游戏 `setFrameRate()` 与串流上限 30fps 一致时一帧对一帧最稳(Catacombs 的 `TARGET_FRAMERATE` 正好是 30)。

## 通信协议

双向,`0xAA` 同步 + 类型 + 负载 + CRC-8(poly 0x31,MSB-first)。定义与固件
逐字节一致:网页端 [src/protocol.js](src/protocol.js),固件端
`RemoteArduboy.cpp`。按键位直接用 Arduboy2 自带的位值(`UP=0x80 RIGHT=0x40
LEFT=0x20 DOWN=0x10 A=0x08 B=0x04`)。

**设备 → 主机**(~30fps 流)

| 包 | 说明 |
|---|---|
| `AA 01 <seq> <idx> <count> <64B> <crc>` | 屏幕帧块:1024B 帧 = 16 块 × 64B(正好一个 USB 包,SOF 1ms 自动 flush) |
| `AA 02 <buttons> <crc>` | 按键状态,每帧附带一次 |
| `AA 20 <ver> <chunks> <chunkSize> <maxRate> <crc>` | 设备信息应答(回应 `AA 12`) |

**主机 → 设备**(低频命令)

| 包 | 说明 |
|---|---|
| `AA 10 <buttons> <crc>` | 按键事件(网页按下/松开各发一次,固件锁存) |
| `AA 11 <rate> <crc>` | 目标帧率(0 = 不限;默认 30) |
| `AA 12` | 请求设备信息(2 字节,无 CRC) |

**带宽预算**:全帧 1024B @30fps ≈ 31KB/s,在 32U4 的 Arduino CDC 实测带宽
(~40-55KB/s)内;**60fps 不可行**。够用但余量小——所以块大小对齐 USB 包、
每帧只追加一个 4 字节按键包、主机按 seq 检测丢帧。

## 3D 模型

你的 STEP(前盖/后盖)没有零件名,需要**转换 + 标定**两步,详见
[tools/convert_model.md](tools/convert_model.md):

1. **转换**:CAD Assistant(或 FreeCAD 命令行)把 STEP 导出为 GLB,
   放到 `model/model.glb`
2. **标定**:打开 `http://localhost:5173/tools/calibrate.html`,按提示点
   屏幕 4 角 + 6 个按键中心,导出 JSON 存为 `src/config/calibration.json`
3. 刷新主页:实时画面贴到模型屏幕,按键按下有下沉动画

未放模型时 3D 面板显示占位提示,其余功能不受影响。

## 项目结构

```
index.html                      单页 UI(左:屏幕+按键 | 右:3D)
src/
  protocol.js                    串口协议:CRC/分包/解析器(与固件一致)
  serial.js                      Web Serial 连接、读循环、命令发送
  simulator.js                   假设备(模拟模式,与真机同协议)
  screen.js                      128×64 画布渲染(兼作 3D 贴图源)
  buttons.js                     按键面板 + 键盘映射
  viewer3d.js                    three.js 场景:模型/贴图/按键动画
  main.js                        状态机与模块整合
  config/calibration.json        3D 标定值(默认占位,标定后覆盖)
firmware/
  libraries/RemoteArduboy/       Arduino 库(屏幕串流 + 按键注入)
  remote_demo/remote_demo.ino    演示 sketch:弹跳方块 + 按键指示
  games/Arduboy3D/               移植实例:Catacombs of the Damned(已接 RemoteArduboy)
tools/
  convert_model.md               STEP→GLB 转换步骤
  calibrate.html                 3D 标定工具(独立页面)
model/                           model.glb 放这里(已 gitignore)
```

## 常见问题

**连接时找不到设备 / 没有 COM 口?**
先看设备管理器:插上设备应出现一个串口(规范 CDC 设备由 Windows 自带
usbser.sys 自动绑定)。若显示"未知设备",是自制板 USB 描述符不合规,
需修固件描述符或安装 Arduino IDE 附带的驱动。

**已连接但屏幕没画面?**
确认:烧的是 `remote_demo`(或已按上面接好游戏的 4 处调用)、Arduboy2 补丁已打、
`sendFrame()` 在 `arduboy.display()` **之后**调用。可以先用「模拟模式」
排除网页端问题。

**远端按键不生效?**
检查 `Arduboy2Core.cpp` 的 `buttonsState()` 是否 `return buttons |
remoteButtonsState;`、`Arduboy2Core.h` 是否声明了 `remoteButtonsState`,
且游戏用的是 `RemoteArduboy::pollButtons(arduboy)`。

**游戏变卡了?**
库的发送路径全非阻塞;若卡顿,检查游戏里是否自己用 `Serial.write()`
发过数据(那会阻塞)。拔掉 USB 线再试——离线应当与未接入时一样流畅。

**丢帧多 / fps 上不去?**
30fps 是带宽上限(见上)。主机侧浏览器窗口切后台时 Chrome 会节流串口读取,
这是浏览器行为;网页的丢帧计数会如实显示。

**Safari / 局域网 / 手机能用吗?**
Safari 不支持 Web Serial(需要 Node 中转程序,本项目未包含);局域网访问需
给 Vite 配 HTTPS(mkcert),因为只有 localhost 是安全上下文。

## 已知限制

- 全帧串流,无差分压缩(30fps 够用;如未来上 60fps 需在固件加脏块编码)
- 拔线后需手动点「连接设备」重连(浏览器要求用户手势开端口)
- STEP 模型无零件名 → 按键动画用标定指示点方案(如需绑定真实按键网格,
  可在 FreeCAD 里给零件命名后重新导出)
