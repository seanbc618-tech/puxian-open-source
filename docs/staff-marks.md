# 五线谱刻途中记号（r40）

吸收 MuseScore 手册里速度记号、拍号、调号、呼吸与停顿几页的做法：途中速度刻在谱表上方，途中拍号和调号刻在该小节开头，延长记号刻在音或休止上方，渐慢 / 渐快写 rit. / accel. 再用虚线延到区间末尾。只取功能思路，没有用它的代码、名称、文案、素材或字体。

- 数据不变：仍读 `Score.changes`、`fermatas`、`gradualTempos`，不改 `isScore` / score-core。
- `notation.ts` 在首屏 score-core 块里，不能改；加刻逻辑在 `src/lib/music/staff-marks.ts`，只被懒加载的编辑器引用：
  - `staffMarksScore`：同一位置的多条记号合成一条；与当前速度相同的重复 ♩= 不重刻（渐变结束处的回原速保留）。只影响显示。
  - `markStaffAbc`：在 engraveAbc 的 ABC 上加 `!fermata!`、`"^rit."` / `"^accel."`，去掉下方声部重复的 `[Q:]`，并把点选区间整体平移。
  - `drawStaffGraduals`：abcjs 刻完后在 SVG 里画虚线（每行谱表一段），只往 SVG 里加线，不改宿主高度，所以不会触发布局循环。
  - `dropDoubledKeySignatures`：abcjs 自动换行时，途中转调之后源码换行处的那一行开头会把调号刻两遍；去掉重复的那份。试过用 `\` 续行，会让 abcjs 丢掉大部分 ♩=，不用。
- 打印（五线谱）同样刻这些记号，虚线在分页前画上。
- 测试：`staff-marks.test.ts`；浏览器：`scripts/verify-staff-marks.mjs`（含《匈牙利狂想曲第二号》五线谱稳定、无重复调号）。
