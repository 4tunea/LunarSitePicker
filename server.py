"""Optional local server for the demo.

Serves this folder at http://localhost:8000 and adds /horizons, a small proxy
to the JPL Horizons API so the page can compare its own numbers with JPL's.
The page works without it (open index.html directly); only the
"Check against JPL Horizons" button needs this server.

Run:  python server.py
"""
import json
import os
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

API = "https://ssd.jpl.nasa.gov/api/horizons.api"


def horizons(body, lat, lon, start):
    stop = start + timedelta(hours=3)
    params = {
        "format": "text", "COMMAND": f"'{body}'", "OBJ_DATA": "'NO'", "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'", "CENTER": "'coord@301'", "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": f"'{lon},{lat},0'", "START_TIME": f"'{start:%Y-%m-%d %H:%M}'",
        "STOP_TIME": f"'{stop:%Y-%m-%d %H:%M}'", "STEP_SIZE": "'1 h'", "QUANTITIES": "'4'",
    }
    with urllib.request.urlopen(API + "?" + urllib.parse.urlencode(params), timeout=30) as r:
        text = r.read().decode("utf-8", "replace")
    if "$$SOE" in text and "$$EOE" in text:
        return text.split("$$SOE")[1].split("$$EOE")[0].strip("\n")
    return text[-1500:]


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        if url.path != "/horizons":
            return super().do_GET()
        try:
            q = urllib.parse.parse_qs(url.query)
            lat, lon = float(q["lat"][0]), float(q["lon"][0])
            start = datetime.strptime(q["start"][0], "%Y-%m-%dT%H:%M")
            out = {"sun": horizons(10, lat, lon, start), "earth": horizons(399, lat, lon, start)}
        except Exception as exc:  # report the problem to the page instead of failing silently
            out = {"error": str(exc)}
        data = json.dumps(out).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    print("Lunar landing site navigator: http://localhost:8000")
    ThreadingHTTPServer(("127.0.0.1", 8000), Handler).serve_forever()
