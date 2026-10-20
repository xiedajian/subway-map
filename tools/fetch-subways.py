#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
百度地图地铁示意图数据 · 批量抓取器（纯标准库，不需要 pip 装任何东西）

用法：
    python tools/fetch-subways.py                  # 抓全量 79 城（已存在的跳过）
    python tools/fetch-subways.py --only 131,289   # 只抓指定城市
    python tools/fetch-subways.py --force          # 全部重下（含城市列表）
    python tools/fetch-subways.py --delay 0.8      # 放慢间隔

产出（默认落在项目根目录的 data/）：
    data/cities.json         qt=subwayscity 的原始响应（79 城 + 数据版本）
    data/city-<code>.json    qt=subways 的原始响应（该城市的线路+站点示意图数据）
    data/index.json          抓取清单，页面靠它决定哪些城市可选、哪些置灰

接口说明：
    城市列表  GET https://map.baidu.com/?qt=subwayscity&t=<毫秒时间戳>
    城市数据  GET https://map.baidu.com/?qt=subways&c=<code>&format=json&t=<毫秒时间戳>
    注意：请求头绝不能带 Origin，否则上游直接返回 403。
"""

import argparse
import datetime
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request

try:  # Windows 控制台中文输出
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

HOST = "https://map.baidu.com"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Referer": "https://map.baidu.com/subway/",
    "Accept": "*/*",
    "Accept-Language": "zh-CN,zh;q=0.9",
}

# 中国港澳台：code 2911/2912 + 台北(9002)/高雄(9019)
HK_MO_TW = {"2911", "2912", "9002", "9019"}

GROUP_DOMESTIC = "国内"
GROUP_HMT = "中国港澳台"
GROUP_OVERSEAS = "海外"


def group_of(code, cename):
    s = str(code)
    if s in HK_MO_TW or cename in ("taibei", "gaoxiong", "hongkong", "aomen"):
        return GROUP_HMT
    return GROUP_DOMESTIC if code < 3000 else GROUP_OVERSEAS


def fetch(path, retries, timeout, delay):
    """带重试的 GET，返回原始 bytes。"""
    url = HOST + path
    last = None
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                if r.status != 200:
                    raise urllib.error.HTTPError(url, r.status, "bad status", r.headers, None)
                return r.read()
        except Exception as e:  # noqa: BLE001
            last = e
            if attempt < retries:
                time.sleep(delay * (2 ** attempt))
    raise last if last else RuntimeError("unknown error")


def stats_of(obj):
    """从 qt=subways 响应里提取统计信息。"""
    sw = obj.get("subways") or {}
    lines = sw.get("l") or []
    points = 0
    stations = set()
    for ln in lines:
        for p in ln.get("p") or []:
            a = p.get("p_xmlattr") or {}
            points += 1
            if a.get("st") and a.get("sid"):
                stations.add(a["sid"])
    return len(lines), len(stations), points


def main():
    ap = argparse.ArgumentParser(description="百度地图地铁示意图数据批量抓取")
    ap.add_argument("--out", default="data", help="输出目录（默认 data）")
    ap.add_argument("--only", default="", help="只抓这些城市 code，逗号分隔，如 131,289")
    ap.add_argument("--force", action="store_true", help="已存在也重新下载")
    ap.add_argument("--delay", type=float, default=0.4, help="城与城之间的间隔秒数（默认 0.4）")
    ap.add_argument("--retries", type=int, default=3, help="单次请求最大尝试次数（默认 3）")
    ap.add_argument("--timeout", type=float, default=20.0, help="单次请求超时秒数（默认 20）")
    args = ap.parse_args()

    out_dir = os.path.abspath(args.out)
    os.makedirs(out_dir, exist_ok=True)
    cities_path = os.path.join(out_dir, "cities.json")

    # ---------- 1. 城市列表 ----------
    if args.force or not os.path.exists(cities_path):
        print("[1/2] 拉取城市列表 qt=subwayscity ...")
        body = fetch("/?qt=subwayscity&t=%d" % int(time.time() * 1000), args.retries, args.timeout, args.delay)
        with io.open(cities_path, "wb") as f:
            f.write(body)
        print("      -> %s (%d bytes)" % (cities_path, len(body)))
    else:
        print("[1/2] 城市列表已存在，跳过（--force 可重下）")

    with io.open(cities_path, encoding="utf-8") as f:
        cities_raw = json.load(f)
    data_version = str(cities_raw.get("result", {}).get("subwayVersion", ""))
    cities = cities_raw["subways_city"]["cities"]

    only = set(x.strip() for x in args.only.split(",") if x.strip())
    if only:
        cities = [c for c in cities if str(c["code"]) in only]
        print("      限定城市 %d 个：%s" % (len(cities), ",".join(sorted(only))))

    # ---------- 2. 逐城抓取 ----------
    print("[2/2] 开始抓取 %d 个城市的 qt=subways ..." % len(cities))
    records = []
    ok_cnt = empty_cnt = fail_cnt = skip_cnt = 0
    t0 = time.time()

    for i, c in enumerate(cities, 1):
        code = str(c["code"])
        cname = c.get("cn_name", "")
        target = os.path.join(out_dir, "city-%s.json" % code)
        rec = {
            "code": int(c["code"]),
            "cn_name": cname,
            "cename": c.get("cename", ""),
            "cpre": c.get("cpre", ""),
            "group": group_of(int(c["code"]), c.get("cename", "")),
            "file": "city-%s.json" % code,
            "ok": False,
            "reason": "",
            "lines": 0,
            "stations": 0,
            "points": 0,
            "bytes": 0,
        }

        if os.path.exists(target) and not args.force:
            try:
                with io.open(target, encoding="utf-8") as f:
                    obj = json.load(f)
                ln, st, pt = stats_of(obj)
                rec.update(ok=ln > 0, reason="" if ln > 0 else "empty",
                           lines=ln, stations=st, points=pt,
                           bytes=os.path.getsize(target))
                skip_cnt += 1
                print("  [%2d/%d] %-14s %-6s 已有文件  %2d线/%3d站  %s"
                      % (i, len(cities), cname, code, ln, st, "ok" if ln else "empty"))
            except Exception as e:  # noqa: BLE001
                rec.update(reason="corrupt:%s" % e)
                fail_cnt += 1
                print("  [%2d/%d] %-14s %-6s 本地文件损坏  %s" % (i, len(cities), cname, code, e))
            records.append(rec)
            continue

        try:
            body = fetch("/?qt=subways&c=%s&format=json&t=%d" % (code, int(time.time() * 1000)),
                         args.retries, args.timeout, args.delay)
            try:
                obj = json.loads(body.decode("utf-8"))
            except Exception:  # noqa: BLE001
                rec.update(reason="not-json(可能触发人机验证)")
                fail_cnt += 1
                print("  [%2d/%d] %-14s %-6s 返回非 JSON，%d bytes" % (i, len(cities), cname, code, len(body)))
                records.append(rec)
                time.sleep(args.delay)
                continue

            err = str((obj.get("result") or {}).get("error", "0"))
            ln, st, pt = stats_of(obj)
            if err not in ("0", "None", ""):
                rec.update(reason="api-error-%s" % err)
                fail_cnt += 1
                print("  [%2d/%d] %-14s %-6s 接口报错 error=%s" % (i, len(cities), cname, code, err))
            elif ln == 0:
                with io.open(target, "wb") as f:
                    f.write(body)
                rec.update(ok=False, reason="empty", bytes=len(body))
                empty_cnt += 1
                print("  [%2d/%d] %-14s %-6s 空数据（该城无地铁示意图）" % (i, len(cities), cname, code))
            else:
                with io.open(target, "wb") as f:
                    f.write(body)
                rec.update(ok=True, reason="", lines=ln, stations=st, points=pt, bytes=len(body))
                ok_cnt += 1
                print("  [%2d/%d] %-14s %-6s %2d线/%3d站/%4d点  %6.1fKB  ok"
                      % (i, len(cities), cname, code, ln, st, pt, len(body) / 1024))
        except Exception as e:  # noqa: BLE001
            rec.update(reason="fail:%s" % e)
            fail_cnt += 1
            print("  [%2d/%d] %-14s %-6s 失败：%s" % (i, len(cities), cname, code, e))

        records.append(rec)
        time.sleep(args.delay)

    # ---------- 3. 清单 ----------
    records.sort(key=lambda r: (r["group"], r["cpre"] or r["cename"]))
    index = {
        "generatedAt": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        "dataVersion": data_version,
        "total": len(records),
        "ok": sum(1 for r in records if r["ok"]),
        "empty": sum(1 for r in records if r["reason"] == "empty"),
        "failed": sum(1 for r in records if not r["ok"] and r["reason"] != "empty"),
        "cities": records,
    }
    index_path = os.path.join(out_dir, "index.json")
    with io.open(index_path, "w", encoding="utf-8") as f:
        f.write(json.dumps(index, ensure_ascii=False, indent=2))

    print("\n完成，用时 %.1fs" % (time.time() - t0))
    print("  清单：%s" % index_path)
    print("  数据版本：%s" % data_version)
    print("  可用 %d / 空数据 %d / 失败 %d / 复用本地 %d（共 %d）"
          % (index["ok"], index["empty"], index["failed"], skip_cnt, index["total"]))
    bad = [r for r in records if not r["ok"]]
    if bad:
        print("  需要关注的城市：")
        for r in bad:
            print("    %-14s %-6s %s" % (r["cn_name"], r["code"], r["reason"]))


if __name__ == "__main__":
    main()
