"""Build the Kimono Books PDF torture set.

    python make.py /out [case ...]

Writes <case>.pdf, <case>.truth.txt, <case>.meta.json and index.json to /out.
"""
import json
import sys
import time
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import warnings  # noqa: E402

warnings.filterwarnings('ignore')
import logging  # noqa: E402

logging.getLogger('weasyprint').setLevel(logging.ERROR)
logging.getLogger('fontTools').setLevel(logging.ERROR)

from common import CTX, clean_work  # noqa: E402
import c_wording, c_articles, c_images, c_layout, c_special  # noqa: E402

ALL = c_wording.CASES + c_articles.CASES + c_images.CASES + c_layout.CASES + c_special.CASES


def main():
    CTX.out = Path(sys.argv[1] if len(sys.argv) > 1 else '/out')
    CTX.out.mkdir(parents=True, exist_ok=True)
    only = set(sys.argv[2:])
    clean_work()
    failed = []
    for fn in ALL:
        name = fn.__name__.replace('_', '-')
        if only and name not in only and fn.__name__ not in only:
            continue
        t = time.time()
        print(f'{name} ...', flush=True)
        try:
            fn()
        except Exception:
            traceback.print_exc()
            failed.append(name)
        print(f'  ({time.time() - t:.1f}s)', flush=True)
    # index.json lists every case present in the output dir (so partial runs keep the rest).
    cases = []
    for m in sorted(CTX.out.glob('*.meta.json')):
        meta = json.loads(m.read_text())
        cases.append({'case': meta['case'], 'pdf': f"{meta['case']}.pdf", 'title': meta['title'],
                      'pages': meta['pages'], 'about': meta['about']})
    (CTX.out / 'index.json').write_text(json.dumps({'cases': cases}, ensure_ascii=False, indent=2) + '\n')
    if failed:
        print('FAILED:', ', '.join(failed))
        sys.exit(1)


if __name__ == '__main__':
    main()
