# data_api.py - 最终完整版
# 包含：
# 1. /health 健康检查接口
# 2. /api/<db_type> 获取指定品种最新一天数据的接口
# 3. /api/aggregate 对日线数据进行聚合查询（如求N天内最高价）的接口
# 4. /api/toutiaopost 发布文章到头条的代理接口
# 5. /api/blogpost 发布文章到指定博客的代理接口 (新增)
# 6. /api/zhihu/* 知乎热点和灵感问题相关接口

from flask import Flask, request, jsonify
from flask_cors import CORS
import sqlite3
import codecs
from datetime import datetime, timedelta
import os

# --- 导入 ---
import requests
import json
import logging
import time # 用于获取当前时间戳
import re # 用于正则匹配
# 解析知乎header用
from pathlib import Path

# 配置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# --- 1. Flask 应用初始化 ---
app = Flask(__name__)
app.config['JSON_AS_ASCII'] = False
# 允许跨域请求。在生产环境中，请限制为你的前端域名 (例如：origins=["https://chat.want.biz"])
CORS(app)


# --- 2. 核心配置字典 ---
# 将所有可变的部分集中管理，方便维护

# 数据库类型到实际文件路径的映射
DB_PATHS = {
    'futures': 'futures_data.db',   # 日线数据
    'minute': 'minute_data.db',     # 分钟线数据
    'qhhq': 'qhhq.db',              # 期货公司行情数据
    'qhlhb': 'qhlhb.db'             # 龙虎榜数据
}

# 定义如何从不同表中找到"最新日期"
# 格式: '数据类型': ('表名', '日期字段或表达式', '合约代码字段')
LATEST_DATE_FIELDS = {
    'futures': ('hqdata', '日期', '期货代码'),
    'minute': ('minute_klines', 'substr(timestamp,1,10)', 'code'),
    'qhhq': ('hqdata', '日期', '期货公司'),
    'qhlhb': ('lhb', '日期', '期货公司')
}

# --- 知乎API相关配置 ---
# 支持通过FLASK_PROXY_API_URL环境变量配置代理
zhihu_proxy_url = os.getenv('FLASK_PROXY_API_URL')
if zhihu_proxy_url:
    ZHIHU_HOT_API_URL = f"{zhihu_proxy_url}/api/zhihu/hot"
    ZHIHU_INSPIRATION_API_URL = f"{zhihu_proxy_url}/api/zhihu/inspiration"
    logging.info(f"使用代理配置: 知乎热点API = {ZHIHU_HOT_API_URL}")
    logging.info(f"使用代理配置: 知乎灵感API = {ZHIHU_INSPIRATION_API_URL}")
else:
    ZHIHU_HOT_API_URL = 'https://newsnow.want.biz/api/s?id=zhihu'
    ZHIHU_INSPIRATION_API_URL = 'https://www.zhihu.com/api/v4/creators/recommend/list'
    logging.warning("⚠️ 未配置FLASK_PROXY_API_URL环境变量，将直接调用知乎官方API")

ZHIHU_CONFIG = {
    'hot_api_url': ZHIHU_HOT_API_URL,
    'inspiration_api_url': ZHIHU_INSPIRATION_API_URL,
    'cache_duration': 300,  # 5分钟缓存时间（秒）
    'user_agent': 'ZhihuHybrid Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
    'headers':{
    'Host': 'www.zhihu.com',
    'Cookie': (
        'BEC=1a391e0da683f9b1171c7ee6de8581cb; '
        'zst_82=2.0eZIThrz3yhoLAAAASwUAADIuMBvXfWgAAAAAXgGewK5BC1LDt8HYJm1oLPR-YrE=; '
        'q_c0=2|1:0|10:1753077525|4:q_c0|92:Mi4xemk4T0FBQUFBQUFBSUJkblVFN3RGZ3NBQUFCZ0FsVk5GV1NsYUFBRjJFSFNVNWRqaUJubi1XTFBYc055T2owY3hR|'
        '7f06e47ec86f9f6ded886152c646ebd77b38e781bf61d05e8642ab6a95dc6524; '
        'z_c0=2|1:0|10:1753077525|4:z_c0|92:Mi4xemk4T0FBQUFBQUFBSUJkblVFN3RGZ3NBQUFCZ0FsVk5GV1NsYUFBRjJFSFNVNWRqaUJubi1XTFBYc055T2owY3hR|'
        'eaf51cb59994605f7a46fda8605543bca6f69118237dd4721e00911fdd76b669; '
        'd_c0=ACAXZ1BO7RZLBcPRn4Wd-d-AV-Zh_0TjO7A=|1753077507; '
        'ff_supports_webp=1; '
        'Hm_lvt_98beee57fd2ef70ccdd5ca52b9740c49=1748024974,1749773726,1750009971; '
        '_xsrf=OQF5dPbhWz7u3JgNYRUCH5ENI0WqRxxv; '
        'edu_user_uuid=edu-v1|55a9641d-29d3-46c2-aba6-5cd6e49f82d4; '
        '_zap=9c13540f-053d-4ade-95a0-46817bdd32d5'
    ),
    'Accept': '*/*',
    'x-requested-with': 'fetch',
    'Sec-Fetch-Site': 'same-origin',
    'x-ms-id': 'D28wdOqhFkp+xKhHEicm44T+7X7jw71HgL2zO1NIkbShEX36',
    'x-zse-93': '101_5_3.0',
    'x-hd': '2f1575458c8a4be82627fba342568473',
    'x-zst-82': '2.0eZIThrz3yhoLAAAASwUAADIuMBvXfWgAAAAAXgGewK5BC1LDt8HYJm1oLPR-YrE=',
    'Sec-Fetch-Mode': 'cors',
    'Accept-Language': 'zh-CN,zh-Hans;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'User-Agent': (
        'ZhihuHybrid osee2unifiedRelease/24008 '
        'osee2unifiedReleaseVersion/10.60.0 '
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) '
        'AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
    ),
    'Referer': 'https://www.zhihu.com/appview/creator',
    'x-app-version': '10.60.0',
    'Connection': 'keep-alive',
    'x-ac-udid': 'ACAXZ1BO7RZLBcPRn4Wd-d-AV-Zh_0TjO7A=',
    'Sec-Fetch-Dest': 'empty',
    'x-zse-96': '2.0_MB7Iyz2YCpM9aaWVkNnV2qpImCnZJjc1QtYokgTco0=faYPkJK=yLRzCSs=mlYYM'
}
}

# 知乎缓存存储
ZHIHU_CACHE = {
    'hot_topics': {'timestamp': 0, 'data': None},
    'inspiration_questions': {'timestamp': 0, 'data': None}
}

# --- 头条API相关常量 ---
# 从环境变量获取配置，支持代理模式
FLASK_PROXY_API_URL = os.getenv('FLASK_PROXY_API_URL')
TOUTIAO_API_BASE_URL = FLASK_PROXY_API_URL or "https://ib.snssdk.com/pgcapp/mp/agw/article/publish"

if not FLASK_PROXY_API_URL:
    logging.warning("⚠️ 未配置 FLASK_PROXY_API_URL 环境变量，将直接调用头条官方API")

# URL 查询参数
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
    "ab_client": "a1,f2,f7,e1"
}

# 请求头
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
    "X-Ladon": "8T7vOGRNi4tIZIfnnUxbxGZeJysrb+Z2DzGVwqbyM3f+8XOM"
}

# POST 请求体数据模板
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
    "with_video": "0"
}

# --- 博客发布 API 相关配置 (新增) ---
# 建议将敏感信息（如 Cookie, CF_Authorization）存储在环境变量中
# 例如: export BLOG_COOKIE='your_full_cookie_string'
#       export BLOG_CF_AUTHORIZATION='your_full_cf_auth_token'
BLOG_POST_CONFIG = {
    "url": "https://blog.want.biz/new",
    "headers": {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,zh-TW;q=0.7',
        'cache-control': 'no-cache',
        # 'content-type' 会由 requests 库根据 files 参数自动设置，无需手动指定
        'origin': 'https://blog.want.biz',
        'pragma': 'no-cache',
        'referer': 'https://blog.want.biz/new',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-user': '?1',
        'upgrade-insecure-requests': '1',
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
        # 关键认证信息，请务必替换成你自己的有效值，或通过环境变量加载
        # Cloudflare Access 可能优先使用 CF_Authorization
        'Cookie': os.getenv('BLOG_COOKIE', 'YOUR_COOKIE_HERE'),
        'CF_Authorization': os.getenv('BLOG_CF_AUTHORIZATION', 'YOUR_CF_AUTHORIZATION_TOKEN_HERE')
    }
}


# --- 3. 辅助函数 ---

def code_prefix(code: str) -> str:
    """从合约代码中提取品种前缀，并转为大写。例如 'rb2410' -> 'RB'"""
    import re
    match = re.match(r'([a-zA-Z]+)', code)
    return match.group(1).upper() if match else ''

def build_latest_sql(db_type, table, date_col, code_col, prefix, limit=100):
    """
    动态构建一个安全的 SQL 查询语句，用于获取最新一天的数据。
    使用参数化查询 (?) 来防止 SQL 注入。
    """
    pattern = f'{prefix}%'
    # 子查询用于找出该品种在表中的最新日期
    sql = f"""
        SELECT * FROM {table}
        WHERE `{code_col}` LIKE ? 
        AND {date_col} = (
            SELECT MAX({date_col}) 
            FROM {table} 
            WHERE `{code_col}` LIKE ?
        )
        LIMIT ?
    """
    params = (pattern, pattern, limit)
    return sql, params

def gbk_row_factory(cursor, row):
    """
    一个特殊的 row_factory，用于解决数据库中可能存在的 GBK 编码乱码问题。
    它会在从数据库取数据时，自动将 bytes 类型的字段用 gbk 解码。
    """
    d = {}
    for idx, col in enumerate(cursor.description):
        value = row[idx]
        if isinstance(value, bytes):
            try:
                # 尝试用 GBK 解码，如果失败则保留原始字节串
                d[col[0]] = codecs.decode(value, 'gbk')
            except UnicodeDecodeError:
                d[col[0]] = value
        else:
            d[col[0]] = value
    return d


#  知乎请求时先解析参数并更新
# 存放 curl 命令的文件
CURL_FILE = Path('/home/ubuntu/zhihu_cookie_for_data_api.txt')


def load_curl_command(path: Path) -> str:
    """ 读取并合并多行 curl 命令 """
    if not path.exists():
        print(f'Error: 未找到 curl 文件 {path}', file=sys.stderr)
        sys.exit(1)
    content = path.read_text(encoding='utf-8')
    # 去掉换行符，将命令拼成一行
    return content.replace('\n', ' ').strip()


def parse_headers_from_curl(curl_cmd: str) -> dict:
    """
    用正则从 curl 命令中提取所有 -H 'Key: Value' / -H "Key: Value"
    返回一个 {Key: Value} 的 dict
    """
    headers = {}
    pattern = re.compile(r"-H\s+['\"]([^:'\" ]+):\s*([^'\"]*)['\"]")
    for key, val in pattern.findall(curl_cmd):
        headers[key] = val
    return headers


def update_zhihu_headers():
    # 1. 读 curl
    curl_cmd = load_curl_command(CURL_FILE)
    # 2. 解析 headers
    new_h = parse_headers_from_curl(curl_cmd)
    # 3. 更新原有配置
    ZHIHU_CONFIG['headers'].update(new_h)

# --- 知乎API相关函数 ---

def fetch_zhihu_hot_topics():
    """获取知乎热点话题"""
    now = time.time()
    # 检查缓存
    if ZHIHU_CACHE['hot_topics']['data'] and now - ZHIHU_CACHE['hot_topics']['timestamp'] < ZHIHU_CONFIG['cache_duration']:
        logging.info('从缓存中获取知乎热点数据')
        return ZHIHU_CACHE['hot_topics']['data']
    
    logging.info('开始获取知乎热点数据...')
    try:
        response = requests.get(
            ZHIHU_CONFIG['hot_api_url'],
            headers={
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout=10
        )
        
        if not response.ok:
            raise Exception(f'知乎热点API请求失败，状态码: {response.status_code}')
        
        data = response.json()
        logging.info('知乎热点API响应成功')
        
        if not data or not data.get('items'):
            raise Exception('知乎热点API返回数据格式异常')
        
        # 处理数据
        topics = process_zhihu_data(data['items'])
        logging.info(f'成功获取 {len(topics)} 个知乎热点话题')
        
        # 更新缓存
        ZHIHU_CACHE['hot_topics'] = {'timestamp': now, 'data': topics}
        
        return topics
    except Exception as e:
        logging.error(f'获取知乎热点失败: {str(e)}')
        return get_fallback_topics()

def fetch_zhihu_inspiration_questions(page_size=100, current=1):
    """获取知乎灵感问题"""
    now = time.time()
    # 检查缓存
    if ZHIHU_CACHE['inspiration_questions']['data'] and now - ZHIHU_CACHE['inspiration_questions']['timestamp'] < ZHIHU_CONFIG['cache_duration']:
        logging.info('从缓存中获取知乎灵感问题数据')
        return ZHIHU_CACHE['inspiration_questions']['data']
    
    logging.info('开始获取知乎灵感问题数据...')
    try:
        response = requests.get(
            f"{ZHIHU_CONFIG['inspiration_api_url']}?pageSize={page_size}&current={current}",
            headers = ZHIHU_CONFIG['headers'],
            timeout=10
        )
        
        if not response.ok:
            raise Exception(f'知乎灵感问题API请求失败，状态码: {response.status_code}')
        
        data = response.json()
        logging.info('知乎灵感问题API响应成功')
        
        if not data or not data.get('question_data'):
            raise Exception('知乎灵感问题API返回数据格式异常')
        
        # 处理数据
        questions = process_inspiration_data(data['question_data'])
        logging.info(f'成功获取 {len(questions)} 个知乎灵感问题')
        
        # 更新缓存
        ZHIHU_CACHE['inspiration_questions'] = {'timestamp': now, 'data': questions}
        
        return questions
    except Exception as e:
        logging.error(f'获取知乎灵感问题失败: {str(e)}')
        return get_fallback_inspiration_questions()

def process_zhihu_data(raw_data):
    """处理知乎热点数据"""
    if not isinstance(raw_data, list):
        return []
    
    processed_data = []
    for item in raw_data:
        processed_item = {
            'id': item.get('id') or str(time.time()),
            'title': item.get('title') or item.get('question') or '无标题',
            'url': item.get('url') or item.get('link') or '#',
            'hot': (item.get('extra', {}) and item.get('extra', {}).get('hot')) or item.get('hot') or item.get('hot_value') or item.get('score') or '0',
            'excerpt': item.get('excerpt') or item.get('desc') or '',
            'answers': item.get('answers') or item.get('answer_count') or 0,
            'category': '知乎热点',
            'timestamp': datetime.now().isoformat(),
            'type': 'hot'
        }
        processed_data.append(processed_item)
    
    return processed_data

def process_inspiration_data(raw_data):
    """处理知乎灵感问题数据"""
    if not isinstance(raw_data, list):
        return []
    
    processed_data = []
    for item in raw_data:
        # 从灵感问题中提取基本标签
        tags = extract_tags_from_question(item)
        
        processed_item = {
            'id': item.get('id') or str(time.time()),
            'title': item.get('title') or '无标题',
            'url': f"https://www.zhihu.com/question/{item.get('token') or item.get('id')}" or '#',
            'hot': item.get('follower_count') or 0,
            'excerpt': item.get('excerpt') or '',
            'answer_count': item.get('answer_count') or 0,
            'category': '知乎灵感问题',
            'timestamp': datetime.now().isoformat(),
            'type': 'inspiration',
            'tags': tags
        }
        processed_data.append(processed_item)
    
    return processed_data

def extract_tags_from_question(question):
    """从灵感问题中提取标签"""
    tags = []
    
    # 从标题中提取关键词作为标签
    if question.get('title'):
        title_words = re.split(r'[,，、\s]', question['title'])
        title_words = [word for word in title_words if 2 <= len(word) <= 6][:3]
        tags.extend(title_words)
    
    # 如果没有足够的标签，添加一些通用标签
    if len(tags) < 3:
        common_tags = ['灵感', '问题', '知乎', '创作', '讨论']
        for tag in common_tags:
            if tag not in tags and len(tags) < 5:
                tags.append(tag)
    
    return tags

def get_fallback_topics():
    """获取备用话题（当API失败时）"""
    return [
        {
            "id": "fallback1",
            "title": "2025年AI将如何改变我们的工作方式？",
            "url": "https://www.zhihu.com/question/ai2025",
            "hot": "2000万",
            "excerpt": "随着ChatGPT、Claude等AI工具的普及，越来越多的工作正在被重新定义...",
            "answers": 158,
            "category": "知乎热点",
            "timestamp": datetime.now().isoformat(),
            "type": "hot"
        },
        {
            "id": "fallback2",
            "title": "新能源汽车价格战：是福利还是陷阱？",
            "url": "https://www.zhihu.com/question/ev_price",
            "hot": "1500万",
            "excerpt": "2024年以来，新能源汽车价格持续走低，消费者该如何选择...",
            "answers": 237,
            "category": "知乎热点",
            "timestamp": datetime.now().isoformat(),
            "type": "hot"
        },
        {
            "id": "fallback3",
            "title": "直播带货还能火多久？行业洗牌进行时",
            "url": "https://www.zhihu.com/question/live_streaming",
            "hot": "1200万",
            "excerpt": "从薇娅李佳琦到东方甄选，直播带货行业经历了怎样的变迁...",
            "answers": 198,
            "category": "知乎热点",
            "timestamp": datetime.now().isoformat(),
            "type": "hot"
        },
        {
            "id": "fallback4",
            "title": "房价下跌时代，刚需现在该买房吗？",
            "url": "https://www.zhihu.com/question/house_price",
            "hot": "1800万",
            "excerpt": "多地房价出现松动，刚需购房者面临艰难选择...",
            "answers": 320,
            "category": "知乎热点",
            "timestamp": datetime.now().isoformat(),
            "type": "hot"
        }
    ]

def get_fallback_inspiration_questions():
    """获取备用灵感问题（当API失败时）"""
    return [
        {
            "id": "ins_fallback1",
            "title": "作为一个普通人，如何在日常生活中培养创造力？",
            "url": "https://www.zhihu.com/question/creativity_daily",
            "hot": "1200万",
            "excerpt": "创造力不仅仅属于艺术家和科学家，每个人都可以在日常生活中培养这种能力...",
            "answer_count": 156,
            "category": "知乎灵感问题",
            "timestamp": datetime.now().isoformat(),
            "type": "inspiration",
            "tags": ["创造力", "自我提升", "思维", "习惯养成"]
        },
        {
            "id": "ins_fallback2",
            "title": "你认为什么样的教育方式最能激发孩子的学习兴趣？",
            "url": "https://www.zhihu.com/question/education_interest",
            "hot": "980万",
            "excerpt": "面对应试教育的压力，如何保持孩子对学习的热情和好奇心成为许多家长关注的问题...",
            "answer_count": 211,
            "category": "知乎灵感问题",
            "timestamp": datetime.now().isoformat(),
            "type": "inspiration",
            "tags": ["教育", "学习兴趣", "孩子成长", "家庭教育"]
        },
        {
            "id": "ins_fallback3",
            "title": "职场中，如何优雅地拒绝不合理的工作要求？",
            "url": "https://www.zhihu.com/question/reject_work",
            "hot": "1560万",
            "excerpt": "在职场中，适当拒绝是一种必要的能力，但如何拒绝又不伤害工作关系...",
            "answer_count": 287,
            "category": "知乎灵感问题",
            "timestamp": datetime.now().isoformat(),
            "type": "inspiration",
            "tags": ["职场", "沟通技巧", "边界感", "工作关系"]
        },
        {
            "id": "ins_fallback4",
            "title": "人到中年，如何重新定义自己的人生价值？",
            "url": "https://www.zhihu.com/question/midlife_value",
            "hot": "2100万",
            "excerpt": "中年危机不仅仅是职业和家庭压力，更多的是对自我价值的重新思考...",
            "answer_count": 352,
            "category": "知乎灵感问题",
            "timestamp": datetime.now().isoformat(),
            "type": "inspiration",
            "tags": ["中年", "人生价值", "自我实现", "心理健康"]
        },
        {
            "id": "ins_fallback5",
            "title": "极简主义生活方式真的能带来幸福感吗？",
            "url": "https://www.zhihu.com/question/minimalism",
            "hot": "870万",
            "excerpt": "随着物质生活的丰富，越来越多的人开始追求极简主义生活...",
            "answer_count": 178,
            "category": "知乎灵感问题",
            "timestamp": datetime.now().isoformat(),
            "type": "inspiration",
            "tags": ["极简主义", "生活方式", "幸福感", "消费观"]
        }
    ]


# --- 4. API 路由 (Endpoints) ---

@app.route('/health')
def health():
    """健康检查接口，用于监控服务是否存活。"""
    return jsonify({"status": "healthy"})

@app.route('/api/<db_type>', methods=['GET'])
def api_latest_one_day(db_type):
    """
    主数据接口：获取指定品种在最新一个交易日的所有数据。
    URL 示例: /api/futures?code=rb&limit=10
    """
    if db_type not in DB_PATHS:
        return jsonify({'error': f'无效的数据类型: {db_type}'}), 400

    code = request.args.get('code', '').strip()
    if not code:
        return jsonify({'error': 'code 参数必须提供'}), 400
    
    try:
        limit = int(request.args.get('limit', 100))
    except ValueError:
        return jsonify({'error': 'limit 参数必须是整数'}), 400

    db_path = DB_PATHS[db_type]
    table, date_col, code_col = LATEST_DATE_FIELDS[db_type]
    prefix = code_prefix(code)

    sql, params = build_latest_sql(db_type, table, date_col, code_col, prefix, limit)

    conn = None
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = gbk_row_factory  # 应用 GBK 解码器
        cur = conn.cursor()
        cur.execute(sql, params)
        
        rows = cur.fetchall()
        columns = [description[0] for description in cur.description]
        
        meta = {
            'query_type': 'latest_day',
            'instrument_pattern': f'{prefix}%',
            'limit': limit,
            'count': len(rows),
            'sql': sql.strip()
        }
        body = {"meta": meta, "columns": columns, "data": rows}
        
        return jsonify(body)
    except Exception as e:
        return jsonify({'error': f'数据库查询失败: {str(e)}'}), 500
    finally:
        if conn:
            conn.close()

@app.route('/api/aggregate', methods=['GET'])
def api_aggregate():
    """
    聚合查询接口：对日线数据进行时间范围内的聚合计算。
    URL 示例: /api/aggregate?code=cu&days=10&agg_func=MAX&agg_col=最高价
    """
    # --- 1. 获取和校验参数 ---
    code = request.args.get('code', '').strip().upper()
    if not code:
        return jsonify({'error': 'code 参数必须提供'}), 400

    # 聚合函数白名单，防止执行任意函数，保障安全
    allowed_agg_funcs = ['MAX', 'MIN', 'AVG', 'SUM']
    agg_func = request.args.get('agg_func', 'MAX').upper()
    if agg_func not in allowed_agg_funcs:
        return jsonify({'error': f'不支持的聚合函数: {agg_func}. 可选: {allowed_agg_funcs}'}), 400

    # 聚合字段白名单，防止查询敏感字段
    # 注意：这里假设我们只对日线数据(futures)进行聚合
    allowed_agg_cols = ['开盘', '最高', '最低', '收盘', '成交量', '成交额']
    agg_col = request.args.get('agg_col')
    if not agg_col or agg_col not in allowed_agg_cols:
        return jsonify({'error': f'必须提供且有效的聚合字段 (agg_col)，可选: {allowed_agg_cols}'}), 400

    try:
        days = int(request.args.get('days', 10))
    except ValueError:
        return jsonify({'error': 'days 参数必须是整数'}), 400

    # --- 2. 计算日期范围 ---
    end_date = datetime.now()
    start_date = end_date - timedelta(days=days)
    end_date_str = end_date.strftime('%Y-%m-%d')
    start_date_str = start_date.strftime('%Y-%m-%d')

    # --- 3. 构建 SQL ---
    # 这个接口我们硬编码查询日线库 'futures'
    db_path = DB_PATHS['futures']
    table_name, date_col, code_col = LATEST_DATE_FIELDS['futures']
    prefix = code_prefix(code)
    pattern = f'{prefix}%'

    # !! 安全警告：直接拼接 agg_func 和 agg_col 是有风险的，但我们已通过上面的白名单验证，所以这里是安全的 !!
    sql = f"""
        SELECT {agg_func}(`{agg_col}`) as result
        FROM `{table_name}`
        WHERE `{code_col}` LIKE ?
          AND `{date_col}` BETWEEN ? AND ?
    """
    params = (pattern, start_date_str, end_date_str)

    # --- 4. 执行查询并返回 ---
    conn = None
    try:
        conn = sqlite3.connect(db_path)
        # 对于聚合查询，结果通常是单个值，使用标准的 Row 工厂即可
        conn.row_factory = sqlite3.Row 
        cur = conn.execute(sql, params)
        result = cur.fetchone()
        
        # 如果查询结果不为空，提取数值，否则为 None
        value = result['result'] if result and result['result'] is not None else None

        meta = {
            'query_type': 'aggregation',
            'instrument_pattern': pattern,
            'time_period_days': days,
            'start_date': start_date_str,
            'end_date': end_date_str,
            'aggregation_function': agg_func,
            'aggregation_column': agg_col,
            'sql': sql.strip()
        }
        body = {"meta": meta, "data": {"result": value}}
        
        return jsonify(body)
    except Exception as e:
        return jsonify({'error': f'数据库查询失败: {str(e)}'}), 500
    finally:
        if conn:
            conn.close()

@app.route('/api/toutiaopost', methods=['POST'])
def toutiao_post_proxy():
    logging.info("收到前端发布请求。")
    
    # Initialize variables that might be used in final error response
    response_data = {"error": "未知错误", "details": "服务器处理流程异常。"}
    status_code = 500

    try:
        data = request.get_json()
        logging.info(f"Flask 接收到的原始 JSON 数据: {request.data}")
        logging.info(f"Flask 解析后的 Python 字典数据: {data}")

        if not data:
            logging.warning("API调用失败: 请求体不是有效的JSON。")
            response_data = {"error": "请求体必须是JSON格式。"}
            status_code = 400
            raise ValueError("Invalid JSON body") # Raise to jump to except block

        title = data.get('title')
        content = data.get('content')

        logging.info(f"从字典中提取的标题: '{title}' (类型: {type(title)})")
        logging.info(f"从字典中提取的内容: '{content[:50]}...' (类型: {type(content)})")

        if not title or not content:
            logging.warning("API调用失败: 缺少标题或内容。")
            response_data = {"error": "标题和内容是必填项。"}
            status_code = 400
            raise ValueError("Title or content missing") # Raise to jump to except block
        
        # Construct POST data payload for Toutiao API
        post_data_payload = TOUTIAO_POST_DATA_TEMPLATE.copy()
        post_data_payload["title"] = title
        post_data_payload["content"] = content # Wrap content in <p> tags for Toutiao
        post_data_payload["extra"] = json.dumps({"content_word_cnt": len(content)})

        # === IMPORTANT CHANGE: Remove pgc_id to try to create a new article ===
        if "pgc_id" in post_data_payload:
            del post_data_payload["pgc_id"] # Attempt to remove pgc_id for new article creation
        # ====================================================================

        headers_for_toutiao = TOUTIAO_HEADERS.copy()


        logging.info(f"准备向头条API发送的URL参数: {TOUTIAO_QUERY_PARAMS}")
        logging.info(f"准备向头条API发送的POST数据: {post_data_payload}")
        logging.info(f"准备向头条API发送的请求头: {headers_for_toutiao}")
        
        # Send request to Toutiao API
        logging.info(f"正在向头条API发送 POST 请求到 {TOUTIAO_API_BASE_URL}...")
        
        toutiao_response = requests.post(
            TOUTIAO_API_BASE_URL,
            params=TOUTIAO_QUERY_PARAMS,
            data=post_data_payload,
            headers=headers_for_toutiao,
            timeout=15,
            verify=False
        )
        
        logging.info(f"收到头条API响应。Status: {toutiao_response.status_code}")
        
        # === 打印头条API的完整响应内容 ===
        toutiao_api_response_json = {}
        try:
            # 尝试将头条API的响应解析为JSON
            toutiao_api_response_json = toutiao_response.json()
            logging.info(f"头条API的JSON响应内容: {toutiao_api_response_json}")
        except json.JSONDecodeError:
            # 如果响应不是有效的JSON，则打印原始文本
            logging.warning(f"头条API响应不是有效的JSON，原始文本: {toutiao_response.text[:500]}...")
            toutiao_api_response_json = {"error": "Toutiao API returned non-JSON response", "raw_response": toutiao_response.text[:500]}
        # =======================================

        toutiao_response.raise_for_status() # If status code is not 2xx, raises HTTPError

        # Success path
        logging.info(f"头条API响应成功 (Status: {toutiao_response.status_code})")
        # Ensure that we return the parsed JSON response, not the requests.Response object
        return jsonify(toutiao_api_response_json), toutiao_response.status_code

    except requests.exceptions.HTTPError as e:
        logging.error(f"头条API返回HTTP错误: {e.response.status_code} - {e.response.text}", exc_info=True)
        response_data = {"error": f"头条API返回HTTP错误: {e.response.status_code}", "details": e.response.text}
        status_code = e.response.status_code
    except requests.exceptions.ConnectionError as e:
        logging.error(f"连接错误: 无法连接到头条API - {e}", exc_info=True)
        response_data = {"error": "无法连接到头条API，请检查网络或API地址。", "details": str(e)}
        status_code = 503
    except requests.exceptions.Timeout as e:
        logging.error(f"请求超时: {e}", exc_info=True)
        response_data = {"error": "请求头条API超时，请稍后再试。", "details": str(e)}
        status_code = 504
    except requests.exceptions.RequestException as e:
        logging.error(f"requests 库发生通用请求异常: {e}", exc_info=True)
        details = str(e)
        if hasattr(e, 'response') and e.response is not None:
            details += f" Response: {e.response.status_code} - {e.response.text}"
        response_data = {"error": "发送请求到头条API时发生通用错误。", "details": details}
        status_code = 500
    except json.JSONDecodeError as e:
        # Check if 'toutiao_response' is defined before accessing .text
        resp_text_snippet = ""
        if 'toutiao_response' in locals() and toutiao_response is not None:
             resp_text_snippet = toutiao_response.text[:200]
        logging.error(f"头条API响应不是有效的JSON: {resp_text_snippet}...", exc_info=True)
        response_data = {"error": "头条API返回了无效的JSON响应。", "details": str(e)}
        status_code = 500
    except ValueError as e:
        logging.warning(f"数据校验失败: {e}", exc_info=True)
        # Status code and response_data already set by the raise calls (before raising)
        pass
    except Exception as e:
        logging.error(f"toutiao_post_proxy 函数内部发生未捕获异常: {e}", exc_info=True)
        response_data = {"error": "服务器内部错误。", "details": str(e)}
        status_code = 500
    
    # This ensures a return statement is ALWAYS hit at the end of the function.
    return jsonify(response_data), status_code

@app.route('/api/blogpost', methods=['POST'])
def blog_post_proxy():
    """
    代理接口，用于发布文章到指定的博客系统。
    接收 JSON: {"title": "...", "content": "...", "tags": "..."}
    """
    logging.info("收到博客发布请求。")
    
    try:
        data = request.get_json()
        if not data:
            logging.warning("API调用失败: 请求体不是有效的JSON。")
            return jsonify({"error": "请求体必须是JSON格式。"}), 400

        title = data.get('title')
        content = data.get('content')
        tags = data.get('tags', '') # 标签是可选的，默认为空字符串

        if not title or not content:
            logging.warning("API调用失败: 缺少标题或内容。")
            return jsonify({"error": "标题和内容是必填项。"}), 400
        
        # 构建 multipart/form-data 载荷
        # requests 库会自动处理 boundary
        form_data = {
            'title': (None, title),
            'content': (None, content),
            'tags': (None, tags),
            # 模拟一个空的图片文件上传，与 curl 命令一致
            'image': ('', b'', 'application/octet-stream')
        }

        logging.info(f"准备向博客系统发送 POST 请求到 {BLOG_POST_CONFIG['url']}")
        
        # 发送请求。allow_redirects=False 很重要，因为成功后通常会重定向，
        # 我们可以捕获重定向信息来判断是否成功。
        blog_response = requests.post(
            BLOG_POST_CONFIG['url'],
            headers=BLOG_POST_CONFIG['headers'],
            files=form_data,
            timeout=20,
            verify=False, # 如果你的博客使用自签名证书，可能需要这个
            allow_redirects=False # 捕获重定向响应
        )

        logging.info(f"收到博客系统响应。状态码: {blog_response.status_code}")

        # 检查是否成功。成功的标志通常是状态码为 302 (Found) 并且有 Location 头
        if blog_response.status_code == 302 and 'Location' in blog_response.headers:
            redirect_url = blog_response.headers['Location']
            logging.info(f"博客发布成功，重定向到: {redirect_url}")
            return jsonify({
                "status": "success",
                "message": "博客发布成功！",
                "redirect_url": redirect_url
            }), 200
        else:
            # 如果不是预期的重定向，说明可能出错了（例如，认证失败、内容不合规等）
            logging.error(f"博客发布失败。状态码: {blog_response.status_code}, 响应内容: {blog_response.text[:500]}")
            return jsonify({
                "status": "error",
                "message": "博客发布失败，服务器返回非预期响应。请检查认证信息(Cookie/Token)是否有效或已过期。",
                "status_code": blog_response.status_code,
                "response_text": blog_response.text[:500] # 返回部分响应内容用于调试
            }), 502 # 502 Bad Gateway 表示作为代理收到了无效响应

    except requests.exceptions.RequestException as e:
        logging.error(f"请求博客系统时发生网络错误: {e}", exc_info=True)
        return jsonify({"error": "请求博客系统时发生网络错误", "details": str(e)}), 504 # 504 Gateway Timeout
    except Exception as e:
        logging.error(f"blog_post_proxy 函数内部发生未捕获异常: {e}", exc_info=True)
        return jsonify({"error": "服务器内部错误", "details": str(e)}), 500

# --- 知乎相关路由 ---

@app.route('/api/zhihu/hot', methods=['GET'])
def api_zhihu_hot():
    """获取知乎热点话题"""
    try:
        limit = int(request.args.get('limit', 20))
        topics = fetch_zhihu_hot_topics()
        
        if not topics:
            return jsonify({"error": "未获取到知乎热点话题"}), 404
        
        # 按热度排序并限制数量
        sorted_topics = sorted(topics, key=lambda x: int(x['hot']) if str(x['hot']).isdigit() else 0, reverse=True)
        limited_topics = sorted_topics[:limit]
        
        return jsonify({
            "status": "success",
            "data": limited_topics,
            "timestamp": datetime.now().isoformat()
        })
    except Exception as e:
        logging.error(f"获取知乎热点话题失败: {str(e)}")
        return jsonify({"error": f"获取知乎热点话题失败: {str(e)}"}), 500

@app.route('/api/zhihu/inspiration', methods=['GET'])
def api_zhihu_inspiration():
    """获取知乎灵感问题"""
    try:
        limit = int(request.args.get('limit', 20))
        questions = fetch_zhihu_inspiration_questions()
        
        if not questions:
            return jsonify({"error": "未获取到知乎灵感问题"}), 404
        
        # 按热度排序并限制数量
        sorted_questions = sorted(questions, key=lambda x: int(x['hot']) if str(x['hot']).isdigit() else 0, reverse=True)
        limited_questions = sorted_questions[:limit]
        
        return jsonify({
            "status": "success",
            "data": limited_questions,
            "timestamp": datetime.now().isoformat()
        })
    except Exception as e:
        logging.error(f"获取知乎灵感问题失败: {str(e)}")
        return jsonify({"error": f"获取知乎灵感问题失败: {str(e)}"}), 500

@app.route('/api/zhihu/combined', methods=['GET'])
def api_zhihu_combined():
    """获取知乎热点和灵感问题的综合列表"""
    try:
        hot_limit = int(request.args.get('hot_limit', 15))
        inspiration_limit = int(request.args.get('inspiration_limit', 15))
        
        # 并行获取两种数据
        hot_topics = fetch_zhihu_hot_topics()
        inspiration_questions = fetch_zhihu_inspiration_questions()
        
        # 按热度排序并限制数量
        sorted_hot_topics = sorted(hot_topics, key=lambda x: int(x['hot']) if str(x['hot']).isdigit() else 0, reverse=True)
        sorted_inspiration_questions = sorted(inspiration_questions, key=lambda x: int(x['hot']) if str(x['hot']).isdigit() else 0, reverse=True)
        
        limited_hot_topics = sorted_hot_topics[:hot_limit]
        limited_inspiration_questions = sorted_inspiration_questions[:inspiration_limit]
        
        return jsonify({
            "status": "success",
            "hotTopics": limited_hot_topics,
            "inspirationQuestions": limited_inspiration_questions,
            "timestamp": datetime.now().isoformat()
        })
    except Exception as e:
        logging.error(f"获取知乎综合内容失败: {str(e)}")
        return jsonify({
            "error": f"获取知乎综合内容失败: {str(e)}",
            "hotTopics": get_fallback_topics(),
            "inspirationQuestions": get_fallback_inspiration_questions(),
            "timestamp": datetime.now().isoformat()
        }), 500

# --- 5. 启动入口 ---
if __name__ == '__main__':
    # 确保安装了 Flask, Flask-CORS, requests
    # pip install Flask Flask-CORS requests
    update_zhihu_headers()
    print('已更新知乎请求参数。')

    # 运行Flask应用
    app.run(host='0.0.0.0', port=5000, debug=False)