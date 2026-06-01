#!/usr/bin/env python3
"""Lookup SPF, DKIM, and DMARC TXT records for an email domain.

Uses only the Python standard library and the system `nslookup` command so it
can run without installing extra packages.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import re
import random
import socket
import struct
import sys


DEFAULT_DKIM_SELECTORS = [
    "default",
    "selector1",
    "selector2",
    "google",
    "k1",
    "s1",
    "s2",
    "mail",
    "smtp",
    "mandrill",
]


def domain_from_email(value):
    text = (value or "").strip().lower()
    if "@" in text:
        return text.rsplit("@", 1)[1].strip(" >")
    return text


def normalize_txt(output):
    records = []
    for line in output.splitlines():
        if "text =" not in line.lower() and "txt =" not in line.lower():
            continue

        quoted_parts = re.findall(r'"([^"]*)"', line)
        if quoted_parts:
            records.append("".join(quoted_parts).strip())
            continue

        _, _, tail = line.partition("=")
        if tail.strip():
            records.append(tail.strip().strip('"'))

    return [record for record in records if record]


def encode_name(name):
    return b"".join(bytes([len(part)]) + part.encode("ascii") for part in name.rstrip(".").split(".")) + b"\x00"


def skip_name(packet, offset):
    while True:
        length = packet[offset]
        if length & 0xC0 == 0xC0:
            return offset + 2
        if length == 0:
            return offset + 1
        offset += length + 1


def query_txt_once(name, server):
    query_id = random.randint(0, 65535)
    header = struct.pack("!HHHHHH", query_id, 0x0100, 1, 0, 0, 0)
    question = encode_name(name) + struct.pack("!HH", 16, 1)
    packet = header + question

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(1.25)
    try:
      sock.sendto(packet, (server, 53))
      response, _ = sock.recvfrom(4096)
    finally:
      sock.close()

    response_id, _, qdcount, ancount, _, _ = struct.unpack("!HHHHHH", response[:12])
    if response_id != query_id:
        raise RuntimeError("DNS response id mismatch")

    offset = 12
    for _ in range(qdcount):
        offset = skip_name(response, offset) + 4

    records = []
    for _ in range(ancount):
        offset = skip_name(response, offset)
        record_type, _, _, rdlength = struct.unpack("!HHIH", response[offset:offset + 10])
        offset += 10
        rdata = response[offset:offset + rdlength]
        offset += rdlength
        if record_type != 16:
            continue

        text_parts = []
        cursor = 0
        while cursor < len(rdata):
            size = rdata[cursor]
            cursor += 1
            text_parts.append(rdata[cursor:cursor + size].decode("utf-8", "replace"))
            cursor += size
        records.append("".join(text_parts))

    return records


def query_txt(name):
    errors = []
    for server in ("1.1.1.1", "8.8.8.8"):
        try:
            records = query_txt_once(name, server)
            return {"name": name, "records": records, "error": "" if records else "No TXT records found"}
        except Exception as error:
            errors.append(f"{server}: {error}")
    return {"name": name, "records": [], "error": "; ".join(errors)}


def main():
    parser = argparse.ArgumentParser(description="Lookup SPF, DKIM, and DMARC records.")
    parser.add_argument("email_or_domain")
    parser.add_argument("--selector", default="default")
    parser.add_argument("--selectors", default="")
    args = parser.parse_args()

    domain = domain_from_email(args.email_or_domain)
    selectors = [item.strip() for item in args.selectors.split(",") if item.strip()]
    selectors = list(dict.fromkeys([args.selector, *selectors, *DEFAULT_DKIM_SELECTORS]))

    with ThreadPoolExecutor(max_workers=8) as executor:
        txt_future = executor.submit(query_txt, domain)
        dmarc_future = executor.submit(query_txt, f"_dmarc.{domain}")
        dkim_futures = [executor.submit(query_txt, f"{selector}._domainkey.{domain}") for selector in selectors]
        txt = txt_future.result()
        dmarc = dmarc_future.result()
        dkim_results = [future.result() for future in as_completed(dkim_futures)]

    spf_records = [record for record in txt["records"] if record.lower().startswith("v=spf1")]
    dmarc_records = [record for record in dmarc["records"] if record.lower().startswith("v=dmarc1")]
    dkim_matches = [
        {"selector": result["name"].split("._domainkey.", 1)[0], "records": result["records"]}
        for result in dkim_results
        if any("v=dkim1" in record.lower() or "k=rsa" in record.lower() for record in result["records"])
    ]

    payload = {
        "domain": domain,
        "spf": bool(spf_records),
        "dkim": bool(dkim_matches),
        "dmarc": bool(dmarc_records),
        "ok": bool(spf_records and dkim_matches and dmarc_records),
        "records": {
            "spf": spf_records,
            "dmarc": dmarc_records,
            "dkim": dkim_matches,
        },
        "errors": {
            "domain": txt["error"] if not spf_records else "",
            "dmarc": dmarc["error"] if not dmarc_records else "",
            "dkim": [result for result in dkim_results if result["error"] and not result["records"]][:3],
        },
    }

    print(json.dumps(payload))
    return 0


if __name__ == "__main__":
    sys.exit(main())
