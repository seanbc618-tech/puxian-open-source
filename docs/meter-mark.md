# 途中拍号

吸收 [MuseScore 拍号](https://handbook.musescore.org/notation/rhythm-meter-and-measures/time-signatures) 的思路：在选中的音或休止所在小节加上新的拍号，从这一小节开头起改拍。只取功能，没有用它的代码、名称、文案或素材。没有做复合拍号、局部拍号或把后面的音按新拍号重新分小节改写。

## 用法

打开「写谱」，点谱上第二小节及之后的音（或休止），在「途中拍号」里选拍号，再点「设为从这小节起」。记号落在该小节开头；简谱（屏幕和打印）会在该处标出拍号。再点「去掉此处拍号」可取消，一步撤销。第一小节或全曲开头仍用「移调与乐器」里的拍号。选择记在谱子里（`Score.changes` 的 `beats` / `beatUnit`），会随草稿、分享和已有的 MusicXML / MIDI 导入导出一起走。

播放、节拍器、拍数核对和 MIDI 本来就会跟随途中拍号。不改写成谱时值。五线谱在该小节开头刻新拍号（r40，见 docs/staff-marks.md）。

## 实现

纯函数在 `src/lib/music/meter-mark.ts`（不进 score-core）。沿用已有的 `Score.changes`，不改 `isScore`。
