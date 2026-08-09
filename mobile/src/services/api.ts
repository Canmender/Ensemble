/**
 * REST API 服务
 * 通过 HTTP 调用桌面端 API
 */

import { useDeviceStore } from "../store/deviceStore";

/** API 响应 */
interface ApiResponse<T = unknown> {
  data?: T;
  error?: string;
}

class ApiService {
  /** 获取当前连接的桌面端地址 */
  private getBaseUrl(): string | null {
    const { connectedDevice } = useDeviceStore.getState();
    if (!connectedDevice) return null;
    return `http://${connectedDevice.ip}:${connectedDevice.httpPort}`;
  }

  /** 发起 API 请求 */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<ApiResponse<T>> {
    const baseUrl = this.getBaseUrl();
    if (!baseUrl) {
      return { error: "未连接到桌面端" };
    }

    try {
      const options: RequestInit = {
        method,
        headers: {
          "Content-Type": "application/json",
        },
      };

      if (body) {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(`${baseUrl}${path}`, options);
      const data = await response.json();

      if (!response.ok) {
        return { error: data.error || `请求失败: ${response.status}` };
      }

      return { data };
    } catch (err) {
      return {
        error: `网络错误: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // ========== Agent API ==========

  /** 获取所有 Agent */
  async getAgents() {
    return this.request<any[]>("GET", "/api/agents");
  }

  /** 获取单个 Agent */
  async getAgent(id: string) {
    return this.request<any>("GET", `/api/agents/${id}`);
  }

  /** 创建 Agent */
  async createAgent(agent: any) {
    return this.request<any>("POST", "/api/agents", agent);
  }

  /** 更新 Agent */
  async updateAgent(id: string, updates: any) {
    return this.request<any>(`PATCH`, `/api/agents/${id}`, updates);
  }

  /** 删除 Agent */
  async deleteAgent(id: string) {
    return this.request<void>("DELETE", `/api/agents/${id}`);
  }

  // ========== Provider API ==========

  /** 获取所有 Provider */
  async getProviders() {
    return this.request<any[]>("GET", "/api/providers");
  }

  /** 创建 Provider */
  async createProvider(provider: any) {
    return this.request<any>("POST", "/api/providers", provider);
  }

  /** 更新 Provider */
  async updateProvider(id: string, updates: any) {
    return this.request<any>(`PATCH`, `/api/providers/${id}`, updates);
  }

  /** 删除 Provider */
  async deleteProvider(id: string) {
    return this.request<void>("DELETE", `/api/providers/${id}`);
  }

  /** 测试 Provider 连接 */
  async testProvider(id: string) {
    return this.request<any>("POST", `/api/providers/${id}/test`);
  }

  // ========== Task API ==========

  /** 获取所有任务 */
  async getTasks() {
    return this.request<any[]>("GET", "/api/tasks");
  }

  /** 创建任务 */
  async createTask(task: any) {
    return this.request<any>("POST", "/api/tasks", task);
  }

  /** 删除任务 */
  async deleteTask(id: string) {
    return this.request<void>("DELETE", `/api/tasks/${id}`);
  }

  // ========== Run API ==========

  /** 获取所有运行 */
  async getRuns() {
    return this.request<any[]>("GET", "/api/runs");
  }

  /** 获取运行详情 */
  async getRun(id: string) {
    return this.request<any>("GET", `/api/runs/${id}`);
  }

  // ========== Workflow API ==========

  /** 获取所有工作流 */
  async getWorkflows() {
    return this.request<any[]>("GET", "/api/workflows");
  }

  /** 创建工作流 */
  async createWorkflow(workflow: any) {
    return this.request<any>("POST", "/api/workflows", workflow);
  }

  /** 删除工作流 */
  async deleteWorkflow(id: string) {
    return this.request<void>("DELETE", `/api/workflows/${id}`);
  }

  // ========== Memory API ==========

  /** 获取记忆摘要 */
  async getMemory() {
    return this.request<any>("GET", "/api/memory");
  }

  // ========== Skill API ==========

  /** 获取所有技能 */
  async getSkills() {
    return this.request<any[]>("GET", "/api/skills");
  }

  // ========== Health API ==========

  /** 健康检查 */
  async getHealth() {
    return this.request<any>("GET", "/api/health");
  }
}

export const api = new ApiService();
