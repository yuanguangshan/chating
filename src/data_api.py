# data_api.py - 最终完整版
# 包含：
# 1. /health 健康检查接口
# 2. /api/<db_type> 获取指定品种最新一天数据的接口
# 3. /api/aggregate 对日线数据进行聚合查询（如求N天内最高价）的接口
# 4. /api/toutiaopost 发布文章到头条的代理接口 (新增)

from flask import Flask, request, jsonify
from flask_cors import CORS
import sqlite3
import codecs
from datetime import datetime, timedelta

# --- 新增导入 ---
import requests
import json
import logging
import time # 用于获取当前时间戳


# 配置日志 (如果已经配置过，可以跳过)
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

# --- 新增：头条API相关常量 (从你提供的curl命令中提取并硬编码) ---
TOUTIAO_API_BASE_URL = "https://ib.snssdk.com/pgcapp/mp/agw/article/publish"

# URL 查询参数 (直接复制你的curl命令中的参数)
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

# 请求头 (从你提供的curl命令中提取，包括那些签名)
# 这些是核心问题，硬编码且脆弱，无法动态计算
TOUTIAO_HEADERS = {
    "Host": "ib.snssdk.com",
    "Connection": "keep-alive",
    "x-Tt-Token": "00beea9a49b13130a18ffaf8397042fab700c003fd996720690ed1322b340d464536b4ca2a2aa0868cb61df177c4081ae4dae80785b0ec888969220aeb60ba60d99df6369362fd70e8d89cfb7c46e2713d09a32d3b638da6c8133ad2885e112c65289--0a490a20523ccfab387acfed3f5d8e43be1d7642dcefff4445b6d88158b33d211636133812208f3963668516980676fc24d91bf26cb75d3b1078c6a2d195624a071c695bbe6c18f6b4d309-3.0.1",
    # Cookie 也是硬编码的，如果失效需要从新的合法请求中获取并更新
    "Cookie": "store-region=cn-sh; store-region-src=uid; FRM=new; PIXIEL_RATIO=3; WIN_WH=390_844; d_ticket=03baf8528d2ed41d6e4f50bbab6d510e9c684; ttwid=1%7CCuG9RHWdsNGnIkwQzxaGQYNdFB7oKQXJlzowyBPnavQ%7C1699378517%7C8c0c38a62793b9bbe3a33a8930d5ac059278fc7e681b53a1f3e94d0d59bec043; odin_tt=e664859603dd14a3b61beb10a5b56949a14e9856d1da68788f5988c36a26b177919315c204f455c8a8371cd56af40a1cfb957d87605b52d03246eacfacb3912c; ariaDefaultTheme=undefined; passport_csrf_token=fc5cb2b50e13c6525d1895832aa2113c; passport_csrf_token_default=fc5cb2b50e13c6525d1895832aa2113c; is_staff_user=false; sessionid=beea9a49b13130a18ffaf8397042fab7; sessionid_ss=beea9a49b13130a18ffaf8397042fab7; sid_guard=beea9a49b13130a18ffaf8397042fab7%7C1751570868%7C5184000%7CMon%2C+01-Sep-2025+19%3A27%3A48+GMT; sid_tt=beea9a49b13130a18ffaf8397042fab7; sid_ucp_v1=1.0.0-KGI3Mjk2ZTBkMTMxMmE5MmJiODRiOTRmYWY1ODFmNTJiYTA5Njc5NTEKJgjx7u3MFRC0s5vDBhgTIAwol9nwvr3M2AQw2p2XswU4AkDxB0gBGgJsZiIgYmVlYTlhNDliMTMxMzBhMThmZmFmODM5NzA0MmZhYjc; ssid_ucp_v1=1.0.0-KGI3Mjk2ZTBkMTMxMmE5MmJiODRiOTRmYWY1ODFmNTJiYTA5Njc5NTEKJgjx7u3MFRC0s5vDBhgTIAwol9nwvr3M2AQw2p2XswU4AkDxB0gBGgJsZiIgYmVlYTlhNDliMTMxMzBhMThmZmFmODM5NzA0MmZhYjc; uid_tt=a6f1b830a6aad57983224b2b49766a3d; uid_tt_ss=a6f1b830a6aad57983224b2b49766a3d; session_tlb_tag=sttt%7C12%7CvuqaSbExMKGP-vg5cEL6t__________lvvcgCTow8cEfjvrchmi9yN17lDa-lvBADfViAlrDml0%3D; install_id=3186833641732558; ttreq=1$6723e6235ede746ae1af1b8d2327217c12d805ed",
    "x-vc-bdturing-sdk-version": "2.2.9",
    "Content-Type": "application/x-www-form-urlencoded",
    "X-SS-Cookie": "install_id=3186833641732558; ttreq=1$6723e6235ede746ae1af1b8d2327217c12d805ed; session_tlb_tag=sttt%7C12%7CvuqaSbExMKGP-vg5cEL6t__________lvvcgCTow8cEfjvrchmi9yN17lDa-lvBADfViAlrDml0%3D; is_staff_user=false; sessionid=beea9a49b13130a18ffaf8397042fab7; sessionid_ss=beea9a49b13130a18ffaf8397042fab7; sid_guard=beea9a49b13130a18ffaf8397042fab7%7C1751570868%7C5184000%7CMon%2C+01-Sep-2025+19%3A27%3A48+GMT; sid_tt=beea9a49b13130a18ffaf8397042fab7; sid_ucp_v1=1.0.0-KGI3Mjk2ZTBkMTMxMmE5MmJiODRiOTRmYWY1ODFmNTJiYTA5Njc5NTEKJgjx7u3MFRC0s5vDBhgTIAwol9nwvr3M2AQw2p2XswU4AkDxB0gBGgJsZiIgYmVlYTlhNDliMTMxMzBhMThmZmFmODM5NzA0MmZhYjc; ssid_ucp_v1=1.0.0-KGI3Mjk2ZTBkMTMxMmE5MmJiODRiOTRmYWY1ODFmNTJiYTA5Njc5NTEKJgjx7u3MFRC0s5vDBhgTIAwol9nwvr3M2AQw2p2XswU4AkDxB0gBGgJsZiIgYmVlYTlhNDliMTMxMzBhMThmZmFmODM5NzA0MmZhYjc; uid_tt=a6f1b830a6aad57983224b2b49766a3d; uid_tt_ss=a6f1b830a6aad57983224b2b49766a3d; passport_csrf_token=fc5cb2b50e13c6525d1895832aa2113c; passport_csrf_token_default=fc5cb2b50e13c6525d1895832aa2113c; ariaDefaultTheme=undefined; odin_tt=e664859603dd14a3b61beb10a5b56949a14e9856d1da68788f5988c36a26b177919315c204f455c8a8371cd56af40a1cfb957d87605b52d03246eacfacb3912c; ttwid=1%7CCuG9RHWdsNGnIkwQzxaGQYNdFB7oKQXJlzowyBPnavQ%7C1699378517%7C8c0c38a62793b9bbe3a33a8930d5ac059278fc7e681b53a1f3e94d0d59bec043; d_ticket=03baf8528d2ed41d6e4f50bbab6d510e9c684; FRM=new; PIXIEL_RATIO=3; WIN_WH=390_844; store-region=cn-sh; store-region-src=uid",
    "tt-request-time": "1752642339124", # 保持原始 curl 中的时间戳，这个时间戳是在未来
    "User-Agent": "NewsSocial 9.0.0 rv:9.0.0.20 (iPhone; iOS 18.5; zh_CN) Cronet",
    "sdk-version": "2",
    "x-tt-dt": "AAAZGUYOABV34XKPYQAACEOO4MBQWN2OA7IRSYSOASZQA4DBZRY7CYANGO53CNAD5EETHYYWFCH6SN3LDPBSJOZCDU536OHV5HR2EG6QGTAGOQA5CMGBENT3B3U7AYTV3CDGGNQY7CFRRZBW65FM4XQ",
    "passport-sdk-version": "5.17.5-rc.8-toutiao",
    "X-SS-STUB": "E94C602985537DACD686BFB04ED20198",
    "x-tt-local-region": "unknown",
    "x-bd-kmsv": "1",
    "x-tt-trace-id": "00-119fc2d00dcc268872033edc3b620013-119fc2d00dcc2688-01",
    "Accept-Encoding": "gzip, deflate",
    "X-Argus": "FEBoYI7BSzvTZRbQ9ibi2xCGbmguVmyMLkpCrKA89hk+YgQqws/TvqucNvoAWBnCBdSTDV6jv+LjzxHbnF/D9xOH5mU4hnpm9uL1H/ucCvND6WIke5OL4Hpou3RcA33fd5p+mHMLiL3HEu283Q9vSsW1YCJxBYUqd02Aj5wvEngZgWzabNjguFbpNg+AZ1R79wfr5phkaHQusi3YlDCXt1gaskaaTOIV70DcEfl7HbGwRpZH5k9FE2h3GBYohM2QHjyyNeEpWcL3USw0nuv771XuDmfCP/ubVJKXl+GJ1XUQGuCFTl1c3TftWEatoicHYOA=",
    "X-Gorgon": "8404e0230000fbbd0c9203ec8975280bb5a16f348e48f929a7eb",
    "X-Khronos": "1752642339", # 保持原始 curl 中的时间戳，这个时间戳是在未来
    "X-Ladon": "8T7vOGRNi4tIZIfnnUxbxGZeJysrb+Z2DzGVwqbyM3f+8XOM"
}

# POST 请求体数据模板 (除了标题和内容，其他都是固定值)
# 这里的 "content_word_cnt" 会根据实际内容动态计算
TOUTIAO_POST_DATA_TEMPLATE = {
    "article_ad_type": "3",
    "article_type": "0",
    "claim_origin": "0",
    "from_page": "main_publisher",
    "goods_card_cnt": "0",
    "is_original_image_clicked": "0",
    "paste_words_cnt": "0",
    "pgc_feed_covers": "[]",
    "pgc_id": "7527541462024585754", # 使用你成功发布时用的固定ID (可能代表草稿ID)
    "praise": "0",
    "save": "1", # 保存并发布
    "source": "3",
    "with_video": "0"
}


# --- 3. 辅助函数 (保持不变) ---

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

# --- 新增：聚合查询路由 (保持不变) ---
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

# --- 新增：发布到头条的代理接口 ---
@app.route('/api/toutiaopost', methods=['POST'])
def toutiao_post_proxy():
    """
    代理接口：接收前端的标题和内容，转发到头条的发布API。
    注意：此接口依赖硬编码的签名，稳定性差。
    """
    title = request.form.get('title')
    content = request.form.get('content')

    if not title or not content:
        logging.warning("API调用失败: 缺少标题或内容。")
        return jsonify({"error": "Title and content are required."}), 400

    # 构造请求体数据
    post_data_payload = TOUTIAO_POST_DATA_TEMPLATE.copy() # 使用模板的副本
    post_data_payload["title"] = title
    post_data_payload["content"] = f"<p>{content}</p>" # 将内容包裹在 <p> 标签中
    post_data_payload["extra"] = json.dumps({"content_word_cnt": len(content)}) # 动态计算字数

    # 注意：这里的 TOUTIAO_HEADERS 已经包含了 Cookie 和 tt-request-time, X-Khronos 等固定值
    # 这些值很可能已经过期或者需要与实际的请求内容动态计算，所以非常脆弱。
    # 特别是 tt-request-time 和 X-Khronos，如果服务器严格校验时间，用固定值可能导致问题
    # 如果要尝试使用当前时间，可以这样覆盖：
    # TOUTIAO_HEADERS["tt-request-time"] = str(int(time.time() * 1000))
    # TOUTIAO_HEADERS["X-Khronos"] = str(int(time.time()))

    logging.info(f"正在向头条API发送文章：{title}...")
    try:
        response = requests.post(
            TOUTIAO_API_BASE_URL,
            params=TOUTIAO_QUERY_PARAMS,
            data=post_data_payload, # requests库会自动将字典转换为x-www-form-urlencoded
            headers=TOUTIAO_HEADERS,
            timeout=15, # 设置一个合理的超时时间
            verify=False # 如果目标IP证书与域名不匹配，可能需要设置为False，但有安全风险！
                         # 更好的做法是确保Host头正确，并连接到与证书匹配的IP/域名
                         # 在生产环境中，应始终 verify=True
        )
        response.raise_for_status() # 如果状态码不是 2xx，则抛出 HTTPError

        logging.info(f"头条API响应成功 (Status: {response.status_code})")
        return jsonify(response.json()), response.status_code

    except requests.exceptions.HTTPError as e:
        logging.error(f"头条API返回HTTP错误: {e.response.status_code} - {e.response.text}")
        return jsonify({"error": f"头条API返回HTTP错误: {e.response.status_code}", "details": e.response.text}), e.response.status_code
    except requests.exceptions.ConnectionError as e:
        logging.error(f"连接错误: 无法连接到头条API - {e}")
        return jsonify({"error": "无法连接到头条API，请检查网络或API地址。", "details": str(e)}), 503
    except requests.exceptions.Timeout as e:
        logging.error(f"请求超时: {e}")
        return jsonify({"error": "请求头条API超时，请稍后再试。", "details": str(e)}), 504
    except requests.exceptions.RequestException as e:
        logging.error(f"发送请求到头条API时发生未知异常: {e}")
        return jsonify({"error": "发送请求到头条API时发生未知错误。", "details": str(e)}), 500
    except json.JSONDecodeError as e:
        # 有些错误响应可能不是JSON，尝试捕获
        logging.error(f"头条API响应不是有效的JSON: {response.text[:200] if response else '无响应'}", exc_info=True)
        return jsonify({"error": "头条API返回了无效的JSON响应。", "details": str(e)}), 500
    except Exception as e:
        logging.error(f"服务器内部错误: {e}", exc_info=True)
        return jsonify({"error": "服务器内部错误。", "details": str(e)}), 500

# --- 5. 启动入口 (保持不变) ---
if __name__ == '__main__':
    # 确保安装了 Flask, Flask-CORS, requests
    # pip install Flask Flask-CORS requests

    # 运行Flask应用
    app.run(host='0.0.0.0', port=5000, debug=False)