# data_api.py  – 最终加强版
from flask import Flask, request, jsonify
from flask_cors import CORS
import sqlite3
import json
import codecs

app = Flask(__name__)
# ----------------- 新增的关键配置 -----------------
# 强制 jsonify 和 json.dumps 不将中文等非ASCII字符转义成 \uXXXX 格式
app.config['JSON_AS_ASCII'] = False
# --------------------------------------------------
CORS(app)

# 数据库映射 (保持不变)
DB_PATHS = {
    'futures':   'futures_data.db',
    'minute':    'minute_data.db',
    'qhhq':      'qhhq.db',
    'qhlhb':     'qhlhb.db'
}

# 提取字母前缀 (保持不变)
def code_prefix(code: str) -> str:
    return ''.join(filter(str.isalpha, code)).upper()

# 各库最新日期字段 (保持不变)
LATEST_DATE_FIELDS = {
    'futures':   ('hqdata',        '日期'),
    'minute':    ('minute_klines', 'substr(timestamp,1,10)'),
    'qhhq':      ('dailyhq',       'substr(utime,1,10)'),
    'qhlhb':     ('dailylhb',      'tradeDate')
}

# SQL 生成器 (保持不变)
def build_latest_sql(db_type, table, prefix, limit=100):
    type_map = {
        'futures': ('期货代码', 'LIKE'),
        'minute' : ('code',    'LIKE'),
        'qhhq'   : ('dm',      'LIKE'),
        'qhlhb'  : ('contract','LIKE')
    }
    col, op = type_map[db_type]
    pattern = f'{prefix}%'
    date_col = LATEST_DATE_FIELDS[db_type][1]

    where = f"{col} {op} ? AND {date_col} = (SELECT max({date_col}) FROM {table})"
    sql = f"""
        SELECT * FROM {table}
        WHERE {where}
        ORDER BY rowid
        LIMIT ?
    """
    return sql, (pattern, limit), pattern

# Row 工厂：GBK 解码 (保持不变)
def gbk_row_factory(cursor, row):
    return {
        col[0]: (
            codecs.decode(row[i], 'gbk', 'ignore')
            if isinstance(row[i], (bytes, bytearray))
            else row[i]
        )
        for i, col in enumerate(cursor.description)
    }

# 路由 --------------------------------------------------
@app.route('/health')
def health():
    return jsonify({"status":"healthy"})

@app.route('/api/<db_type>', methods=['GET'])
def api_latest_one_day(db_type):
    if db_type not in DB_PATHS:
        response = jsonify({'error': f'无效的数据库类型: {db_type}'})
        response.status_code = 400
        return response

    code = request.args.get('code', '').strip().upper()
    if not code:
        response = jsonify({'error': 'code 参数必须提供'})
        response.status_code = 400
        return response

    limit = int(request.args.get('limit', 100))
    prefix = code_prefix(code)

    table, date_col = LATEST_DATE_FIELDS[db_type]
    sql, params, pattern = build_latest_sql(db_type, table, prefix, limit)

    conn = sqlite3.connect(DB_PATHS[db_type])
    conn.row_factory = gbk_row_factory
    try:
        cur = conn.execute(sql, params)
        rows = cur.fetchall()
        columns = [d[0] for d in cur.description]

        meta = {
            'db_type': db_type,
            'table': table,
            'code_pattern': pattern,
            'date_field': date_col,
            'sql': sql,
            'limit': limit,
            'found_rows': len(rows)
        }
        body = {"meta": meta, "columns": columns, "data": rows}
        
        response = jsonify(body)
        response.headers['Content-Type'] = 'application/json; charset=utf-8'
        return response
    finally:
        conn.close()

# ----------------------------------------------------------
if __name__ == '__main__':
    # 注意：生产环境不应使用 app.run()
    # 使用 gunicorn 或 waitress 部署
    # 例如: gunicorn -w 4 -b 0.0.0.0:5000 data_api:app
    app.run(host='0.0.0.0', port=5000, debug=False)
