# 途中速度

吸收 [MuseScore 速度记号](https://handbook.musescore.org/text/tempo-markings) 的思路：在选中的音或休止上加上节拍器速度（♩=），从这里起改播放速度，谱面时值不变。只取功能，没有用它的代码、名称、文案或素材。渐快、渐慢见 docs/gradual-tempo.md。没有做意大利文速度用语。

## 用法

打开「写谱」，点谱上的音（或休止），在「途中速度」里填速度，再点「设为从这里起」。简谱（屏幕和打印）会在该处标出 ♩=。再点「去掉此处速度」可取消，一步撤销。全曲开头仍用「移调与乐器」里的速度。选择记在谱子里（`Score.changes` 的 `bpm`），会随草稿、分享和已有的 MusicXML / MIDI 导入导出一起走。

播放、节拍器和 MIDI 本来就会跟随途中速度变化。不改写成谱时值。五线谱在该处上方刻 ♩=；与当前速度相同的重复记号不重刻，下方声部不重复标（r40，见 docs/staff-marks.md）。

## 实现

纯函数在 `src/lib/music/tempo-mark.ts`（不进 score-core）。沿用已有的 `Score.changes`，不改 `isScore`。
