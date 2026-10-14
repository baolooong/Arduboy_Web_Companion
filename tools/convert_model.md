# STEP → GLB 转换 + 3D 标定

你的 STEP 文件(前盖.STEP / 后盖.STEP)是 SolidWorks 导出的 AP214 单实体,
**零件名全部是 'NONE'**,所以屏幕和按键不能按名字定位 —— 必须用标定工具
测一次坐标。

## 1. 转换 STEP → GLB(离线,二选一)

**方案 A:OCCT CAD Assistant**(免费,推荐)
1. 下载安装 [CAD Assistant](https://www.opencascade.com/products/cad-assistant/)
2. 分别打开 `前盖.STEP`、`后盖.STEP`,逐个导出为 `前盖.glb`、`后盖.glb`
3. 用标定页分别标定,或在 three.js 里合并(见下方"双壳装配")

**方案 B:FreeCAD 无头命令行**
```bash
freecadcmd -c "
import Import
Import.open('D:/Desktop/github_web/前盖.STEP')
Import.export(FreeCAD.ActiveDocument.Objects, 'D:/Desktop/github_web/model/前盖.glb')
"
```
(FreeCAD ≥ 0.19.23074 支持 glTF 导出)

把产物放到 `model/model.glb`(网站加载的就是这个路径)。
若前后盖是分开的两个文件,先在标定页分别处理,再把屏幕贴到前盖、
按键贴到前盖 —— 后盖只作展示件合并进场景。

## 2. 标定(必须做一次)

启动 `npm run dev`,打开 **http://localhost:5173/tools/calibrate.html**:

1. 页面加载 `model/model.glb`(改路径可加载其他 GLB)
2. **按顺序点击屏幕 4 个角**:左上 → 右上 → 右下 → 左下(点模型的屏幕区域)
3. **按顺序点击 6 个按键中心**:上、下、左、右、A、B
4. 点 **导出 calibration.json**,保存为 `src/config/calibration.json`
5. 回到主页刷新:屏幕贴图对齐 + 按键动画生效

模型很大/贴图位置差一点时,可直接手改 calibration.json 里的坐标微调。

## 3. 双壳装配(前盖 + 后盖)

若两个壳的原点不一致(装配错位):
- 在标定页加载其中一个,记录某个特征点坐标
- 在 three.js 场景里对后盖做平移对齐(见 viewer3d.js 的模型加载部分,
  预留了 bounding-box 自动适配 —— 若合并不准,手动调 GLB 的 position)

## 4. 已知限制

- GLB 不含 B-rep 边线 → viewer3d.js 用 `THREE.EdgesGeometry` 客户端生成锐边
- STEP 无零件名 → 按键动画优先用标定的"指示点"方案;若你愿意,可在
  FreeCAD 里给按键/屏幕单独命名再导出,动画可绑定到真实网格
