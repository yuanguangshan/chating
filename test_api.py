import requests
import json
import time

API_URL = "https://api.yuangs.cc/api/publish"


def send_publish_request(title, content, content_md, tags, targets=None):
    """
    发送发布请求到 data_api.py 服务。
    :param title: 文章标题
    :param content: 纯文本内容
    :param content_md: Markdown 内容
    :param tags: 标签字符串，逗号分隔
    :param targets: 目标平台列表，例如 ["blog"], ["toutiao"], 或 ["blog", "toutiao"]
    """
    payload = {
        "title": title,
        "content": content,
        "content_md": content_md,
        "tags": tags,
    }
    if targets is not None:
        payload["targets"] = targets

    headers = {"Content-Type": "application/json"}

    print(f"\n--- 发送请求到: {API_URL} ---")
    print(f"请求体: {json.dumps(payload, indent=2, ensure_ascii=False)}")

    try:
        response = requests.post(
            API_URL, headers=headers, data=json.dumps(payload), timeout=30
        )
        response.raise_for_status()  # Raises HTTPError for bad responses (4xx or 5xx)
        print("\n--- 响应 ---")
        print(json.dumps(response.json(), indent=2, ensure_ascii=False))
    except requests.exceptions.HTTPError as http_err:
        print("\n--- HTTP 错误 ---")
        print(f"HTTP error occurred: {http_err}")
        print(f"响应状态码: {response.status_code}")
        print(f"响应内容: {response.text}")
    except requests.exceptions.ConnectionError as conn_err:
        print("\n--- 连接错误 ---")
        print(f"Connection error occurred: {conn_err}")
    except requests.exceptions.Timeout as timeout_err:
        print("\n--- 超时错误 ---")
        print(f"Timeout error occurred: {timeout_err}")
    except requests.exceptions.RequestException as req_err:
        print("\n--- 其他请求错误 ---")
        print(f"An unexpected error occurred: {req_err}")
    except json.JSONDecodeError:
        print("\n--- JSON 解析错误 ---")
        print(f"无法解析响应为 JSON。原始响应: {response.text}")


if __name__ == "__main__":
    # # 1. 测试：只发布到博客
    # print("\n\n========== 测试场景 1: 只发布到博客 ==========")
    # send_publish_request(
    #     title=f"Python测试工具：只发博客 苑 {int(time.time())}",
    #     content="这是Python测试工具发送的，只发布到博客的内容。",
    #     content_md="# Python测试工具：只发博客\n\n这是Python测试工具发送的，只发布到博客的内容。",
    #     tags="python,test,blog-only",
    #     targets=["blog"],
    # )
    # time.sleep(5)  # 等待几秒，避免请求过快

    # # 2. 测试：只发布到头条
    # print("\n\n========== 测试场景 2: 只发布到头条 ==========")
    # send_publish_request(
    #     title=f"Python测试工具：只发头条 {int(time.time())}",
    #     content="这是Python测试工具发送的，只发布到头条的内容。",
    #     content_md="# Python测试工具：只发头条\n\n这是Python测试工具发送的，只发布到头条的内容。",
    #     tags="python,test,toutiao-only",
    #     targets=["toutiao"]
    # )
    # time.sleep(5)

    # # 3. 测试：发布到所有平台 (明确指定)
    # print("\n\n========== 测试场景 3: 发布到所有平台 (明确指定) ==========")
    # send_publish_request(
    #     title=f"Python测试工具：发布到所有平台 {int(time.time())}",
    #     content="这是Python测试工具发送的，发布到所有平台的内容。",
    #     content_md="# Python测试工具：发布到所有平台\n\n这是Python测试工具发送的，发布到所有平台的内容。",
    #     tags="python,test,all",
    #     targets=["blog", "toutiao"]
    # )
    # time.sleep(5)

    # # 4. 测试：发布到所有平台 (不指定targets，使用默认行为)
    # print("\n\n========== 测试场景 4: 发布到所有平台 (不指定targets) ==========")
    # send_publish_request(
    #     title=f"头条真不错，强烈向大家推荐{int(time.time())}",
    #     content="头条真不错，强烈向大家推荐,一个非常好的平台 ",
    #     content_md="# 头条真不错，强烈向大家推荐,一个非常好的平台Python测试工具：发布到所有平台 (默认)\n\n这是Python测试工具发送的，发布到所有平台的内容，不指定targets参数。",
    #     tags="python,test,default",
    # )
