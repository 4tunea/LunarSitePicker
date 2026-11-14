"""Minimal PDS3 label reader for the LOLA gridded products (LDEM_75S_120M.LBL and friends).

Only what the pipeline needs: KEY = value pairs, OBJECT ... END_OBJECT groups, units in
angle brackets, quoted strings, and {set} / (sequence) values. Values are converted to int
or float when they look like numbers; everything else stays a string.

    from precompute.pds_label import read_label, dem_geometry
    lbl = read_label("data/LDEM_75S_120M.LBL")
    geo = dem_geometry(lbl)      # lines, samples, scale_m, pole_line, pole_sample, ...

The geometry comes from the label, never from the file size (CLAUDE.md, Data section).
"""
from __future__ import annotations

import re
from pathlib import Path

_UNIT = re.compile(r"\s*<([^>]*)>\s*$")
_NUMBER = re.compile(r"^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$")


def _convert(raw: str):
    """'7624' -> 7624, '120 <m/pix>' -> (120.0, 'm/pix'), '"EAST"' -> 'EAST'."""
    raw = raw.strip()
    unit = None
    m = _UNIT.search(raw)
    if m:
        unit = m.group(1).strip()
        raw = raw[: m.start()].strip()
    if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in "\"'":
        value = raw[1:-1]
    elif raw.startswith("{") and raw.endswith("}") or raw.startswith("(") and raw.endswith(")"):
        inner = raw[1:-1]
        value = [_convert(x)[0] for x in _split_top(inner)]
    elif _NUMBER.match(raw):
        value = float(raw) if any(c in raw for c in ".eE") else int(raw)
    else:
        value = raw
    return value, unit


def _split_top(s: str):
    """Split on commas that are not inside quotes."""
    out, cur, q = [], [], None
    for ch in s:
        if q:
            cur.append(ch)
            if ch == q:
                q = None
        elif ch in "\"'":
            q = ch
            cur.append(ch)
        elif ch == ",":
            out.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    if "".join(cur).strip():
        out.append("".join(cur))
    return out


def _statements(text: str):
    """Yield (key, raw_value) with multi-line values joined. Strips /* comments */."""
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    key, buf = None, []
    for line in text.splitlines():
        if not line.strip():
            continue
        m = re.match(r"^\s*(\^?[A-Za-z_][A-Za-z0-9_:]*)\s*=\s*(.*)$", line)
        if m and key is not None and not _open(" ".join(buf)):
            yield key, " ".join(buf)
            key, buf = None, []
        if m and key is None:
            key, buf = m.group(1), [m.group(2).strip()]
        elif key is not None:
            buf.append(line.strip())
        elif line.strip() == "END":
            break
        if key is not None and not _open(" ".join(buf)) and key not in ("OBJECT", "END_OBJECT"):
            pass
    if key is not None:
        yield key, " ".join(buf)


def _open(s: str) -> bool:
    """True while a value is still open: unbalanced quotes, braces or parentheses."""
    q = None
    depth = 0
    for ch in s:
        if q:
            if ch == q:
                q = None
        elif ch in "\"'":
            q = ch
        elif ch in "{(":
            depth += 1
        elif ch in "})":
            depth -= 1
    return q is not None or depth > 0


def read_label(path) -> dict:
    """Parse a PDS3 label into nested dicts keyed by OBJECT name.

    Top-level keywords go in the root dict; each OBJECT = X becomes a nested dict under X
    (repeated objects become lists). Units are kept in a parallel '_units' dict per level.
    """
    text = Path(path).read_text(encoding="latin-1")
    root: dict = {"_units": {}}
    stack = [root]
    for key, raw in _statements(text):
        if key == "OBJECT":
            name = _convert(raw)[0]
            node: dict = {"_units": {}}
            parent = stack[-1]
            if name in parent:
                if isinstance(parent[name], list):
                    parent[name].append(node)
                else:
                    parent[name] = [parent[name], node]
            else:
                parent[name] = node
            stack.append(node)
        elif key == "END_OBJECT":
            if len(stack) > 1:
                stack.pop()
        elif key == "END":
            break
        else:
            value, unit = _convert(raw)
            stack[-1][key] = value
            if unit:
                stack[-1]["_units"][key] = unit
    return root


_DTYPES = {("LSB_INTEGER", 16): "<i2", ("MSB_INTEGER", 16): ">i2",
           ("LSB_UNSIGNED_INTEGER", 16): "<u2", ("MSB_UNSIGNED_INTEGER", 16): ">u2",
           ("PC_REAL", 32): "<f4", ("IEEE_REAL", 32): ">f4"}


def dem_geometry(label: dict) -> dict:
    """Everything needed to go from (lat, lon) to a pixel and from a DN to metres."""
    f = label["UNCOMPRESSED_FILE"] if "UNCOMPRESSED_FILE" in label else label
    img = f["IMAGE"]
    mp = label["IMAGE_MAP_PROJECTION"]
    units = mp["_units"]
    radius_km = float(mp["A_AXIS_RADIUS"])
    if units.get("A_AXIS_RADIUS", "km").lower() == "m":
        radius_km /= 1000.0
    scale = float(mp["MAP_SCALE"])
    if units.get("MAP_SCALE", "m/pix").lower().startswith("km"):
        scale *= 1000.0
    dtype = _DTYPES.get((str(img["SAMPLE_TYPE"]), int(img["SAMPLE_BITS"])))
    if dtype is None:
        raise ValueError("unsupported SAMPLE_TYPE/SAMPLE_BITS: %r/%r" % (img["SAMPLE_TYPE"], img["SAMPLE_BITS"]))
    return {
        "lines": int(img["LINES"]),
        "samples": int(img["LINE_SAMPLES"]),
        "dtype": dtype,
        "scaling_factor": float(img.get("SCALING_FACTOR", 1.0)),   # metres per DN
        "offset_m": float(img.get("OFFSET", 0.0)),                  # reference radius, metres
        "projection": str(mp["MAP_PROJECTION_TYPE"]),
        "center_lat_deg": float(mp["CENTER_LATITUDE"]),
        "center_lon_deg": float(mp["CENTER_LONGITUDE"]),
        "scale_m": scale,                                            # metres per pixel, true at the pole
        "resolution_pix_per_deg": float(mp["MAP_RESOLUTION"]),
        "pole_line": float(mp["LINE_PROJECTION_OFFSET"]),            # pole, pixel-centre coords (pixel 0 centre = 0)
        "pole_sample": float(mp["SAMPLE_PROJECTION_OFFSET"]),        # pole, pixel-centre coords (pixel 0 centre = 0)
        "radius_km": radius_km,
        "positive_longitude": str(mp["POSITIVE_LONGITUDE_DIRECTION"]).upper(),
        "min_lat_deg": float(mp["MINIMUM_LATITUDE"]),
        "max_lat_deg": float(mp["MAXIMUM_LATITUDE"]),
        "coordinate_system": str(mp.get("COORDINATE_SYSTEM_NAME", "")),
        "expected_bytes": int(img["LINES"]) * int(img["LINE_SAMPLES"]) * int(img["SAMPLE_BITS"]) // 8,
    }


if __name__ == "__main__":
    import json
    import sys

    lbl = read_label(sys.argv[1] if len(sys.argv) > 1 else "data/LDEM_75S_120M.LBL")
    print(json.dumps(dem_geometry(lbl), indent=2))
