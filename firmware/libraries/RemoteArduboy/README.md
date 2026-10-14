# RemoteArduboy

把 Arduboy 屏幕实时串流到浏览器、并接收浏览器发来的按键。USB CDC 串口,非阻塞发送——主机读取慢或拔线时**绝不会卡死游戏**(丢帧而已)。

**安装**:把本目录复制(或软链接)到 Arduino 的 libraries 目录
(`文档/Arduino/libraries/RemoteArduboy`),与 Arduboy2 库同级。

## 依赖的 Arduboy2 补丁(只需一次,一行)

Arduboy2 库的按键状态变量是私有的,RemoteArduboy 需要合并远端按键。
打开 Arduino 库目录里的 `Arduboy2.h`(Arduino IDE:文件 → 首选项 → 查看"项目文件夹位置" → `libraries/Arduboy2/src/Arduboy2.h`),在类定义中找到 `pollButtons` 附近的**公共函数区**,加入:

```cpp
    // ---- RemoteArduboy 补丁(共 2 行)----
    #define ARDUBOY2_BUTTON_STATE_ACCESSIBLE 1
    void setButtonState(uint8_t state) { currentButtonState = state; }
```

`currentButtonState` / `previousButtonState` 是 Arduboy2 类里既有的两个
私有静态成员(就在按键状态声明区,`pollButtons()` 用的就是它们),无需其他修改。
不打补丁 RemoteArduboy 也能编译,只是远端按键不生效(屏幕串流不受影响)。

## 游戏接入(每个游戏只需 3 处)

```cpp
#include <RemoteArduboy.h>

void setup() {
  arduboy.begin();
  // ... 你的初始化 ...
  RemoteArduboy::begin();          // ① 串口启动(会等主机打开串口)
}

void loop() {
  RemoteArduboy::update();         // ② 收主机命令(放 loop 最前,每帧 O(1))

  // ... 你的游戏逻辑,按钮读取用 ③ 替代 arduboy.pollButtons() ...
  RemoteArduboy::pollButtons(arduboy);   // ③ = 物理按键 + 远端按键合并
  // 之后 arduboy.pressed() / justPressed() / buttonsState() 照常工作

  // ... 绘制 ...
  arduboy.display();
  RemoteArduboy::sendFrame();      // ④ 每帧最后,发送屏幕+按键(非阻塞)
}
```

## 原理(为什么这样设计)

| 问题 | 处理 |
|---|---|
| `Serial.write()` 在 USB 缓冲满时会忙等,主机不读 → 游戏卡死 | 发送前检查 `Serial.availableForWrite()`,不够一块(64B)就丢本帧,绝不阻塞 |
| 串口没打开(`!Serial`,DTR 未置位) | `sendFrame()` 直接返回,零开销 |
| 波特率 | 原生 USB CDC 下波特率是名义值,填 115200 即可,实际速度由 USB 总线决定 |
| 远端按键如何让游戏"以为"是物理按键 | `pollButtons()` 内部:先 `arduboy.pollButtons()`,再把远端按键 OR 进 `buttonsState`,写回库内部状态 —— `justPressed()` 等边缘检测照常工作 |
| 带宽 | 全帧 1024B,分 16 块 × 64B(一块 = 一个 USB 包),30fps ≈ 31KB/s,在 32U4 的 CDC 实测带宽(~40-55KB/s)内;有余量但 60fps 不可行 |

## 协议

与 `web/src/protocol.js` 完全一致(0xAA 同步 + 类型 + 负载 + CRC-8 poly 0x31):

- **设备→主机**:`AA 01 <seq> <idx> <count> <64B> <crc>`(屏幕帧块);`AA 02 <buttons> <crc>`(按键状态,每帧一次);`AA 20 <ver> <chunks> <chunkSize> <maxRate> <crc>`(信息应答)
- **主机→设备**:`AA 10 <buttons> <crc>`(按键事件);`AA 11 <rate> <crc>`(目标帧率,0=不限);`AA 12`(请求信息)

按键位:`bit0=上 bit1=右 bit2=左 bit3=下 bit4=A bit5=B`(Arduboy2 标准顺序,与网页端一致;自制板接线若不同,改 `RemoteArduboy.h` 里的 `B_*` 定义)。
