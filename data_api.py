# data_api.py - 最终完整版 (带兼容接口)
# 包含：
# 1. /health 健康检查接口
# 2. /api/<db_type> 获取指定品种最新一天数据的接口
# 3. /api/aggregate 对日线数据进行聚合查询（如求N天内最高价）的接口
# 4. /api/publish 统一发布接口 (新)
# 5. /api/toutiaopost 向后兼容的发布接口 (新增)
# 6. /api/zhihu/* 知乎热点和灵感问题相关接口

from flask import Flask, request, jsonify
from flask_cors import CORS
import sqlite3
import codecs
from datetime import datetime, timedelta
import os
from dotenv import load_dotenv

# --- 导入 ---
import requests
import json
import logging
import time
import re
from pathlib import Path
import threading

# 在所有代码之前加载 .env 文件中的环境变量
load_dotenv()

# 配置日志
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)

# --- 1. Flask 应用初始化 ---
app = Flask(__name__)
app.config["JSON_AS_ASCII"] = False
CORS(app)


# --- 2. 核心配置与状态管理 ---

# --- 发布频率限制状态 ---
TOUTIAO_RATE_LIMIT = {
    "date": datetime.now().strftime("%Y-%m-%d"),
    "count": 0,
    "limit": 3,
}
rate_limit_lock = threading.Lock()

# (数据库、知乎、头条、博客的配置部分与上一版完全相同，此处省略以保持简洁)
# ... [将上一版代码中从 DB_PATHS 到 BLOG_POST_CONFIG 的所有配置代码粘贴到这里] ...
# 数据库类型到实际文件路径的映射
DB_PATHS = {
    "futures": "futures_data.db",
    "minute": "minute_data.db",
    "qhhq": "qhhq.db",
    "qhlhb": "qhlhb.db",
}
# 定义如何从不同表中找到"最新日期"
LATEST_DATE_FIELDS = {
    "futures": ("hqdata", "日期", "期货代码"),
    "minute": ("minute_klines", "substr(timestamp,1,10)", "code"),
    "qhhq": ("hqdata", "日期", "期货公司"),
    "qhlhb": ("lhb", "日期", "期货公司"),
}
# --- 知乎API相关配置 ---
zhihu_proxy_url = os.getenv("FLASK_PROXY_API_URL")
if zhihu_proxy_url:
    ZHIHU_HOT_API_URL = f"{zhihu_proxy_url}/api/zhihu/hot"
    ZHIHU_INSPIRATION_API_URL = f"{zhihu_proxy_url}/api/zhihu/inspiration"
    logging.info(f"使用代理配置: 知乎热点API = {ZHIHU_HOT_API_URL}")
    logging.info(f"使用代理配置: 知乎灵感API = {ZHIHU_INSPIRATION_API_URL}")
else:
    ZHIHU_HOT_API_URL = "https://newsnow.want.biz/api/s?id=zhihu"
    ZHIHU_INSPIRATION_API_URL = "https://www.zhihu.com/api/v4/creators/recommend/list"
    logging.warning("⚠️ 未配置FLASK_PROXY_API_URL环境变量，将直接调用知乎官方API")
ZHIHU_CONFIG = {
    "hot_api_url": ZHIHU_HOT_API_URL,
    "inspiration_api_url": ZHIHU_INSPIRATION_API_URL,
    "cache_duration": 300,
    "user_agent": "ZhihuHybrid Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
    "headers": {
        "Host": "www.zhihu.com",
        "Cookie": (
            "BEC=1a391e0da683f9b1171c7ee6de8581cb; zst_82=2.0eZIThrz3yhoLAAAASwUAADIuMBvXfWgAAAAAXgGewK5BC1LDt8HYJm1oLPR-YrE=; q_c0=2|1:0|10:1753077525|4:q_c0|92:Mi4xemk4T0FBQUFBQUFBSUJkblVFN3RGZ3NBQUFCZ0FsVk5GV1NsYUFBRjJFSFNVNWRqaUJubi1XTFBYc055T2owY3hR|7f06e47ec86f9f6ded886152c646ebd77b38e781bf61d05e8642ab6a95dc6524; z_c0=2|1:0|10:1753077525|4:z_c0|92:Mi4xemk4T0FBQUFBQUFBSUJkblVFN3RGZ3NBQUFCZ0FsVk5GV1NsYUFBRjJFSFNVNWRqaUJubi1XTFBYc055T2owY3hR|eaf51cb59994605f7a46fda8605543bca6f69118237dd4721e00911fdd76b669; d_c0=ACAXZ1BO7RZLBcPRn4Wd-d-AV-Zh_0TjO7A=|1753077507; ff_supports_webp=1; Hm_lvt_98beee57fd2ef70ccdd5ca52b9740c49=1748024974,1749773726,1750009971; _xsrf=OQF5dPbhWz7u3JgNYRUCH5ENI0WqRxxv; edu_user_uuid=edu-v1|55a9641d-29d3-46c2-aba6-5cd6e49f82d4; _zap=9c13540f-053d-4ade-95a0-46817bdd32d5"
        ),
        "Accept": "*/*",
        "x-requested-with": "fetch",
        "Sec-Fetch-Site": "same-origin",
        "x-ms-id": "D28wdOqhFkp+xKhHEicm44T+7X7jw71HgL2zO1NIkbShEX36",
        "x-zse-93": "101_5_3.0",
        "x-hd": "2f1575458c8a4be82627fba342568473",
        "x-zst-82": "2.0eZIThrz3yhoLAAAASwUAADIuMBvXfWgAAAAAXgGewK5BC1LDt8HYJm1oLPR-YrE=",
        "Sec-Fetch-Mode": "cors",
        "Accept-Language": "zh-CN,zh-Hans;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "User-Agent": (
            "ZhihuHybrid osee2unifiedRelease/24008 osee2unifiedReleaseVersion/10.60.0 Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"
        ),
        "Referer": "https://www.zhihu.com/appview/creator",
        "x-app-version": "10.60.0",
        "Connection": "keep-alive",
        "x-ac-udid": "ACAXZ1BO7RZLBcPRn4Wd-d-AV-Zh_0TjO7A=",
        "Sec-Fetch-Dest": "empty",
        "x-zse-96": "2.0_MB7Iyz2YCpM9aaWVkNnV2qpImCnZJjc1QtYokgTco0=faYPkJK=yLRzCSs=mlYYM",
    },
}
ZHIHU_CACHE = {
    "hot_topics": {"timestamp": 0, "data": None},
    "inspiration_questions": {"timestamp": 0, "data": None},
}
# --- 头条API相关常量 ---
FLASK_PROXY_API_URL = os.getenv("FLASK_PROXY_API_URL")
TOUTIAO_API_BASE_URL = (
    FLASK_PROXY_API_URL or "https://ib.snssdk.com/pgcapp/mp/agw/article/publish"
)
if not FLASK_PROXY_API_URL:
    logging.warning("⚠️ 未配置 FLASK_PROXY_API_URL 环境变量，将直接调用头条官方API")
TOUTIAO_QUERY_PARAMS = {
    "session_id": "4A3CCF1E-0A90-4FF5-9D7F-2C43038A2311",
    "version_code": "9.0.0",
    "tma_jssdk_version": "2.53.2.0",
    "app_name": "news_article_social",
    "app_version": "9.0.0",
    "carrier_region": "CN",
    "device_id": "3591453919949805",
    "channel": "App Store",
    "resolution": "1170*2532",
    "aid": "19",
    "ab_version": "1859936,668776,13356769,668779,13356755,662099,12636413,13293553,12305809,13126479,13215653,13373095,4113875,4522574,4890008,6571799,7204589,7354844,7551466,8160328,8553218,8639938,8885971,8985781,9671606,10146301,10251872,10386924,10433952,10645729,10703934,10743278,10772964,10797943,10849833,10879886,11144711,11232912,11239382,11308092,11394631,11513698,11563236,11565349,11645964,11649962,11661813,11709192,11763389,11786812,11796248,11823590,11823748,11823877,11839761,11906663,11920653,11924697,11970513,11970596,11970655,11981315,12126055,12172770,12327156,12363458,12368504,12378301,12384208,12389444,12403709,12496899,12523247,12589695,12690790,12720695,12733027,12785735,12836704,12860549,12888549,12937660,12952090,12984593,12984891,12985928,12988354,12990051,12990119,13027015,13042650,13063492,13072413,13098989,13107216,13115718,13135331,13143696,13148461,13154507,13164816,13201836,13222263,13227575,13264130,13265056,13269343,13272746,13277739,13286697,13293838,13294457,13295710,13299207,13300136,13302896,13308931,13316011,13319569,13329548,13343756,13344454,13345087,13349421,13350564,13353112,13353880,13357778,13359423,13363700,13364742,13365092,13367499,13367883,13369098,13369251,13371369,13372334,13372445,13375116,13375511,13375820,13379882,13381650,13381940,13382234,13223470,10282085,668775,9328991,9629719,11295211,12945760,13356744,668774,13149414,13356742,662176,13356741,660830,13356743,10549444,13162708,13377132,11254714,9470952,9855884,11622653,12110965,12593783,12779906,12901058,12940566,13174430,13235472,13257457,13283710,13293852,13297076,13331007,13331919,13366931,13374303,13375428,13166144,7142413,8504306,10511023,10756958,12467959,13183282,13214397,13037701,10357230,13095523,13190769,13303652,13333297,13346524",
    "ab_feature": "4783616,794528,1662481,3408339,4743952",
    "ab_group": "4783616,794528,1662481,3408339,4743952",
    "update_version_code": "90020",
    "cdid": "007B8099-C811-4864-A7E3-DBCD3D4BC79C",
    "ac": "WIFI",
    "os_version": "18.5",
    "ssmix": "a",
    "device_platform": "iphone",
    "iid": "3186833641732558",
    "device_type": "iPhone 14",
    "ab_client": "a1,f2,f7,e1",
}
TOUTIAO_HEADERS = {
    "Host": "ib.snssdk.com",
    "Connection": "keep-alive",
    "x-Tt-Token": "00beea9a49b13130a18ffaf8397042fab700c003fd996720690ed1322b340d464536b4ca2a2aa0868cb61df177c4081ae4dae80785b0ec888969220aeb60ba60d99df6369362fd70e8d89cfb7c46e2713d09a32d3b638da6c8133ad2885e112c65289--0a490a20523ccfab387acfed3f5d8e43be1d7642dcefff4445b6d88158b33d211636133812208f3963668516980676fc24d91bf26cb75d3b1078c6a2d195624a071c695bbe6c18f6b4d309-3.0.1",
    "Cookie": "store-region=cn-sh; store-region-src=uid; FRM=new; PIXIEL_RATIO=3; WIN_WH=390_844; d_ticket=03baf8528d2ed41d6e4f50bbab6d510e9c684; ttwid=1%7CCuG9RHWdsNGnIkwQzxaGQYNdFB7oKQXJlzowyBPnavQ%7C1699378517%7C8c0c38a62793b9bbe3a33a8930d5ac059278fc7e681b53a1f3e94d0d59bec043; odin_tt=e664859603dd14a3b61beb10a5b56949a14e9856d1da68788f5988c36a26b177919315c204f455c8a8371cd56af40a1cfb957d87605b52d03246eacfacb3912c; ariaDefaultTheme=undefined; passport_csrf_token=fc5cb2b50e13c6525d1895832aa2113c; passport_csrf_token_default=fc5cb2b50e13c6525d1895832aa2113c; is_staff_user=false; sessionid=beea9a49b13130a18ffaf8397042fab7; sessionid_ss=beea9a49b13130a18ffaf8397042fab7; sid_guard=beea9a49b13130a18ffaf8397042fab7%7C1751570868%7C5184000%7CMon%2C+01-Sep-2025+19%3A27%3A48+GMT; sid_tt=beea9a49b13130a18ffaf8397042fab7; sid_ucp_v1=1.0.0-KGI3Mjk2ZTBkMTMxMmE5MmJiODRiOTRmYWY1ODFmNTJiYTA5Njc5NTEKJgjx7u3MFRC0s5vDBhgTIAwol9nwvr3M2AQw2p2XswU4AkDxB0gBGgJsZiIgYmVlYTlhNDliMTMxMzBhMThmZmFmODM5NzA0MmZhYjc; ssid_ucp_v1=1.0.0-KGI3Mjk2ZTBkMTMxMmE5MmJiODRiOTRmYWY1ODFmNTJiYTA5Njc5NTEKJgjx7u3MFRC0s5vDBhgTIAwol9nwvr3M2AQw2p2XswU4AkDxB0gBGgJsZiIgYmVlYTlhNDliMTMxMzBhMThmZmFmODM5NzA0MmZhYjc; uid_tt=a6f1b830a6aad57983224b2b49766a3d; uid_tt_ss=a6f1b830a6aad57983224b2b49766a3d; passport_csrf_token=fc5cb2b50e13c6525d1895832aa2113c; passport_csrf_token_default=fc5cb2b50e13c6525d1895832aa2113c; ariaDefaultTheme=undefined; odin_tt=e664859603dd14a3b61beb10a5b56949a14e9856d1da68788f5988c36a26b177919315c204f455c8a8371cd56af40a1cfb957d87605b52d03246eacfacb3912c; ttwid=1%7CCuG9RHWdsNGnIkwQzxaGQYNdFB7oKQXJlzowyBPnavQ%7C1699378517%7C8c0c38a62793b9bbe3a33a8930d5ac059278fc7e681b53a1f3e94d0d59bec043; d_ticket=03baf8528d2ed41d6e4f50bbab6d510e9c684; FRM=new; PIXIEL_RATIO=3; WIN_WH=390_844; store-region=cn-sh; store-region-src=uid",
    "tt-request-time": "1752642339124",
    "User-Agent": "NewsSocial 9.0.0 rv:9.0.0.20 (iPhone; iOS 18.5; zh_CN) Cronet",
    "sdk-version": "2",
    "x-tt-dt": "AAAZGUYOABV34XKPYQAACEOO4MBQWN2OA7IRSYSOASZQA4DBZRY7CYANGO53CNAD5EETHYYWFCH6SN3LDPBSJOZCDU536OHV5HR2EG6QGTAGOQA5CMGBENT3B3B3U7AYTV3CDGGNQY7CFRRZBW65FM4XQ",
    "passport-sdk-version": "5.17.5-rc.8-toutiao",
    "X-SS-STUB": "E94C602985537DACD686BFB04ED20198",
    "x-tt-local-region": "unknown",
    "x-bd-kmsv": "1",
    "x-tt-trace-id": "00-119fc2d00dcc268872033edc3b620013-119fc2d00dcc2688-01",
    "Accept-Encoding": "gzip, deflate",
    "X-Argus": "FEBoYI7BSzvTZRbQ9ibi2xCGbmguVmyMLkpCrKA89hk+YgQqws/TvqucNvoAWBnCBdSTDV6jv+LjzxHbnF/D9xOH5mU4hnpm9uL1H/ucCvND6WIke5OL4Hpou3RcA33fd5p+mHMLiL3HEu283Q9vSsW1YCJxBYUqd02Aj5wvEngZgWzabNjguFbpNg+AZ1R79wfr5phkaHQusi3YlDCXt1gaskaaTOIV70DcEfl7HbGwRpZH5k9FE2h3GBYohM2QHjyyNeEpWcL3USw0nuv771XuDmfCP/ubVJKXl+GJ1XUQGuCFTl1c3TftWEatoicHYOA=",
    "X-Gorgon": "8404e0230000fbbd0c9203ec8975280bb5a16f348e48f929a7eb",
    "X-Khronos": "1752642339",
    "X-Ladon": "8T7vOGRNi4tIZIfnnUxbxGZeJysrb+Z2DzGVwqbyM3f+8XOM",
}
TOUTIAO_POST_DATA_TEMPLATE = {
    "article_ad_type": "3",
    "article_type": "0",
    "claim_origin": "0",
    "from_page": "main_publisher",
    "goods_card_cnt": "0",
    "is_original_image_clicked": "0",
    "paste_words_cnt": "0",
    "pgc_feed_covers": "[]",
    "pgc_id": "7527541462024585754",
    "praise": "0",
    "save": "1",
    "source": "3",
    "with_video": "0",
}
# --- 博客发布 API 相关配置 ---
BLOG_POST_CONFIG = {
    "url": "https://blog.want.biz/new",
    "headers": {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8,zh-TW;q=0.7",
        "cache-control": "no-cache",
        "origin": "https://blog.want.biz",
        "pragma": "no-cache",
        "referer": "https://blog.want.biz/new",
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "same-origin",
        "sec-fetch-user": "?1",
        "upgrade-insecure-requests": "1",
        "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
    },
}


# --- 3. 辅助函数与核心业务逻辑 ---


# (所有辅助函数，如 check_and_update_toutiao_limit, _post_to_toutiao, _post_to_blog,
#  以及知乎相关函数，都与上一版完全相同，此处省略以保持简洁)
# ... [将上一版代码中从 check_and_update_toutiao_limit 到所有知乎辅助函数的代码粘贴到这里] ...
def check_and_update_toutiao_limit():
    with rate_limit_lock:
        today_str = datetime.now().strftime("%Y-%m-%d")
        if TOUTIAO_RATE_LIMIT["date"] != today_str:
            TOUTIAO_RATE_LIMIT["date"] = today_str
            TOUTIAO_RATE_LIMIT["count"] = 0
            logging.info("新的一天，重置头条发布计数器。")
        if TOUTIAO_RATE_LIMIT["count"] >= TOUTIAO_RATE_LIMIT["limit"]:
            logging.warning(
                f"今日头条发布次数已达上限 ({TOUTIAO_RATE_LIMIT['limit']})，将跳过发布。"
            )
            return False
        TOUTIAO_RATE_LIMIT["count"] += 1
        logging.info(
            f"头条发布计数增加，今日已尝试发布 {TOUTIAO_RATE_LIMIT['count']} 次。"
        )
        return True


def code_prefix(code: str) -> str:
    match = re.match(r"([a-zA-Z]+)", code)
    return match.group(1).upper() if match else ""


def build_latest_sql(db_type, table, date_col, code_col, prefix, limit=100):
    pattern = f"{prefix}%"
    sql = f"""SELECT * FROM {table} WHERE `{code_col}` LIKE ? AND {date_col} = (SELECT MAX({date_col}) FROM {table} WHERE `{code_col}` LIKE ?) LIMIT ?"""
    params = (pattern, pattern, limit)
    return sql, params


def gbk_row_factory(cursor, row):
    d = {}
    for idx, col in enumerate(cursor.description):
        value = row[idx]
        if isinstance(value, bytes):
            try:
                d[col[0]] = codecs.decode(value, "gbk")
            except UnicodeDecodeError:
                d[col[0]] = value
        else:
            d[col[0]] = value
    return d


CURL_FILE = Path("/home/ubuntu/zhihu_cookie_for_data_api.txt")


def load_curl_command(path: Path):
    if not path.exists():
        import sys

        print(f"Error: 未找到 curl 文件 {path}", file=sys.stderr)
        sys.exit(1)
    content = path.read_text(encoding="utf-8")
    return content.replace("\n", " ").strip()


def parse_headers_from_curl(curl_cmd: str) -> dict:
    headers = {}
    pattern = re.compile(r"-H\s+['\"]([^:'\" ]+):\s*([^'\"]*)['\"]")
    for key, val in pattern.findall(curl_cmd):
        headers[key] = val
    return headers


def update_zhihu_headers():
    curl_cmd = load_curl_command(CURL_FILE)
    new_h = parse_headers_from_curl(curl_cmd)
    ZHIHU_CONFIG["headers"].update(new_h)


def fetch_zhihu_hot_topics():
    now = time.time()
    if (
        ZHIHU_CACHE["hot_topics"]["data"]
        and now - ZHIHU_CACHE["hot_topics"]["timestamp"]
        < ZHIHU_CONFIG["cache_duration"]
    ):
        return ZHIHU_CACHE["hot_topics"]["data"]
    try:
        response = requests.get(
            ZHIHU_CONFIG["hot_api_url"],
            headers={
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
            timeout=10,
        )
        response.raise_for_status()
        data = response.json()
        if not data or not data.get("items"):
            raise Exception("知乎热点API返回数据格式异常")
        topics = process_zhihu_data(data["items"])
        ZHIHU_CACHE["hot_topics"] = {"timestamp": now, "data": topics}
        return topics
    except Exception as e:
        logging.error(f"获取知乎热点失败: {str(e)}")
        return get_fallback_topics()


def fetch_zhihu_inspiration_questions(page_size=100, current=1):
    now = time.time()
    if (
        ZHIHU_CACHE["inspiration_questions"]["data"]
        and now - ZHIHU_CACHE["inspiration_questions"]["timestamp"]
        < ZHIHU_CONFIG["cache_duration"]
    ):
        return ZHIHU_CACHE["inspiration_questions"]["data"]
    try:
        response = requests.get(
            f"{ZHIHU_CONFIG['inspiration_api_url']}?pageSize={page_size}&current={current}",
            headers=ZHIHU_CONFIG["headers"],
            timeout=10,
        )
        response.raise_for_status()
        data = response.json()
        if not data or not data.get("question_data"):
            raise Exception("知乎灵感问题API返回数据格式异常")
        questions = process_inspiration_data(data["question_data"])
        ZHIHU_CACHE["inspiration_questions"] = {"timestamp": now, "data": questions}
        return questions
    except Exception as e:
        logging.error(f"获取知乎灵感问题失败: {str(e)}")
        return get_fallback_inspiration_questions()


def process_zhihu_data(raw_data):
    if not isinstance(raw_data, list):
        return []
    processed_data = []
    for item in raw_data:
        processed_item = {
            "id": item.get("id") or str(time.time()),
            "title": item.get("title") or item.get("question") or "无标题",
            "url": item.get("url") or item.get("link") or "#",
            "hot": (item.get("extra", {}) and item.get("extra", {}).get("hot"))
            or item.get("hot")
            or item.get("hot_value")
            or item.get("score")
            or "0",
            "excerpt": item.get("excerpt") or item.get("desc") or "",
            "answers": item.get("answers") or item.get("answer_count") or 0,
            "category": "知乎热点",
            "timestamp": datetime.now().isoformat(),
            "type": "hot",
        }
        processed_data.append(processed_item)
    return processed_data


def process_inspiration_data(raw_data):
    if not isinstance(raw_data, list):
        return []
    processed_data = []
    for item in raw_data:
        tags = extract_tags_from_question(item)
        processed_item = {
            "id": item.get("id") or str(time.time()),
            "title": item.get("title") or "无标题",
            "url": f"https://www.zhihu.com/question/{item.get('token') or item.get('id')}"
            or "#",
            "hot": item.get("follower_count") or 0,
            "excerpt": item.get("excerpt") or "",
            "answer_count": item.get("answer_count") or 0,
            "category": "知乎灵感问题",
            "timestamp": datetime.now().isoformat(),
            "type": "inspiration",
            "tags": tags,
        }
        processed_data.append(processed_item)
    return processed_data


def extract_tags_from_question(question):
    tags = []
    if question.get("title"):
        title_words = re.split(r"[,，、\s]", question["title"])
        tags.extend([word for word in title_words if 2 <= len(word) <= 6][:3])
    if len(tags) < 3:
        tags.extend(
            [
                tag
                for tag in ["灵感", "问题", "知乎", "创作", "讨论"]
                if tag not in tags and len(tags) < 5
            ]
        )
    return tags


def get_fallback_topics():
    return [
        {
            "id": "fallback1",
            "title": "2025年AI将如何改变我们的工作方式？",
            "url": "https://www.zhihu.com/question/ai2025",
            "hot": "2000万",
            "excerpt": "随着ChatGPT、Claude等AI工具的普及...",
            "answers": 158,
            "category": "知乎热点",
            "timestamp": datetime.now().isoformat(),
            "type": "hot",
        }
    ]


def get_fallback_inspiration_questions():
    return [
        {
            "id": "ins_fallback1",
            "title": "作为一个普通人，如何在日常生活中培养创造力？",
            "url": "https://www.zhihu.com/question/creativity_daily",
            "hot": "1200万",
            "excerpt": "创造力不仅仅属于艺术家和科学家...",
            "answer_count": 156,
            "category": "知乎灵感问题",
            "timestamp": datetime.now().isoformat(),
            "type": "inspiration",
            "tags": ["创造力", "自我提升", "思维", "习惯养成"],
        }
    ]


def _post_to_toutiao(title, content):
    try:
        post_data_payload = TOUTIAO_POST_DATA_TEMPLATE.copy()
        post_data_payload.update(
            {
                "title": title,
                "content": content,
                "extra": json.dumps({"content_word_cnt": len(content)}),
            }
        )
        if "pgc_id" in post_data_payload:
            del post_data_payload["pgc_id"]
        toutiao_response = requests.post(
            TOUTIAO_API_BASE_URL,
            params=TOUTIAO_QUERY_PARAMS,
            data=post_data_payload,
            headers=TOUTIAO_HEADERS,
            timeout=15,
            verify=False,
        )
        response_json = (
            toutiao_response.json()
            if "application/json" in toutiao_response.headers.get("Content-Type", "")
            else {
                "error": "Toutiao API returned non-JSON response",
                "raw_response": toutiao_response.text[:500],
            }
        )
        toutiao_response.raise_for_status()
        return {"status": "success", "response": response_json}
    except requests.exceptions.RequestException as e:
        return {"status": "error", "message": f"头条API请求失败: {str(e)}"}
    except Exception as e:
        return {"status": "error", "message": f"头条发布时发生未知错误: {str(e)}"}


def _post_to_blog(title, content_md, tags):
    try:
        client_id = os.getenv("CF_CLIENT_ID")
        client_secret = os.getenv("CF_CLIENT_SECRET")
        if not all([client_id, client_secret]):
            raise ValueError("环境变量 CF_CLIENT_ID 或 CF_CLIENT_SECRET 未设置。")

        # 动态构建请求头，加入服务令牌
        request_headers = BLOG_POST_CONFIG["headers"].copy()
        request_headers["CF-Access-Client-Id"] = client_id
        request_headers["CF-Access-Client-Secret"] = client_secret

        form_data = {
            "title": (None, title),
            "content": (None, content_md),
            "tags": (None, tags),
            "image": ("", b"", "application/octet-stream"),
        }
        blog_response = requests.post(
            BLOG_POST_CONFIG["url"],
            headers=request_headers,  # 使用包含服务令牌的请求头
            files=form_data,
            timeout=20,
            verify=False,
            allow_redirects=False,
        )
        if (
            blog_response.status_code == 302 or blog_response.status_code == 303
        ) and "Location" in blog_response.headers:
            redirect_url = blog_response.headers["Location"]
            # 如果被重定向到 Cloudflare Access 相关的 URL，但文章实际已发布，则视为成功
            # 这通常发生在服务令牌认证成功后，Cloudflare 内部的会话建立重定向
            if "cloudflareaccess.com" in redirect_url and (
                "login" in redirect_url or "access" in redirect_url
            ):
                logging.info(
                    f"博客发布成功，但被重定向到 Cloudflare Access URL: {redirect_url}"
                )
                return {
                    "status": "success",
                    "message": "博客发布成功！(通过 Cloudflare Access 重定向)",
                    "redirect_url": redirect_url,
                }
            # 对于其他 302 或 303 重定向，只要有 Location 头，都视为成功
            return {
                "status": "success",
                "message": "博客发布成功！",
                "redirect_url": redirect_url,
            }
        else:  # 这个分支现在只处理非 302/303 状态码或缺少 Location 头的情况
            return {
                "status": "error",
                "message": f"博客发布失败，状态码: {blog_response.status_code}",
                "details": blog_response.text[:500],
            }
    except requests.exceptions.RequestException as e:
        return {"status": "error", "message": f"请求博客系统时发生网络错误: {str(e)}"}
    except Exception as e:
        return {"status": "error", "message": f"博客发布时发生未知错误: {str(e)}"}


def _execute_publishing_flow(title, content_plain, content_md, tags, targets=None):
    """
    【重构】核心发布流程函数，供所有API端点调用。
    新增 targets 参数，可以指定发布平台，如 ["blog", "toutiao"]
    """
    if targets is None:
        targets = ["toutiao", "blog"]  # 默认为全部发布

    results = {}

    if "toutiao" in targets:
        can_post_to_toutiao = check_and_update_toutiao_limit()
        if can_post_to_toutiao:
            logging.info(f"执行头条发布: '{title}'")
            results["toutiao"] = _post_to_toutiao(title, content_plain)
        else:
            results["toutiao"] = {
                "status": "skipped",
                "message": "今日发布次数已达上限。",
            }

    if "blog" in targets:
        logging.info(f"执行博客发布: '{title}'")
        results["blog"] = _post_to_blog(title, content_md, tags)

    return results


# --- 4. API 路由 (Endpoints) ---


@app.route("/health")
def health():
    """健康检查接口。"""
    return jsonify({"status": "healthy"})


@app.route("/api/publish", methods=["POST"])
def publish_article():
    """
    【新】统一发布接口。
    接收 JSON: {"title": "...", "content": "...", "content_md": "...", "tags": "..."}
    返回详细的发布报告。
    """
    logging.info("收到 /api/publish (新) 发布请求。")
    data = request.get_json()
    if not data:
        return jsonify({"error": "请求体必须是JSON格式。"}), 400

    title = data.get("title")
    content_plain = data.get("content")
    content_md = data.get("content_md")
    tags = data.get("tags", datetime.now().strftime("%Y%m"))
    targets = data.get("targets")  # 新增：获取要发布的平台

    if not all([title, content_plain, content_md]):
        return jsonify(
            {
                "error": "请求必须包含 title, content (纯文本), 和 content_md (Markdown)。"
            }
        ), 400

    results = _execute_publishing_flow(title, content_plain, content_md, tags, targets)

    # 简化逻辑：总是返回 200 OK，让客户端检查返回的 JSON 中的具体发布状态
    overall_status = 200

    return jsonify(results), overall_status


@app.route("/api/toutiaopost", methods=["POST"])
def toutiao_post_proxy_compatible():
    """
    【兼容】旧的发布接口，用于向后兼容。
    接收 JSON: {"title": "...", "content": "..."}
    如果成功，返回头条的响应；如果失败，返回简单错误。
    """
    logging.info("收到 /api/toutiaopost (兼容) 发布请求。")
    data = request.get_json()
    if not data:
        return jsonify({"error": "请求体必须是JSON格式。"}), 400

    title = data.get("title")
    content_plain = data.get("content")

    if not all([title, content_plain]):
        return jsonify({"error": "标题和内容是必填项。"}), 400

    # --- 兼容逻辑 ---
    # 1. 如果没有提供 markdown，则使用纯文本代替
    content_md = data.get("content_md", content_plain)
    tags = data.get("tags", datetime.now().strftime("%Y%m"))

    # 2. 调用核心发布流程
    results = _execute_publishing_flow(title, content_plain, content_md, tags)

    # 3. 构造兼容的返回值
    toutiao_result = results.get("toutiao", {})
    toutiao_status = toutiao_result.get("status")

    if toutiao_status == "success":
        logging.info("兼容接口：头条发布成功，返回头条响应。")
        return jsonify(toutiao_result.get("response", {})), 200
    elif toutiao_status == "skipped":
        logging.warning("兼容接口：头条发布被跳过。")
        return jsonify(
            {"error": "发布失败", "details": toutiao_result.get("message")}
        ), 429  # 429 Too Many Requests
    else:  # "error" or other failures
        logging.error("兼容接口：头条发布失败。")
        return jsonify(
            {"error": "发布失败", "details": toutiao_result.get("message")}
        ), 502  # 502 Bad Gateway


# (数据库查询和知乎相关的路由保持不变)
# ... [将上一版代码中从 @app.route('/api/<db_type>') 到文件末尾的所有路由代码粘贴到这里] ...
@app.route("/api/<db_type>", methods=["GET"])
def api_latest_one_day(db_type):
    if db_type not in DB_PATHS:
        return jsonify({"error": f"无效的数据类型: {db_type}"}), 400
    code = request.args.get("code", "").strip()
    if not code:
        return jsonify({"error": "code 参数必须提供"}), 400
    try:
        limit = int(request.args.get("limit", 100))
    except ValueError:
        return jsonify({"error": "limit 参数必须是整数"}), 400
    db_path = DB_PATHS[db_type]
    table, date_col, code_col = LATEST_DATE_FIELDS[db_type]
    prefix = code_prefix(code)
    sql, params = build_latest_sql(db_type, table, date_col, code_col, prefix, limit)
    conn = None
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = gbk_row_factory
        cur = conn.cursor()
        cur.execute(sql, params)
        rows = cur.fetchall()
        columns = [description[0] for description in cur.description]
        meta = {
            "query_type": "latest_day",
            "instrument_pattern": f"{prefix}%",
            "limit": limit,
            "count": len(rows),
            "sql": sql.strip(),
        }
        body = {"meta": meta, "columns": columns, "data": rows}
        return jsonify(body)
    except Exception as e:
        return jsonify({"error": f"数据库查询失败: {str(e)}"}), 500
    finally:
        if conn:
            conn.close()


@app.route("/api/aggregate", methods=["GET"])
def api_aggregate():
    code = request.args.get("code", "").strip().upper()
    if not code:
        return jsonify({"error": "code 参数必须提供"}), 400
    allowed_agg_funcs = ["MAX", "MIN", "AVG", "SUM"]
    agg_func = request.args.get("agg_func", "MAX").upper()
    if agg_func not in allowed_agg_funcs:
        return jsonify(
            {"error": f"不支持的聚合函数: {agg_func}. 可选: {allowed_agg_funcs}"}
        ), 400
    allowed_agg_cols = ["开盘", "最高", "最低", "收盘", "成交量", "成交额"]
    agg_col = request.args.get("agg_col")
    if not agg_col or agg_col not in allowed_agg_cols:
        return jsonify(
            {"error": f"必须提供且有效的聚合字段 (agg_col)，可选: {allowed_agg_cols}"}
        ), 400
    try:
        days = int(request.args.get("days", 10))
    except ValueError:
        return jsonify({"error": "days 参数必须是整数"}), 400
    end_date = datetime.now()
    start_date = end_date - timedelta(days=days)
    end_date_str = end_date.strftime("%Y-%m-%d")
    start_date_str = start_date.strftime("%Y-%m-%d")
    db_path = DB_PATHS["futures"]
    table_name, date_col, code_col = LATEST_DATE_FIELDS["futures"]
    prefix = code_prefix(code)
    pattern = f"{prefix}%"
    sql = f"SELECT {agg_func}(`{agg_col}`) as result FROM `{table_name}` WHERE `{code_col}` LIKE ? AND `{date_col}` BETWEEN ? AND ?"
    params = (pattern, start_date_str, end_date_str)
    conn = None
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        cur = conn.execute(sql, params)
        result = cur.fetchone()
        value = result["result"] if result and result["result"] is not None else None
        meta = {
            "query_type": "aggregation",
            "instrument_pattern": pattern,
            "time_period_days": days,
            "start_date": start_date_str,
            "end_date": end_date_str,
            "aggregation_function": agg_func,
            "aggregation_column": agg_col,
            "sql": sql.strip(),
        }
        body = {"meta": meta, "data": {"result": value}}
        return jsonify(body)
    except Exception as e:
        return jsonify({"error": f"数据库查询失败: {str(e)}"}), 500
    finally:
        if conn:
            conn.close()


@app.route("/api/zhihu/hot", methods=["GET"])
def api_zhihu_hot():
    try:
        limit = int(request.args.get("limit", 20))
        topics = fetch_zhihu_hot_topics()
        if not topics:
            return jsonify({"error": "未获取到知乎热点话题"}), 404
        sorted_topics = sorted(
            topics,
            key=lambda x: int(x["hot"]) if str(x["hot"]).isdigit() else 0,
            reverse=True,
        )
        return jsonify(
            {
                "status": "success",
                "data": sorted_topics[:limit],
                "timestamp": datetime.now().isoformat(),
            }
        )
    except Exception as e:
        logging.error(f"获取知乎热点话题失败: {str(e)}")
        return jsonify({"error": f"获取知乎热点话题失败: {str(e)}"}), 500


@app.route("/api/zhihu/inspiration", methods=["GET"])
def api_zhihu_inspiration():
    try:
        limit = int(request.args.get("limit", 20))
        questions = fetch_zhihu_inspiration_questions()
        if not questions:
            return jsonify({"error": "未获取到知乎灵感问题"}), 404
        sorted_questions = sorted(
            questions,
            key=lambda x: int(x["hot"]) if str(x["hot"]).isdigit() else 0,
            reverse=True,
        )
        return jsonify(
            {
                "status": "success",
                "data": sorted_questions[:limit],
                "timestamp": datetime.now().isoformat(),
            }
        )
    except Exception as e:
        logging.error(f"获取知乎灵感问题失败: {str(e)}")
        return jsonify({"error": f"获取知乎灵感问题失败: {str(e)}"}), 500


@app.route("/api/zhihu/combined", methods=["GET"])
def api_zhihu_combined():
    try:
        hot_limit = int(request.args.get("hot_limit", 15))
        inspiration_limit = int(request.args.get("inspiration_limit", 15))
        hot_topics = fetch_zhihu_hot_topics()
        inspiration_questions = fetch_zhihu_inspiration_questions()
        sorted_hot_topics = sorted(
            hot_topics,
            key=lambda x: int(x["hot"]) if str(x["hot"]).isdigit() else 0,
            reverse=True,
        )
        sorted_inspiration_questions = sorted(
            inspiration_questions,
            key=lambda x: int(x["hot"]) if str(x["hot"]).isdigit() else 0,
            reverse=True,
        )
        return jsonify(
            {
                "status": "success",
                "hotTopics": sorted_hot_topics[:hot_limit],
                "inspirationQuestions": sorted_inspiration_questions[
                    :inspiration_limit
                ],
                "timestamp": datetime.now().isoformat(),
            }
        )
    except Exception as e:
        logging.error(f"获取知乎综合内容失败: {str(e)}")
        return jsonify(
            {
                "error": f"获取知乎综合内容失败: {str(e)}",
                "hotTopics": get_fallback_topics(),
                "inspirationQuestions": get_fallback_inspiration_questions(),
                "timestamp": datetime.now().isoformat(),
            }
        ), 500


# --- 5. 启动入口 ---
if __name__ == "__main__":
    update_zhihu_headers()
    print("已更新知乎请求参数。")
    app.run(host="0.0.0.0", port=5000, debug=False)
