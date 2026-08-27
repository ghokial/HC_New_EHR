from __future__ import annotations

import json
import sys
from pathlib import Path


path = Path(sys.argv[1])
start = int(sys.argv[2])
end = int(sys.argv[3])
data = json.loads(path.read_text(encoding="utf-8"))
paragraphs = [block for block in data["blocks"] if block["kind"] == "paragraph"]
for block in paragraphs[start:end]:
    print(f"{block['index']:04d}|{block.get('style')}|{block['text']}")
