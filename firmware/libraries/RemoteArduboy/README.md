# RemoteArduboy

把 Arduboy 屏幕实时串流到浏览器、并接收浏览器发来的按键。USB CDC 串口,非阻塞发送——主机读取慢或拔线时**绝不会卡死游戏**(丢帧而已)。

**安装**:把本目录复制(或软链接)到 Arduino 的 libraries 目录
(`文档/Arduino/libraries/RemoteArduboy`),与 Arduboy2 库同级。

## 依赖的 Arduboy2 补丁(只需一次,两处小改)

Arduboy2 的 `pressed()` / `anyPressed()` / `notPressed()` **直接读引脚状态**
`buttonsState()`,不经过 `currentButtonState`;所以远端按键必须叠加进
`buttonsState()` 才能被它们看到。在 Arduino 库目录(`Arduino IDE:文件 →
首选项 → 查看"项目文件夹位置"` → `libraries/Arduboy2/src/`)改两个文件:

**① `Arduboy2Core.h`** — 在公共区 `static uint8_t buttonsState();` 之后加一行:

```cpp
    static uint8_t remoteButtonsState;   // RemoteArduboy 补丁
```

**② `Arduboy2Core.cpp`** — 在 `buttonsState()` 函数上方定义它,并把函数最后
一行的 `return buttons;` 改为:

```cpp
uint8_t Arduboy2Core::remoteButtonsState = 0;   // 定义(放 buttonsState() 前)

// ...buttonsState() 函数体不变,只改最后一行:
  return buttons | remoteButtonsState;
```

原理:`buttonsState()` 是 `pressed()` / `anyPressed()` / `notPressed()` /
`pollButtons()` 共同读取的**唯一入口**,把远端按键 OR 进去之后,
`pressed()`、`justPressed()` 全部照常工作,就像真的按下了物理按键。
不打补丁 RemoteArduboy 也能编译,只是远端按键不生效(屏幕串流不受影响)。

## 游戏接入(每个游戏 4 处调用 + 1 行 include)

```cpp
#include <RemoteArduboy.h>

void setup() {
  arduboy.begin();
  // ... 你的初始化 ...
  RemoteArduboy::begin();          // ① 串口启动(不等待主机,离线也能玩)
}

void loop() {
  RemoteArduboy::update();         // ② 收主机命令(放 loop 最前,每帧 O(1))

  // ... 你的游戏逻辑,按钮读取用 ③ 替代 arduboy.pollButtons() ...
  RemoteArduboy::pollButtons(arduboy);   // ③ = 物理按键 + 远端按键合并
  // 之后 arduboy.pressed() / justPressed() 照常工作(原始状态在 currentButtonState)

  // ... 绘制 ...
  arduboy.display();
  RemoteArduboy::sendFrame();      // ④ 每帧最后,发送屏幕+按键(非阻塞)
}
```

> ③ 是否必要取决于游戏怎么读按键:只用 `pressed()` / `anyPressed()` 的游戏
> (直接读引脚)**可以不改按键代码**,远端按键经上面的 Arduboy2Core 补丁自动生效;
> 只有用 `pollButtons()` + `justPressed()` / `justReleased()` 做边缘检测的游戏才需要换 ③。
> 实例见仓库 `firmware/games/Arduboy3D/`(Catacombs of the Damned,只用 `pressed()`,故只动了 include/begin/update/sendFrame 四处)。

## 原理(为什么这样设计)

| 问题 | 处理 |
|---|---|
| `Serial.write()` 在 USB 缓冲满时会忙等,主机不读 → 游戏卡死 | 发送前检查 `Serial.availableForWrite()`,FIFO 满就丢本帧,绝不阻塞 |
| 串口没打开(`!Serial`,DTR 未置位) | `sendFrame()` 直接返回,零开销 |
| 波特率 | 原生 USB CDC 下波特率是名义值,填 115200 即可,实际速度由 USB 总线决定 |
| 远端按键如何让游戏"以为"是物理按键 | 远端按键被 OR 进 `buttonsState()`(Arduboy2Core 补丁)。`pressed()`/`anyPressed()` 直接读 `buttonsState()`,`pollButtons()` 也会把它存进 `currentButtonState` 供 `justPressed()` 用 —— 全部照常工作 |
| 带宽 | 全帧 1024B,分 16 块 × 64B(正好一个 USB 包,SOF 每 1ms flush 一次,16ms/帧),30fps ≈ 34KB/s,在 32U4 的 CDC 实测带宽(~40-55KB/s)内;有余量但 60fps 不可行 |

## 协议

与 `web/src/protocol.js` 完全一致(0xAA 同步 + 类型 + 负载 + CRC-8 poly 0x31):

- **设备→主机**:`AA 01 <seq> <idx> <count> <64B> <crc>`(屏幕帧块);`AA 02 <buttons> <crc>`(按键状态,每帧一次);`AA 20 <ver> <chunks> <chunkSize> <maxRate> <crc>`(信息应答)
- **主机→设备**:`AA 10 <buttons> <crc>`(按键事件);`AA 11 <rate> <crc>`(目标帧率,0=不限);`AA 12`(请求信息)

按键位:**直接用 Arduboy2 自带的位值**(`UP_BUTTON=0x80 RIGHT_BUTTON=0x40 LEFT_BUTTON=0x20 DOWN_BUTTON=0x10 A_BUTTON=0x08 B_BUTTON=0x04`,bit7~2),网页端 `protocol.js` 的 `BUTTONS` 与此一致。协议传递的是这个 8 位字节原样,两端各自按 Arduboy2 常量解释;游戏里请直接用 `UP_BUTTON` 等常量,不要自己重定义位值。
