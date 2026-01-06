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
import { z } from 'zod';
import {
    AuthManager,
    createAuthManager,
    resetDefaultAuthManager,
    AuthManagerConfig,
} from './auth/index.js';
import {
    AuthTools,
    WaitLoginInputSchema,
    BrowserLoginInputSchema,
} from './tools/auth.js';
import {
    MetadataTools,
} from './tools/metadata.js';
import {
    SearchTools,
    SearchDocumentsInputSchema,
} from './tools/search.js';
import {
    DocumentTools,
    GetDocumentInputSchema,
} from './tools/document.js';

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
    version: '1.0.0',
    sessionPath: './session-data',
    headless: true,
};

/**
 * 注册所有工具到MCP服务器
 */
function registerTools(server: McpServer, authManager: AuthManager): void {
    // 创建工具实例
    const authTools = new AuthTools(authManager);
    const metadataTools = new MetadataTools();
    const searchTools = new SearchTools(authManager);
    const documentTools = new DocumentTools(authManager);

    // ========== 认证工具 ==========

    // login_status - 检查登录状态
    server.registerTool(
        'login_status',
        {
            description: '检查当前登录状态。返回是否已登录以及Session剩余有效时间。',
        },
        async () => {
            const result = await authTools.loginStatus();
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify(result, null, 2),
                    },
                ],
            };
        }
    );

    // login_qrcode - 获取登录二维码
    server.registerTool(
        'login_qrcode',
        {
            description: '获取支付宝扫码登录的二维码图片（首选登录方式）。返回Base64编码的二维码图片，用户需要使用支付宝扫码登录。',
        },
        async () => {
            const result = await authTools.loginQRCode();
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify({
                            说明: result.说明,
                            过期秒数: result.过期秒数,
                        }, null, 2),
                    },
                    {
                        type: 'image' as const,
                        data: result.二维码图片,
                        mimeType: 'image/png',
                    },
                ],
            };
        }
    );

    // wait_login - 等待登录完成
    server.registerTool(
        'wait_login',
        {
            description: '等待用户扫码登录完成。在获取二维码后调用此工具等待用户完成扫码认证。',
            inputSchema: {
                超时秒数: z.number().min(10).max(300).optional().default(120)
                    .describe('等待超时时间（秒），默认120秒，范围10-300秒'),
            },
        },
        async (args) => {
            const input = WaitLoginInputSchema.parse(args);
            const result = await authTools.waitLogin(input);
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify(result, null, 2),
                    },
                ],
            };
        }
    );

    // login_with_browser - 弹出浏览器登录
    server.registerTool(
        'login_with_browser',
        {
            description: '弹出浏览器窗口进行登录（备用方式，仅在无法使用 login_qrcode 时使用）。适用于本地开发环境，会弹出浏览器窗口让用户直接扫码登录。',
            inputSchema: {
                超时秒数: z.number().min(10).max(300).optional().default(180)
                    .describe('等待超时时间（秒），默认180秒，范围10-300秒'),
            },
        },
        async (args) => {
            const input = BrowserLoginInputSchema.parse(args);
            const result = await authTools.loginWithBrowser(input);
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify(result, null, 2),
                    },
                ],
            };
        }
    );

    // ========== 元数据工具 ==========

    // list_case_types - 列出案件类型
    server.registerTool(
        'list_case_types',
        {
            description: '列出所有可用的案件类型。返回案件类型的代码、中文名称和描述。',
        },
        async () => {
            const result = metadataTools.listCaseTypes();
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify(result, null, 2),
                    },
                ],
            };
        }
    );

    // list_court_levels - 列出法院级别
    server.registerTool(
        'list_court_levels',
        {
            description: '列出所有可用的法院级别。返回法院级别的代码、中文名称和描述。',
        },
        async () => {
            const result = metadataTools.listCourtLevels();
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify(result, null, 2),
                    },
                ],
            };
        }
    );

    // ========== 搜索工具 ==========

    // search_documents - 搜索文书
    server.registerTool(
        'search_documents',
        {
            description: `搜索裁判文书。支持关键词搜索和多种筛选条件（案件类型、法院级别、日期范围）。

使用前请确保已登录（调用 login_status 检查状态，未登录则调用 login_qrcode 获取二维码）。

筛选条件使用AND逻辑组合，即返回的文书必须同时满足所有指定的筛选条件。`,
            inputSchema: {
                keyword: z.string().min(1).describe('搜索关键词，必填'),
                caseType: z.enum(['xingshi', 'minshi', 'xingzheng', 'peichang', 'zhixing']).optional()
                    .describe('案件类型筛选。可选值: xingshi(刑事), minshi(民事), xingzheng(行政), peichang(赔偿), zhixing(执行)'),
                courtLevel: z.enum(['zuigao', 'gaoji', 'zhongji', 'jiceng']).optional()
                    .describe('法院级别筛选。可选值: zuigao(最高人民法院), gaoji(高级人民法院), zhongji(中级人民法院), jiceng(基层人民法院)'),
                startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
                    .describe('开始日期，格式: YYYY-MM-DD'),
                endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
                    .describe('结束日期，格式: YYYY-MM-DD'),
                page: z.number().int().min(1).optional().default(1)
                    .describe('页码，默认1'),
                pageSize: z.number().int().min(1).max(100).optional().default(20)
                    .describe('每页数量，默认20，最大100'),
            },
        },
        async (args) => {
            const input = SearchDocumentsInputSchema.parse(args);
            const result = await searchTools.searchDocuments(input);
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify(result, null, 2),
                    },
                ],
            };
        }
    );

    // ========== 文书详情工具 ==========

    // get_document - 获取文书详情
    server.registerTool(
        'get_document',
        {
            description: `获取裁判文书的完整内容和详细信息。

使用前请确保已登录（调用 login_status 检查状态，未登录则调用 login_qrcode 获取二维码）。

返回的信息包括：
- 基本信息：文书ID、案件名称、案号、法院名称、法院级别、裁判日期、案件类型
- 当事人信息：姓名和角色（原告/被告/上诉人等）
- 审判人员：法官列表
- 文书全文：完整的判决书内容
- 案由：案件的法律案由`,
            inputSchema: {
                docId: z.string().min(1).describe('文书ID或案号，必填。可以从搜索结果中获取文书ID。'),
            },
        },
        async (args) => {
            const input = GetDocumentInputSchema.parse(args);
            const result = await documentTools.getDocument(input);
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify(result, null, 2),
                    },
                ],
            };
        }
    );
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
  # 使用默认配置启动
  court-document-mcp

  # 指定Session存储路径
  court-document-mcp --session-path /path/to/session

  # 使用有头模式（弹出浏览器窗口）
  court-document-mcp --no-headless

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
