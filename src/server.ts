#!/usr/bin/env node
/**
 * 裁判文书网MCP服务器入口
 * Court Document MCP Server Entry Point
 * 
 * 本服务器实现了Model Context Protocol (MCP)，使AI助手能够：
 * - 搜索裁判文书
 * - 获取文书详情
 * - 管理认证状态
 * - 查询元数据（案件类型、法院级别）
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    AuthManager,
    createAuthManager,
    resetDefaultAuthManager,
    AuthManagerConfig,
} from './auth/index.js';
import {
    allToolDefinitions,
    createAllToolHandlers,
    ToolName,
} from './tools/index.js';

/**
 * 服务器配置接口
 */
interface ServerConfig {
    /** 服务器名称 */
    name: string;
    /** 服务器版本 */
    version: string;
    /** Session存储路径 */
    sessionPath?: string;
    /** 是否使用无头模式 */
    headless?: boolean;
}

/**
 * 默认服务器配置
 */
const DEFAULT_CONFIG: ServerConfig = {
    name: 'court-document-server',
    version: '1.0.1',
    sessionPath: './session-data',
    headless: true,
};

/**
 * MCP 响应内容项
 */
type ToolResponseContent = Array<{
    type: 'text' | 'image';
    text?: string;
    data?: string;
    mimeType?: string;
}>;

/**
 * MCP 工具处理结果
 */
interface ToolResponse {
    content: ToolResponseContent;
    isError?: boolean;
}

/**
 * MCP 工具定义
 */
interface ToolDefinition {
    name: ToolName;
    description: string;
    inputSchema?: unknown;
}

/**
 * 统一注册所有工具到MCP服务器
 */
function registerTools(server: McpServer, authManager: AuthManager): void {
    const toolHandlers = createAllToolHandlers(authManager);
    const unsafeServer = server as unknown as {
        registerTool: (
            name: string,
            metadata: { description: string; inputSchema?: unknown },
            handler: (args: unknown) => Promise<ToolResponse>
        ) => void;
    };

    for (const definition of allToolDefinitions as ToolDefinition[]) {
        const handler = toolHandlers[definition.name];

        if (!handler) {
            throw new Error(`未找到工具处理器: ${definition.name}`);
        }

        unsafeServer.registerTool(
            definition.name,
            {
                description: definition.description,
                inputSchema: definition.inputSchema,
            },
            async (args: unknown) => {
                const result = await handler(args);
                return normalizeToolResponse(result);
            }
        );
    }
}

/**
 * 规范化工具响应，兼容所有 handler 输出
 */
function normalizeToolResponse(result: unknown): ToolResponse {
    if (!result || typeof result !== 'object') {
        throw new Error('工具处理器返回了无效结果');
    }

    const response = result as ToolResponse;

    if (!Array.isArray(response.content)) {
        throw new Error('工具处理器返回的 content 格式无效');
    }

    return response;
}

/**
 * 启动MCP服务器
 */
async function startServer(config: ServerConfig = DEFAULT_CONFIG): Promise<void> {
    // 创建认证管理器配置
    const authConfig: AuthManagerConfig = {
        sessionConfig: config.sessionPath ? { sessionPath: config.sessionPath } : undefined,
        headless: config.headless,
    };

    // 创建认证管理器
    const authManager = createAuthManager(authConfig);

    // 创建MCP服务器
    const server = new McpServer({
        name: config.name,
        version: config.version,
    });

    // 注册所有工具
    registerTools(server, authManager);

    // 创建STDIO传输
    const transport = new StdioServerTransport();

    // 处理进程退出
    const cleanup = async () => {
        try {
            await resetDefaultAuthManager();
            await authManager.closeBrowser();
        } catch {
            // 忽略清理错误
        }
        process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    // 连接服务器到传输层
    await server.connect(transport);

    // 输出启动信息到stderr（不干扰STDIO通信）
    console.error(`裁判文书网MCP服务器已启动`);
    console.error(`服务器名称: ${config.name}`);
    console.error(`服务器版本: ${config.version}`);
    console.error(`Session路径: ${config.sessionPath}`);
    console.error(`无头模式: ${config.headless}`);
}

/**
 * 解析命令行参数和环境变量
 * 优先级: 命令行参数 > 环境变量 > 默认值
 */
function parseArgs(): ServerConfig {
    const config = { ...DEFAULT_CONFIG };
    
    // 首先读取环境变量
    if (process.env.SESSION_PATH) {
        config.sessionPath = process.env.SESSION_PATH;
    }
    if (process.env.HEADLESS !== undefined) {
        config.headless = process.env.HEADLESS.toLowerCase() !== 'false';
    }
    
    // 然后解析命令行参数（优先级更高）
    const args = process.argv.slice(2);

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const nextArg = args[i + 1];

        switch (arg) {
            case '--session-path':
                if (nextArg) {
                    config.sessionPath = nextArg;
                    i++;
                }
                break;
            case '--headless':
                config.headless = true;
                break;
            case '--no-headless':
                config.headless = false;
                break;
            case '--help':
            case '-h':
                printHelp();
                process.exit(0);
                break;
            case '--version':
            case '-v':
                console.log(config.version);
                process.exit(0);
                break;
        }
    }

    return config;
}

/**
 * 打印帮助信息
 */
function printHelp(): void {
    console.log(`
裁判文书网MCP服务器

使用方法:
  court-document-mcp [选项]

选项:
  --session-path <路径>  Session存储路径 (默认: ./session-data)
  --headless            使用无头模式运行浏览器 (默认)
  --no-headless         使用有头模式运行浏览器（弹出浏览器窗口）
  -h, --help            显示帮助信息
  -v, --version         显示版本号

环境变量:
  SESSION_PATH          Session存储路径（推荐使用绝对路径）
  HEADLESS              是否使用无头模式 (true/false)

配置优先级: 命令行参数 > 环境变量 > 默认值

示例:
  # 已安装为命令行工具时，使用默认配置启动
  court-document-mcp

  # 本地构建产物启动（推荐用于 MCP 客户端配置）
  node dist/server.js

  # 指定Session存储路径
  node dist/server.js --session-path /path/to/session

  # 使用有头模式（弹出浏览器窗口）
  node dist/server.js --no-headless

MCP配置示例 (mcp.json):
  {
    "mcpServers": {
      "court-document": {
        "command": "node",
        "args": ["D:/开发/MCP/裁判文书网mcp/dist/server.js"],
        "env": {
          "SESSION_PATH": "D:/开发/MCP/裁判文书网mcp/session-data",
          "HEADLESS": "true"
        }
      }
    }
  }
`);
}

// 主入口
const config = parseArgs();
startServer(config).catch((error) => {
    console.error('服务器启动失败:', error);
    process.exit(1);
});



