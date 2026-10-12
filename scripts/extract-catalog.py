#!/usr/bin/env python3
"""Extract the linkable catalogue entries published by Prescot.

Usage (requires beautifulsoup4):
    python3 scripts/extract-catalog.py
    python3 scripts/extract-catalog.py /path/to/downloaded-katalog.html

The catalogue HTML is the source of truth. A record represents an existing
model-* anchor: either an individual product or a named family. Family variants
are retained separately; they are not silently promoted to invented anchors.
Relative asset paths honour the HTML <base> element. No availability, pricing,
compatibility or warranty is inferred from another product.
"""

from __future__ import annotations

import argparse
from collections import Counter
from datetime import date
import json
from pathlib import Path
import re
from urllib.parse import quote, urlencode, urljoin, urlparse, parse_qs, unquote
from urllib.request import Request, urlopen

from bs4 import BeautifulSoup, Tag


OFFICIAL_URL = "https://www.prescot.pl/katalog/"
DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "private" / "catalog.json"


def clean(value: str | None) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def text(node: Tag | None) -> str:
    return clean(node.get_text(" ", strip=True)) if node else ""


def warranty(value: str) -> str:
    """Normalize the published unit/grammar, without adding warranty claims."""
    raw = clean(value)
    months = re.fullmatch(r"(\d+)\s+miesi(?:ące|ęcy|ąc)", raw, re.I)
    years = re.fullmatch(r"(\d+)\s+(?:lat|lata|rok)", raw, re.I)
    number = None
    if years:
        number = int(years[1])
    elif months and int(months[1]) % 12 == 0:
        number = int(months[1]) // 12
    if number is None:
        return raw
    suffix = "rok" if number == 1 else "lata" if number % 10 in (2, 3, 4) and number % 100 not in (12, 13, 14) else "lat"
    return f"{number} {suffix}"


def model_specs(model: Tag) -> dict[str, str]:
    result: dict[str, str] = {}
    for cell in model.select(".so-specs > div"):
        # Nested variant facts must not overwrite family-level values.
        if cell.find_parent(class_="so-model") is not model or cell.find_parent(attrs={"data-catalog-variant": True}):
            continue
        key, value = text(cell.find("dt")), text(cell.find("dd"))
        if key and value and value != "—":
            result[key] = value
    return result


def direct_cell_text(cell: Tag) -> str:
    # Variant cells sometimes contain a details block with many extra specs.
    clone = BeautifulSoup(str(cell), "html.parser")
    for details in clone.select("details"):
        details.decompose()
    return text(clone)


def model_variants(model: Tag, family_name: str) -> list[dict]:
    result = []
    seen: set[str] = set()
    for row in model.select("[data-variant-record]"):
        if row.find_parent(class_="so-model") is not model:
            continue
        data = json.loads(row["data-variant-record"])
        sku = clean(data.get("sku"))
        if not sku:
            raise ValueError(f"Variant without SKU in {model['id']}")
        if sku in seen:
            continue
        seen.add(sku)
        specs = {clean(k): clean(v) for k, v in data.get("specs", []) if clean(k) and clean(v)}
        labels = {
            cell.get("data-label"): direct_cell_text(cell)
            for cell in row.find_all("td", recursive=False)
        }
        descriptor = " · ".join(dict.fromkeys(filter(None, [
            labels.get("Wykończenie / wykonanie"), labels.get("Długość")
        ])))
        name = family_name
        if descriptor and descriptor.casefold() != name.casefold():
            name += " · " + descriptor
        item = {"sku": sku, "name": name, "ean": clean(data.get("ean")), "specs": specs}
        if data.get("compatibleProfiles"):
            # These are explicitly published relationships, not inferred matches.
            item["compatibleProfiles"] = list(dict.fromkeys(data["compatibleProfiles"]))
        result.append(item)
    return result


def model_name(model: Tag, category: str, family: str, specs: dict[str, str]) -> str:
    explicit = text(model.select_one(".oc-model-name"))
    if explicit:
        return explicit
    if category == "tasmy":
        name = "Taśma LED " + family
    elif category == "oprawy":
        name = "Oprawa LED " + family
    else:
        name = text(model.select_one("summary .so-index strong")) or family
    features = [specs.get("Barwa światła"), specs.get("Zasilanie DC"), specs.get("Moc")]
    return name + (" · " + " · ".join(filter(None, features)) if any(features) else "")


def summary(model: Tag, category: str, name: str, specs: dict[str, str]) -> str:
    def sentence(parts: list[str | None]) -> str:
        return ", ".join(filter(None, parts)).rstrip(" .") + "."

    if category == "tasmy":
        return sentence([
            "Taśma LED" + (" " + specs["Zasilanie DC"] if specs.get("Zasilanie DC") else ""),
            "moc " + specs["Moc"] if specs.get("Moc") else None,
            "barwa " + specs["Barwa światła"] if specs.get("Barwa światła") else None,
            "szerokość PCB " + specs["Szerokość PCB"] if specs.get("Szerokość PCB") else None,
            specs.get("Stopień ochrony"),
        ])
    if category == "oprawy":
        return sentence([
            "Oprawa LED " + model.get("data-family", ""),
            specs.get("Moc"), specs.get("Barwa światła"), specs.get("Stopień ochrony"),
        ])
    if category == "profile":
        return sentence([
            name,
            "kanał LED " + specs["Szerokość kanału LED"] if specs.get("Szerokość kanału LED") else None,
            "montaż: " + specs["Montaż"].lower() if specs.get("Montaż") else None,
        ])
    # The short published description is useful for connectors and components;
    # do not copy a long instruction into the outgoing message.
    description = model.select_one("[data-catalog-description] p")
    published = text(description)
    if published:
        first = re.split(r"(?<=[.!?])\s+(?=[A-ZĄĆĘŁŃÓŚŹŻ])", published, maxsplit=1)[0]
        if len(first) <= 240:
            return first if first.endswith((".", "!", "?")) else first + "."
    return name.rstrip(" .") + "."


def extract(html: str, source_url: str, updated: str) -> tuple[dict, dict]:
    soup = BeautifulSoup(html, "html.parser")
    base = soup.find("base", href=True)
    asset_base = urljoin(source_url, base["href"]) if base else source_url
    roots = {root["data-catalog-category"]: root for root in soup.select("[data-catalog-category]")}
    labels = {key: text(root.find("h2")) or key for key, root in roots.items()}
    models = soup.select('[id^="model-"]')
    if not models or not roots:
        raise ValueError("No catalogue model anchors or categories found; source format changed")

    products: dict[str, dict] = {}
    for model in models:
        if "so-model" not in model.get("class", []):
            raise ValueError(f"Unexpected model anchor: {model['id']}")
        root = model.find_parent(attrs={"data-catalog-category": True})
        if root is None:
            raise ValueError(f"No catalogue category for {model['id']}")
        category = root["data-catalog-category"]
        family = clean(model.get("data-family"))
        specs = model_specs(model)
        name = model_name(model, category, family, specs)
        variants = model_variants(model, name)
        image = model.select_one(".so-photo img")
        image_url = urljoin(asset_base, image.get("src", "")) if image and image.get("src") else ""
        parsed_image = urlparse(image_url) if image_url else None
        if parsed_image and parsed_image.scheme not in ("http", "https"):
            raise ValueError(f"Unsupported image URL for {model['id']}: {image_url}")
        model_id = model["id"]
        record = {
            "id": model_id,
            "sku": clean(model.get("data-sku")),
            "name": name,
            "category": category,
            "categoryLabel": labels[category],
            "family": family,
            "kind": "family" if variants or "kc-family" in model.get("class", []) else "product",
            "url": source_url.split("?", 1)[0].split("#", 1)[0] + "?" + urlencode({"kategoria": category}) + "#" + quote(model_id, safe="-_~."),
            "image": image_url,
            "warranty": warranty(specs.get("Gwarancja", "")),
            "summary": summary(model, category, name, specs),
            "specs": specs,
        }
        if variants:
            record["variants"] = variants
        if model_id in products and products[model_id] != record:
            raise ValueError(f"Conflicting duplicate anchor: {model_id}")
        products[model_id] = record

    records = list(products.values())
    anchors = {model["id"] for model in models}
    if set(products) != anchors:
        raise ValueError("Extraction does not cover every source model anchor")
    source_parsed = urlparse(source_url)
    for record in records:
        address = urlparse(record["url"])
        assert address.scheme == "https" and address.netloc == source_parsed.netloc
        assert address.path == source_parsed.path
        assert unquote(address.fragment) == record["id"]
        assert parse_qs(address.query)["kategoria"] == [record["category"]]
        assert record["sku"] and record["name"] and record["summary"]
    source_variants = len(soup.select("[data-variant-record]"))
    extracted_variants = sum(len(record.get("variants", [])) for record in records)
    images = {record["image"] for record in records if record["image"]}
    report = {
        "sourceAnchors": len(models),
        "uniqueAnchors": len(anchors),
        "extractedRecords": len(records),
        "kinds": dict(Counter(record["kind"] for record in records)),
        "categories": dict(Counter(record["category"] for record in records)),
        "sourceVariantRows": source_variants,
        "extractedVariants": extracted_variants,
        "uniqueImages": len(images),
        "withoutImage": sum(not record["image"] for record in records),
        "withoutWarranty": sum(not record["warranty"] for record in records),
        "imageHosts": dict(Counter(urlparse(image).netloc for image in images)),
        "nonHttpsImages": sorted(image for image in images if urlparse(image).scheme != "https"),
        "urlValidation": "all product URLs match an existing source anchor and category",
    }
    return {"updated": updated, "source": source_url, "products": records}, report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", nargs="?", default=OFFICIAL_URL, help="Saved catalogue HTML path or official URL")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--updated", default=date.today().isoformat(), help="Snapshot date, YYYY-MM-DD")
    args = parser.parse_args()
    date.fromisoformat(args.updated)
    if args.source.startswith(("http://", "https://")):
        parsed = urlparse(args.source)
        if parsed.scheme != "https" or parsed.netloc not in ("prescot.pl", "www.prescot.pl"):
            parser.error("Remote input must be an HTTPS address on prescot.pl")
        request = Request(args.source, headers={"User-Agent": "PrescotMailCatalog/1.0"})
        with urlopen(request, timeout=60) as response:
            html = response.read().decode("utf-8")
        source_url = args.source
    else:
        html = Path(args.source).read_text(encoding="utf-8")
        source_url = OFFICIAL_URL
    result, report = extract(html, source_url, args.updated)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    print(f"Saved {args.output}")


if __name__ == "__main__":
    main()
