#!/usr/bin/env python3
"""
头条自动发文外部访问示例

这个脚本展示了如何从外部（如Python）访问头条自动发文功能，
无需通过聊天室界面。
"""

import requests
import json
import time
from typing import Dict, Any, Optional

class ToutiaoExternalClient:
    """头条服务外部客户端"""
    
    def __init__(self, base_url: str, room_name: str = "external"):
        """
        初始化客户端
        
        Args:
            base_url: 服务的基础URL，如 "https://your-domain.com"
            room_name: 房间名称，用于标识不同的使用场景
        """
        self.base_url = base_url.rstrip('/')
        self.room_name = room_name
        
    def submit_toutiao_task(self, text: str, username: str = "external_user") -> Dict[str, Any]:
        """
        提交头条内容生成任务
        
        Args:
            text: 要生成内容的主题或关键词
            username: 用户名标识
            
        Returns:
            任务提交结果，包含taskId等信息
        """
        task_data = {
            "text": text,
            "username": username,
            "id": f"external_{int(time.time())}_{hash(text) % 10000}"
        }
        
        # 通过聊天室DO的API接口提交任务
        url = f"{self.base_url}/api/messages/toutiao"
        params = {"roomName": self.room_name}
        
        try:
            response = requests.post(url, params=params, json=task_data)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            return {"error": str(e), "success": False}
    
    def process_direct_task(self, text: str, username: str = "external_user") -> Dict[str, Any]:
        """
        直接处理头条任务（不经过队列）
        
        Args:
            text: 要生成内容的主题或关键词
            username: 用户名标识
            
        Returns:
            内容生成结果
        """
        task_data = {
            "text": text,
            "username": username,
            "id": f"direct_{int(time.time())}_{hash(text) % 10000}"
        }
        
        # 直接调用头条服务
        url = f"{self.base_url}/api/toutiao/direct"
        params = {"roomName": self.room_name}
        
        try:
            response = requests.post(url, params=params, json=task_data)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            return {"error": str(e), "success": False}
    
    def check_task_status(self, task_id: str) -> Dict[str, Any]:
        """
        检查任务状态
        
        Args:
            task_id: 任务ID
            
        Returns:
            任务状态和结果
        """
        url = f"{self.base_url}/api/toutiao/status"
        params = {"roomName": self.room_name, "taskId": task_id}
        
        try:
            response = requests.get(url, params=params)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            return {"error": str(e), "success": False}
    
    def get_service_status(self) -> Dict[str, Any]:
        """
        获取头条服务状态
        
        Returns:
            服务状态信息
        """
        url = f"{self.base_url}/api/room/status"
        params = {"roomName": self.room_name}
        
        try:
            response = requests.get(url, params=params)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            return {"error": str(e), "success": False}

class SimpleToutiaoAPI:
    """简化的头条API访问类"""
    
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip('/')
    
    def generate_content(self, topic: str, style: str = "头条") -> Dict[str, Any]:
        """
        生成头条内容
        
        Args:
            topic: 内容主题
            style: 内容风格
            
        Returns:
            生成的内容
        """
        client = ToutiaoExternalClient(self.base_url)
        
        # 构建提示词
        prompt = f"请为'{topic}'主题生成一篇{style}风格的文章"
        
        # 直接处理任务
        result = client.process_direct_task(prompt)
        
        return result
    
    def batch_generate(self, topics: list) -> list:
        """
        批量生成内容
        
        Args:
            topics: 主题列表
            
        Returns:
            生成结果列表
        """
        results = []
        client = ToutiaoExternalClient(self.base_url)
        
        for topic in topics:
            result = client.process_direct_task(f"生成关于'{topic}'的头条文章")
            results.append({
                "topic": topic,
                "result": result
            })
            time.sleep(1)  # 避免请求过快
        
        return results

def main():
    """使用示例"""
    
    # 配置你的服务URL
    BASE_URL = "https://your-chat-service.com"  # 替换为你的实际域名
    
    # 创建客户端
    client = ToutiaoExternalClient(BASE_URL, room_name="python_client")
    
    # 示例1：提交任务
    print("=== 提交头条任务 ===")
    result = client.submit_toutiao_task(
        text="人工智能如何改变我们的日常生活",
        username="python_bot"
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    
    # 示例2：直接处理
    print("\n=== 直接处理任务 ===")
    result = client.process_direct_task(
        text="5G技术对未来社会的影响分析",
        username="python_bot"
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    
    # 示例3：批量生成
    print("\n=== 批量生成内容 ===")
    topics = ["新能源汽车", "数字货币", "远程办公", "健康饮食"]
    api = SimpleToutiaoAPI(BASE_URL)
    results = api.batch_generate(topics)
    
    for item in results:
        print(f"主题: {item['topic']}")
        print(f"状态: {'成功' if item['result'].get('success') else '失败'}")
        if item['result'].get('data'):
            print(f"标题: {item['result']['data'].get('title', 'N/A')}")
        print("-" * 50)
    
    # 示例4：检查服务状态
    print("\n=== 服务状态 ===")
    status = client.get_service_status()
    print(json.dumps(status, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()