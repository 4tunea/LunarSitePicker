"""Embed a sharper NASA Moon map in the 3D globe.

    python web/tools/build_texture.py          4096 x 2048 map (about 50 MB download)
    python web/tools/build_texture.py --8k     8192 x 4096 map (about 200 MB download)

Downloads the NASA SVS "CGI Moon Kit" colour map (LRO camera) as a 16-bit TIFF into data/,
converts it to JPEG and writes moon-texture.js at the project root, which index.html loads.
Needs Pillow (pip install pillow) or OpenCV (pip install opencv-python).
"""
import base64, os, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SIZE = "8k" if "--8k" in sys.argv else "4k"
URL = "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_16bit_srgb_%s.tif" % SIZE
TIF = os.path.join(ROOT, "data", "lroc_color_16bit_srgb_%s.tif" % SIZE)
JPG = os.path.join(ROOT, "data", "moon_%s.jpg" % SIZE)


def download(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        print("using saved copy:", os.path.relpath(path, ROOT)); return
    print("downloading", url)
    req = urllib.request.Request(url, headers={"User-Agent": "lunar-landing-navigator/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r, open(path + ".part", "wb") as f:
        total, done = int(r.headers.get("Content-Length") or 0), 0
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk); done += len(chunk)
            if total:
                sys.stdout.write("\r%3d%% of %d MB" % (100 * done // total, total >> 20)); sys.stdout.flush()
    print(); os.replace(path + ".part", path)


def to_jpeg(tif, jpg):
    try:
        from PIL import Image
        Image.MAX_IMAGE_PIXELS = None
        im = Image.open(tif).convert("RGB")
        im.save(jpg, quality=88)
        return im.size
    except ImportError:
        pass
    try:
        import cv2
        a = cv2.imread(tif, cv2.IMREAD_UNCHANGED)
        if a is None:
            raise RuntimeError("OpenCV could not read the TIFF")
        if a.dtype != "uint8":
            a = (a / 257).astype("uint8")
        cv2.imwrite(jpg, a, [cv2.IMWRITE_JPEG_QUALITY, 88])
        return (a.shape[1], a.shape[0])
    except ImportError:
        raise SystemExit("Install Pillow first:  pip install pillow")


os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
download(URL, TIF)
w, h = to_jpeg(TIF, JPG)
raw = open(JPG, "rb").read()
with open(os.path.join(ROOT, "moon-texture.js"), "w") as f:
    f.write("/* NASA SVS CGI Moon Kit colour map (LRO camera), %d x %d. Written by web/tools/build_texture.py. */\n" % (w, h))
    f.write('var MOON_TEXTURE = "data:image/jpeg;base64,%s";\n' % base64.b64encode(raw).decode("ascii"))
    f.write('var MOON_TEXTURE_SOURCE = "NASA LRO colour map";\n')
print("wrote moon-texture.js: %d x %d, %.1f MB. Reload the page." % (w, h, len(raw) * 4 / 3 / 1e6))
