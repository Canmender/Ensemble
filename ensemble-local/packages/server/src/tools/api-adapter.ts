/**
 * Function Calling 适配层
 *
 * 将外部 API 自动转换为 Agent Tool，支持：
 * - OpenAPI Spec 自动生成工具
 * - API 适配器定义
 * - 认证管理
 * - 请求/响应转换
 */

import type { AgentTool, ToolContext } from "./types";
import { logger } from "../util/logger";
import { isPrivateHost } from "./web";

// ========== 类型定义 ==========

export type AuthType = "none" | "token" | "basic" | "oauth2" | "api_key";

export interface AuthConfig {
  type: AuthType;
  header?: string;
  prefix?: string;
  /** 环境变量名，用于获取密钥 */
  envKey?: string;
}

export interface EndpointDef {
  name: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  description?: string;
  params?: Record<string, { type: string; description?: string; required?: boolean; default?: unknown }>;
  body?: Record<string, { type: string; description?: string; required?: boolean }>;
  headers?: Record<string, string>;
  responseTransform?: (data: unknown) => unknown;
}

export interface ApiAdapterDef {
  name: string;
  baseUrl: string;
  description?: string;
  auth: AuthConfig;
  endpoints: EndpointDef[];
  defaultHeaders?: Record<string, string>;
}

// ========== API 适配器 ==========

export class ApiAdapter {
  private def: ApiAdapterDef;
  private authValue?: string;

  constructor(def: ApiAdapterDef) {
    this.def = def;
    this.loadAuth();
  }

  /** 从环境变量加载认证信息 */
  private loadAuth(): void {
    if (this.def.auth.type === "none") return;

    const envKey = this.def.auth.envKey;
    if (envKey) {
      this.authValue = process.env[envKey];
      if (!this.authValue) {
        logger.warn(`API adapter "${this.def.name}": missing env var ${envKey}`);
      }
    }
  }

  /** 构建认证头 */
  private buildAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};

    if (this.def.auth.type === "token" && this.authValue) {
      const header = this.def.auth.header ?? "Authorization";
      const prefix = this.def.auth.prefix ?? "Bearer";
      headers[header] = `${prefix} ${this.authValue}`;
    } else if (this.def.auth.type === "api_key" && this.authValue) {
      const header = this.def.auth.header ?? "X-API-Key";
      headers[header] = this.authValue;
    } else if (this.def.auth.type === "basic" && this.authValue) {
      headers["Authorization"] = `Basic ${Buffer.from(this.authValue).toString("base64")}`;
    }

    return headers;
  }

  /** 构建 URL */
  private buildUrl(path: string, params: Record<string, unknown>): string {
    let url = this.def.baseUrl.replace(/\/$/, "") + path;

    // 替换路径参数 {param}
    url = url.replace(/\{(\w+)\}/g, (_, key) => {
      const value = params[key];
      if (value === undefined) throw new Error(`Missing path parameter: ${key}`);
      delete params[key]; // 从 query params 中移除
      return String(value);
    });

    return url;
  }

  /** 执行 API 调用 */
  async call(endpoint: EndpointDef, input: Record<string, unknown>): Promise<unknown> {
    const params = { ...input };
    const url = this.buildUrl(endpoint.path, params);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.buildAuthHeaders(),
      ...this.def.defaultHeaders,
      ...endpoint.headers,
    };

    const options: RequestInit = {
      method: endpoint.method,
      headers,
    };

    // GET 请求用 query params，其他用 body
    if (endpoint.method === "GET") {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          searchParams.set(key, String(value));
        }
      }
      const queryString = searchParams.toString();
      const fullUrl = queryString ? `${url}?${queryString}` : url;

      const response = await fetch(fullUrl, options);
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`API error ${response.status}: ${text.slice(0, 500)}`);
      }
      const data = await response.json();
      return endpoint.responseTransform ? endpoint.responseTransform(data) : data;
    } else {
      // 构建 body
      const body: Record<string, unknown> = {};
      if (endpoint.body) {
        for (const [key, def] of Object.entries(endpoint.body)) {
          if (params[key] !== undefined) {
            body[key] = params[key];
          } else if (def.required) {
            throw new Error(`Missing required body parameter: ${key}`);
          }
        }
      } else {
        Object.assign(body, params);
      }
      options.body = JSON.stringify(body);

      const response = await fetch(url, options);
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`API error ${response.status}: ${text.slice(0, 500)}`);
      }
      const data = await response.json();
      return endpoint.responseTransform ? endpoint.responseTransform(data) : data;
    }
  }
}

// ========== 工具生成 ==========

/**
 * 将 API 适配器转换为 Agent Tools
 */
export function adapterToTools(adapterDef: ApiAdapterDef): AgentTool[] {
  const adapter = new ApiAdapter(adapterDef);

  return adapterDef.endpoints.map((endpoint) => {
    // 构建参数 schema
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    if (endpoint.params) {
      for (const [key, def] of Object.entries(endpoint.params)) {
        properties[key] = {
          type: def.type,
          description: def.description,
        };
        if (def.required) required.push(key);
      }
    }

    if (endpoint.body) {
      for (const [key, def] of Object.entries(endpoint.body)) {
        properties[key] = {
          type: def.type,
          description: def.description,
        };
        if (def.required) required.push(key);
      }
    }

    const tool: AgentTool = {
      name: `${adapterDef.name}_${endpoint.name}`,
      description: endpoint.description ?? `${adapterDef.name}: ${endpoint.method} ${endpoint.path}`,
      parameters: {
        type: "object",
        properties,
        required,
      },
      execute: async (input) => {
        try {
          const result = await adapter.call(endpoint, input as Record<string, unknown>);
          return typeof result === "string" ? result : JSON.stringify(result, null, 2);
        } catch (err) {
          return `API 调用失败: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    };

    return tool;
  });
}

// ========== OpenAPI Spec 解析 ==========

interface OpenAPISpec {
  openapi: string;
  info: { title: string; version: string; description?: string };
  servers?: Array<{ url: string; description?: string }>;
  paths: Record<string, Record<string, OpenAPIOperation>>;
  components?: {
    schemas?: Record<string, unknown>;
    securitySchemes?: Record<string, unknown>;
  };
}

interface OpenAPIOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: Array<{
    name: string;
    in: "query" | "path" | "header";
    required?: boolean;
    schema?: { type: string; description?: string };
    description?: string;
  }>;
  requestBody?: {
    content?: Record<string, { schema?: { type: string; properties?: Record<string, unknown>; required?: string[] } }>;
  };
  responses?: Record<string, unknown>;
}

/**
 * 从 OpenAPI Spec 生成 API 适配器定义
 */
export function openApiToAdapter(spec: OpenAPISpec, auth?: AuthConfig): ApiAdapterDef {
  const baseUrl = spec.servers?.[0]?.url ?? "";
  const endpoints: EndpointDef[] = [];

  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (["get", "post", "put", "delete", "patch"].includes(method.toLowerCase())) {
        const endpoint: EndpointDef = {
          name: operation.operationId ?? `${method}_${path.replace(/[\/\{\}]/g, "_")}`,
          method: method.toUpperCase() as EndpointDef["method"],
          path,
          description: operation.summary ?? operation.description,
          params: {},
          body: {},
        };

        // 解析参数
        if (operation.parameters) {
          for (const param of operation.parameters) {
            if (param.in === "query" || param.in === "path") {
              endpoint.params![param.name] = {
                type: param.schema?.type ?? "string",
                description: param.description ?? param.schema?.description,
                required: param.required,
              };
            }
          }
        }

        // 解析请求体
        if (operation.requestBody?.content) {
          const jsonContent = operation.requestBody.content["application/json"];
          if (jsonContent?.schema?.properties) {
            for (const [key, prop] of Object.entries(jsonContent.schema.properties)) {
              endpoint.body![key] = {
                type: (prop as any).type ?? "string",
                description: (prop as any).description,
                required: jsonContent.schema.required?.includes(key),
              };
            }
          }
        }

        endpoints.push(endpoint);
      }
    }
  }

  return {
    name: spec.info.title.toLowerCase().replace(/\s+/g, "_"),
    baseUrl,
    description: spec.info.description,
    auth: auth ?? { type: "none" },
    endpoints,
  };
}

/**
 * 从 URL 加载 OpenAPI Spec 并生成工具
 */
export async function loadToolsFromOpenApi(
  specUrl: string,
  auth?: AuthConfig,
): Promise<AgentTool[]> {
  try {
    // SSRF protection: reject private/internal network addresses
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(specUrl);
    } catch {
      throw new Error(`Invalid spec URL: ${specUrl}`);
    }
    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
      throw new Error(`Unsupported protocol: ${parsedUrl.protocol}`);
    }
    if (isPrivateHost(parsedUrl.hostname)) {
      throw new Error(`SSRF blocked: refusing to fetch spec from private host ${parsedUrl.hostname}`);
    }

    const response = await fetch(specUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch OpenAPI spec: ${response.status}`);
    }
    const spec = (await response.json()) as OpenAPISpec;
    const adapterDef = openApiToAdapter(spec, auth);
    return adapterToTools(adapterDef);
  } catch (err) {
    logger.error(`Failed to load OpenAPI spec from ${specUrl}: ${err}`);
    return [];
  }
}

// ========== 预定义 API 适配器 ==========

/** GitHub API 适配器 */
export const githubAdapter: ApiAdapterDef = {
  name: "github",
  baseUrl: "https://api.github.com",
  description: "GitHub API - 仓库、Issue、PR 管理",
  auth: {
    type: "token",
    header: "Authorization",
    prefix: "Bearer",
    envKey: "GITHUB_TOKEN",
  },
  endpoints: [
    {
      name: "search_repos",
      method: "GET",
      path: "/search/repositories",
      description: "搜索 GitHub 仓库",
      params: {
        q: { type: "string", description: "搜索查询", required: true },
        sort: { type: "string", description: "排序方式: stars, forks, updated" },
        per_page: { type: "number", description: "每页结果数，默认 30" },
      },
    },
    {
      name: "get_repo",
      method: "GET",
      path: "/repos/{owner}/{repo}",
      description: "获取仓库详情",
      params: {
        owner: { type: "string", description: "仓库所有者", required: true },
        repo: { type: "string", description: "仓库名", required: true },
      },
    },
    {
      name: "list_issues",
      method: "GET",
      path: "/repos/{owner}/{repo}/issues",
      description: "列出仓库 Issues",
      params: {
        owner: { type: "string", description: "仓库所有者", required: true },
        repo: { type: "string", description: "仓库名", required: true },
        state: { type: "string", description: "状态: open, closed, all" },
        per_page: { type: "number", description: "每页结果数" },
      },
    },
    {
      name: "create_issue",
      method: "POST",
      path: "/repos/{owner}/{repo}/issues",
      description: "创建 Issue",
      params: {
        owner: { type: "string", description: "仓库所有者", required: true },
        repo: { type: "string", description: "仓库名", required: true },
      },
      body: {
        title: { type: "string", description: "Issue 标题", required: true },
        body: { type: "string", description: "Issue 内容" },
        labels: { type: "array", description: "标签列表" },
      },
    },
  ],
};

/** 获取预定义适配器 */
export function getPredefinedAdapter(name: string): ApiAdapterDef | undefined {
  const adapters: Record<string, ApiAdapterDef> = {
    github: githubAdapter,
  };
  return adapters[name];
}
