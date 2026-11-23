"""Development-only SMT -> ONNX export. Requires upstream MIT SMT checkout.
Usage: python scripts/omr/export.py UPSTREAM_CHECKOUT WEIGHT_DIRECTORY OUTPUT
No user image leaves this process. Browser inference uses only exported ONNX.
"""
import sys, json, hashlib
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import torch
from smt_model import SMTModelForCausalLM

source, target = Path(sys.argv[2]), Path(sys.argv[3])
target.mkdir(parents=True, exist_ok=True)
torch.set_num_threads(2)
model, info = SMTModelForCausalLM.from_pretrained(source, output_loading_info=True)
assert not info["missing_keys"] and not info["unexpected_keys"], info
model.eval()

class Encoder(torch.nn.Module):
    def __init__(self):
        super().__init__(); self.model = model
    def forward(self, image):
        raw = self.model.forward_encoder(image)
        positional = self.model.positional_2D(raw)
        return raw.flatten(2).permute(2,0,1), positional.flatten(2).permute(2,0,1)

class Decoder(torch.nn.Module):
    def __init__(self):
        super().__init__(); self.model = model
    def forward(self, tokens, raw, positional):
        _, logits, _, _, _ = self.model.decoder(raw, positional, tokens, None, [tokens.shape[1]], (1,256,12,64), keep_all_weights=True)
        return logits[:,:,-1]

image = torch.ones(1,1,192,1024)
with torch.no_grad():
    raw, pos = Encoder()(image)
    torch.onnx.export(Encoder(), (image,), target/"encoder.onnx", input_names=["image"], output_names=["raw","positional"], dynamic_axes={"image":{2:"height",3:"width"},"raw":{0:"pixels"},"positional":{0:"pixels"}},opset_version=17,dynamo=False)
    torch.onnx.export(Decoder(), (torch.tensor([[model.w2i["<bos>"]]]),raw,pos), target/"decoder.onnx",input_names=["tokens","raw","positional"],output_names=["logits"],dynamic_axes={"tokens":{1:"length"},"raw":{0:"pixels"},"positional":{0:"pixels"}},opset_version=17,dynamo=False)
(target/"vocabulary.json").write_text(json.dumps({"i2w":model.i2w,"bos":model.w2i["<bos>"],"maxLength":model.maxlen},ensure_ascii=False))
files=[]
for name in ["encoder.onnx","decoder.onnx","vocabulary.json"]:
    data=(target/name).read_bytes(); files.append({"name":name,"bytes":len(data),"sha256":hashlib.sha256(data).hexdigest()})
(target/"manifest.json").write_text(json.dumps({"id":"smt-grandstaff-2eb5a45-onnx17-v1","files":files},indent=2)+"\n")
print(json.dumps(files,indent=2))
