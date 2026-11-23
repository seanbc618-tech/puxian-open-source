# 延长记号

吸收 [MuseScore 呼吸与停顿](https://handbook.musescore.org/notation/expressive-markings/breaths-and-pauses) 的思路：在音或休止上加延长记号，播放时该段按 1.5 倍时值放慢，其他声部一起等。只取功能，没有用它的代码、名称、文案或素材。

## 用法

打开「表情记号」，点谱上的音（或休止），再点「延长」。再点一次或「去掉记号」可取消。一步撤销。简谱（屏幕和打印）在该音上方画出延长记号。选择记在谱子里（`Score.fermatas`），会随草稿、分享和 MusicXML / 123 导入导出一起走。

播放、MIDI 导出和反复展开后的第二遍都会按 1.5 倍时值延长；节拍器在这一段也会放慢。不改写成谱时值。五线谱也刻这个记号（r40，在懒加载的编辑器块里加刻，不改 `notation.ts`，见 docs/staff-marks.md）。

## 实现

纯函数在 `src/lib/music/fermata.ts`（不进 score-core）。播放时只改一份临时的速度变化，不写回草稿。
