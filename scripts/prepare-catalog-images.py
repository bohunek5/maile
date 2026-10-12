#!/usr/bin/env python3
"""Prepare the catalogue photographs as small, email-compatible JPEG files.

Requires Pillow. Run after extract-catalog.py. Original URLs remain in
sourceImage; image becomes assets/catalog/<URL hash>.jpg on success. Missing
images stay empty. Repeated runs reuse valid, previously prepared JPEG files.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import time
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from PIL import Image, ImageOps


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def prepare(url: str, folder: Path, size: int, quality: int, timeout: float,
            retries: int, force: bool) -> dict:
    name = sha256(url.encode("utf-8")).hexdigest()[:16] + ".jpg"
    destination = folder / name
    result = {"source": url, "image": "assets/catalog/" + name}
    if destination.is_file() and not force:
        try:
            with Image.open(destination) as image:
                valid = image.format == "JPEG" and max(image.size) <= size
                image.verify()
            if valid:
                return {**result, "cached": True, "bytes": destination.stat().st_size}
        except (OSError, ValueError):
            pass
    error = ""
    for attempt in range(retries + 1):
        try:
            request = Request(url, headers={"User-Agent": "PrescotMailCatalogImages/1.0"})
            with urlopen(request, timeout=timeout) as response:
                data = response.read()
            with Image.open(BytesIO(data)) as original:
                image = ImageOps.exif_transpose(original)
                image.thumbnail((size, size), Image.Resampling.LANCZOS)
                if image.mode in ("RGBA", "LA") or "transparency" in image.info:
                    rgba = image.convert("RGBA")
                    converted = Image.new("RGB", rgba.size, "white")
                    converted.paste(rgba, mask=rgba.getchannel("A"))
                else:
                    converted = image.convert("RGB")
                temporary = destination.with_suffix(".tmp")
                converted.save(temporary, format="JPEG", quality=quality,
                               optimize=True, progressive=False)
                temporary.replace(destination)
            return {**result, "cached": False, "bytes": destination.stat().st_size}
        except Exception as exception:
            error = f"{type(exception).__name__}: {exception}"
            if attempt < retries:
                time.sleep(min(1.0 * 2 ** attempt, 4.0))
    return {"source": url, "error": error}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=PROJECT_ROOT / "private" / "catalog.json")
    parser.add_argument("--output", type=Path, default=PROJECT_ROOT / "assets" / "catalog")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--size", type=int, default=480)
    parser.add_argument("--quality", type=int, default=84)
    parser.add_argument("--timeout", type=float, default=30)
    parser.add_argument("--retries", type=int, default=3)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    if not 1 <= args.workers <= 16 or args.size < 1 or not 1 <= args.quality <= 95 or args.retries < 0:
        parser.error("Invalid workers, size, quality or retries")

    catalog = json.loads(args.catalog.read_text(encoding="utf-8"))
    urls = set()
    for product in catalog["products"]:
        source = product.get("sourceImage", product.get("image", ""))
        if source:
            address = urlparse(source)
            if address.scheme != "https" or address.netloc not in ("www.prescot.pl", "prescot.pl"):
                parser.error(f"Expected an original HTTPS Prescot image URL: {source}")
            urls.add(source)
        product["sourceImage"] = source
    args.output.mkdir(parents=True, exist_ok=True)
    results = {}
    started = time.monotonic()
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = [executor.submit(prepare, url, args.output, args.size, args.quality,
                                   args.timeout, args.retries, args.force) for url in sorted(urls)]
        for future in as_completed(futures):
            result = future.result()
            results[result["source"]] = result
            completed = len(results)
            if completed % 40 == 0 or completed == len(urls):
                failures = sum("error" in item for item in results.values())
                print(f"Prepared {completed}/{len(urls)}; failures {failures}", flush=True)

    # Publish the manifest only after conversion; readers never see partial JSON.
    for product in catalog["products"]:
        source = product["sourceImage"]
        product["image"] = results.get(source, {}).get("image", "")
    temporary_catalog = args.catalog.with_suffix(".json.tmp")
    temporary_catalog.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary_catalog.replace(args.catalog)
    failures = [item for item in results.values() if "error" in item]
    total_bytes = sum(item.get("bytes", 0) for item in results.values())
    print(json.dumps({
        "uniqueSources": len(urls),
        "prepared": len(results) - len(failures),
        "cached": sum(item.get("cached", False) for item in results.values()),
        "failed": len(failures),
        "failures": failures,
        "totalBytes": total_bytes,
        "totalMiB": round(total_bytes / 1024 / 1024, 2),
        "recordsWithImage": sum(bool(product["image"]) for product in catalog["products"]),
        "recordsWithoutImage": sum(not product["image"] for product in catalog["products"]),
        "maxDimension": args.size,
        "quality": args.quality,
        "seconds": round(time.monotonic() - started, 1),
    }, ensure_ascii=False, indent=2), flush=True)
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
