// 文件: src/authServiceDO.js
// 认证服务Durable Object，用于处理用户认证和权限管理

import { DurableObject } from "cloudflare:workers";

/**
 * 认证服务Durable Object类
 * 处理用户认证、权限验证和会话管理
 */
export class AuthServiceDO2 extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.isInitialized = false;
  }

  /**
   * 初始化存储结构
   */
  async initialize() {
    if (this.isInitialized) return;

    try {
      // 初始化用户存储
      const users = await this.ctx.storage.get("users");
      if (!users) {
        await this.ctx.storage.put("users", new Map());
      }

      // 初始化会话存储
      const sessions = await this.ctx.storage.get("sessions");
      if (!sessions) {
        await this.ctx.storage.put("sessions", new Map());
      }

      // 初始化权限存储
      const permissions = await this.ctx.storage.get("permissions");
      if (!permissions) {
        await this.ctx.storage.put("permissions", new Map());
      }

      this.isInitialized = true;
    } catch (error) {
      console.error("AuthServiceDO2 初始化失败:", error);
      throw error;
    }
  }

  /**
   * 处理HTTP请求
   */
  async fetch(request) {
    await this.initialize();

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      switch (path) {
        case "/api/auth/login":
          return await this.handleLogin(request);
        case "/api/auth/logout":
          return await this.handleLogout(request);
        case "/api/auth/verify":
          return await this.handleVerify(request);
        case "/api/auth/permissions":
          return await this.handlePermissions(request);
        case "/api/auth/users":
          return await this.handleUsers(request);
        default:
          return new Response("未找到服务", { status: 404 });
      }
    } catch (error) {
      console.error("AuthServiceDO2 请求处理错误:", error);
      return new Response("内部服务器错误", { status: 500 });
    }
  }

  /**
   * 处理用户登录
   */
  async handleLogin(request) {
    if (request.method !== "POST") {
      return new Response("方法不允许", { status: 405 });
    }

    try {
      const { username, password, roomId } = await request.json();

      if (!username || !password) {
        return new Response("用户名和密码不能为空", { status: 400 });
      }

      // 获取用户数据
      const users = (await this.ctx.storage.get("users")) || new Map();
      const user = users.get(username);

      if (!user || user.password !== password) {
        return new Response("用户名或密码错误", { status: 401 });
      }

      // 创建会话
      const sessionId = crypto.randomUUID();
      const sessions = (await this.ctx.storage.get("sessions")) || new Map();
      const session = {
        id: sessionId,
        username: username,
        roomId: roomId || "default",
        loginTime: Date.now(),
        lastActivity: Date.now(),
      };

      sessions.set(sessionId, session);
      await this.ctx.storage.put("sessions", sessions);

      return new Response(
        JSON.stringify({
          success: true,
          sessionId: sessionId,
          username: username,
          permissions: user.permissions || [],
        }),
        {
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch (error) {
      console.error("登录处理错误:", error);
      return new Response("登录失败", { status: 500 });
    }
  }

  /**
   * 处理用户登出
   */
  async handleLogout(request) {
    if (request.method !== "POST") {
      return new Response("方法不允许", { status: 405 });
    }

    try {
      const { sessionId } = await request.json();

      if (!sessionId) {
        return new Response("会话ID不能为空", { status: 400 });
      }

      const sessions = (await this.ctx.storage.get("sessions")) || new Map();
      sessions.delete(sessionId);
      await this.ctx.storage.put("sessions", sessions);

      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("登出处理错误:", error);
      return new Response("登出失败", { status: 500 });
    }
  }

  /**
   * 验证会话有效性
   */
  async handleVerify(request) {
    if (request.method !== "GET") {
      return new Response("方法不允许", { status: 405 });
    }

    try {
      const url = new URL(request.url);
      const sessionId = url.searchParams.get("sessionId");

      if (!sessionId) {
        return new Response("会话ID不能为空", { status: 400 });
      }

      const sessions = (await this.ctx.storage.get("sessions")) || new Map();
      const session = sessions.get(sessionId);

      if (!session) {
        return new Response(JSON.stringify({ valid: false }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // 更新最后活动时间
      session.lastActivity = Date.now();
      sessions.set(sessionId, session);
      await this.ctx.storage.put("sessions", sessions);

      return new Response(
        JSON.stringify({
          valid: true,
          username: session.username,
          roomId: session.roomId,
        }),
        {
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch (error) {
      console.error("会话验证错误:", error);
      return new Response("验证失败", { status: 500 });
    }
  }

  /**
   * 处理权限相关请求
   */
  async handlePermissions(request) {
    if (request.method !== "GET") {
      return new Response("方法不允许", { status: 405 });
    }

    try {
      const url = new URL(request.url);
      const username = url.searchParams.get("username");

      if (!username) {
        return new Response("用户名不能为空", { status: 400 });
      }

      const users = (await this.ctx.storage.get("users")) || new Map();
      const user = users.get(username);

      if (!user) {
        return new Response("用户不存在", { status: 404 });
      }

      return new Response(
        JSON.stringify({
          username: username,
          permissions: user.permissions || [],
        }),
        {
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch (error) {
      console.error("权限查询错误:", error);
      return new Response("查询失败", { status: 500 });
    }
  }

  /**
   * 处理用户管理请求
   */
  async handleUsers(request) {
    const url = new URL(request.url);
    const method = request.method;

    try {
      switch (method) {
        case "GET":
          return await this.getUsers();
        case "POST":
          return await this.createUser(request);
        case "PUT":
          return await this.updateUser(request);
        case "DELETE":
          return await this.deleteUser(request);
        default:
          return new Response("方法不允许", { status: 405 });
      }
    } catch (error) {
      console.error("用户管理错误:", error);
      return new Response("操作失败", { status: 500 });
    }
  }

  /**
   * 获取用户列表
   */
  async getUsers() {
    try {
      const users = (await this.ctx.storage.get("users")) || new Map();
      const userList = Array.from(users.entries()).map(([username, user]) => ({
        username: username,
        permissions: user.permissions || [],
        createdAt: user.createdAt || Date.now(),
      }));

      return new Response(JSON.stringify({ users: userList }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("获取用户列表错误:", error);
      return new Response("获取失败", { status: 500 });
    }
  }

  /**
   * 创建新用户
   */
  async createUser(request) {
    try {
      const { username, password, permissions = [] } = await request.json();

      if (!username || !password) {
        return new Response("用户名和密码不能为空", { status: 400 });
      }

      const users = (await this.ctx.storage.get("users")) || new Map();

      if (users.has(username)) {
        return new Response("用户已存在", { status: 409 });
      }

      const newUser = {
        username: username,
        password: password,
        permissions: permissions,
        createdAt: Date.now(),
      };

      users.set(username, newUser);
      await this.ctx.storage.put("users", users);

      return new Response(
        JSON.stringify({
          success: true,
          message: "用户创建成功",
        }),
        {
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch (error) {
      console.error("创建用户错误:", error);
      return new Response("创建失败", { status: 500 });
    }
  }

  /**
   * 更新用户信息
   */
  async updateUser(request) {
    try {
      const { username, password, permissions } = await request.json();

      if (!username) {
        return new Response("用户名不能为空", { status: 400 });
      }

      const users = (await this.ctx.storage.get("users")) || new Map();
      const user = users.get(username);

      if (!user) {
        return new Response("用户不存在", { status: 404 });
      }

      if (password) user.password = password;
      if (permissions) user.permissions = permissions;
      user.updatedAt = Date.now();

      users.set(username, user);
      await this.ctx.storage.put("users", users);

      return new Response(
        JSON.stringify({
          success: true,
          message: "用户更新成功",
        }),
        {
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch (error) {
      console.error("更新用户错误:", error);
      return new Response("更新失败", { status: 500 });
    }
  }

  /**
   * 删除用户
   */
  async deleteUser(request) {
    try {
      const { username } = await request.json();

      if (!username) {
        return new Response("用户名不能为空", { status: 400 });
      }

      const users = (await this.ctx.storage.get("users")) || new Map();

      if (!users.has(username)) {
        return new Response("用户不存在", { status: 404 });
      }

      users.delete(username);
      await this.ctx.storage.put("users", users);

      // 同时删除相关会话
      const sessions = (await this.ctx.storage.get("sessions")) || new Map();
      for (const [sessionId, session] of sessions.entries()) {
        if (session.username === username) {
          sessions.delete(sessionId);
        }
      }
      await this.ctx.storage.put("sessions", sessions);

      return new Response(
        JSON.stringify({
          success: true,
          message: "用户删除成功",
        }),
        {
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch (error) {
      console.error("删除用户错误:", error);
      return new Response("删除失败", { status: 500 });
    }
  }

  /**
   * 清理过期会话（定时任务调用）
   */
  async cleanupExpiredSessions() {
    try {
      const sessions = (await this.ctx.storage.get("sessions")) || new Map();
      const now = Date.now();
      const maxAge = 24 * 60 * 60 * 1000; // 24小时

      let cleanedCount = 0;
      for (const [sessionId, session] of sessions.entries()) {
        if (now - session.lastActivity > maxAge) {
          sessions.delete(sessionId);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        await this.ctx.storage.put("sessions", sessions);
      }

      return { success: true, cleanedCount };
    } catch (error) {
      console.error("清理过期会话错误:", error);
      return { success: false, error: error.message };
    }
  }
}
