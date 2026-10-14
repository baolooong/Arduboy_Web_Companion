// ============================================================================
// RemoteArduboy 演示:滚动画面 + 按键测试,直接烧录即可用网页连接验证协议
// 接线要求:与你的自制 Arduboy FX 相同(标准 Arduboy2 引脚)。
// ============================================================================
#include <Arduboy2.h>
#include <RemoteArduboy.h>

Arduboy2 arduboy;

// 按键位定义(Arduboy2 顺序,与 RemoteArduboy 协议一致)
#define B_UP    0x01
#define B_RIGHT 0x02
#define B_LEFT  0x04
#define B_DOWN  0x08
#define B_A     0x10
#define B_B     0x20

uint8_t bounceX = 0, bounceY = 0;
int8_t  velX = 2, velY = 1;
uint8_t lastButtons = 0;

void setup() {
  arduboy.begin();
  arduboy.setFrameRate(60);     // 游戏内部逻辑帧率(屏幕串流上限另算)
  arduboy.clear();
  RemoteArduboy::begin();       // ① 串口启动
}

void loop() {
  RemoteArduboy::update();      // ② 接收主机命令(每帧一次,O(1))

  if (!arduboy.nextFrame()) return;

  // ③ 合并远端按键(替代 arduboy.pollButtons())
  RemoteArduboy::pollButtons(arduboy);

  // 弹跳方块:方向键移动,A/B 改变速度
  bounceX += velX;
  bounceY += velY;
  if (bounceX >= 124 || bounceX == 0) velX = -velX;
  if (bounceY >= 60  || bounceY == 0) velY = -velY;

  arduboy.clear();
  arduboy.fillRect(bounceX, bounceY, 4, 4, WHITE);

  // 按键指示器:按下时对应的圆点亮起
  if (arduboy.pressed(B_UP))    arduboy.fillCircle(8, 4, 2, WHITE);
  if (arduboy.pressed(B_DOWN))  arduboy.fillCircle(8, 14, 2, WHITE);
  if (arduboy.pressed(B_LEFT))  arduboy.fillCircle(3, 9, 2, WHITE);
  if (arduboy.pressed(B_RIGHT)) arduboy.fillCircle(13, 9, 2, WHITE);
  if (arduboy.pressed(B_A))     arduboy.fillCircle(120, 30, 3, WHITE);
  if (arduboy.pressed(B_B))     arduboy.fillCircle(112, 30, 3, WHITE);

  arduboy.setCursor(20, 56);
  arduboy.print(F("REMOTE OK"));
  arduboy.display();
  RemoteArduboy::sendFrame();   // ④ 发送本帧屏幕 + 按键状态(非阻塞)
}
