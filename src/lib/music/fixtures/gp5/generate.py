"""Original test composition and GP5 writer. CC0-1.0; no third-party score data.
Run: python3 src/lib/music/fixtures/gp5/generate.py
One 4/4 bar, two voices; dotted chord, hammer/pull, brush, rest.
"""
import struct
from pathlib import Path
out = bytearray()
def b(*values): out.extend(bytes(values))
def i(value): out.extend(struct.pack('<i', value))
def z(count): out.extend(bytes(count))
def fixed(text, count):
    value = text.encode('ascii'); b(len(value)); out.extend(value); z(count-len(value))
def string(text=''):
    value = text.encode('ascii'); i(len(value)+1); b(len(value)); out.extend(value)
fixed('FICHIER GUITAR PRO v5.00', 30)
for text in ['Puxian original GP5 study', '', '', '', '', '', 'CC0-1.0', '', '']: string(text)
i(0) # notices
i(0) # lyrics track
for _ in range(5): i(1); i(0)
z(28); z(2)
for _ in range(11): string()
i(96); i(0); b(0)
for _ in range(64): i(24); b(100,64); z(6)
for _ in range(19): out.extend(struct.pack('<h', -1))
z(4); i(1); i(1) # bar, track count
b(3,4,4); z(4); b(0,0,0) # masterbar
b(8); fixed('Original guitar',40); i(6)
for tuning in [64,59,55,50,45,40,0]: i(tuning)
for value in [1,1,2,24,0,0]: i(value) # port, channels, frets, capo, color
b(3,0,0,0,0); i(0); i(0); i(0); z(10); z(2); z(16)
b(0) # bar header
# each beat: flags, duration, effects?, string mask, note records, flags2
# dotted quarter brushed E/G chord with hammer to next upper note
i(3)
b(9,0,64,0,0,4,96) # dotted + beat effects: brush down
b(40,1,0,0,2,0) # note: flags, type, fret, flags2, hammer flags, flags2
b(32,1,0,0) # second note
z(2)
b(0,1,64,32,1,2,0); z(2) # eighth F#
b(64,2,255,0); z(2) # half rest
# voice 2 whole low E
i(1); b(0,254,2,32,1,0,0); z(2)
Path(__file__).with_name('original-study.gp5').write_bytes(out)
