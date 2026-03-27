/**
 * MCP工具模块导出
 * 统一导出所有MCP工具定义和处理器
 */

// 认证工具
export {
    LoginStatusOutput,
    LoginQRCodeOutput,
    WaitLoginInput,
    WaitLoginInputSchema,
    WaitLoginOutput,
    BrowserLoginInput,
    BrowserLoginInputSchema,
    BrowserLoginOutput,
    EnsureLoginInput,
    EnsureLoginInputSchema,
    EnsureLoginOutput,
    AuthTools,
    loginStatusToolDefinition,
    loginQRCodeToolDefinition,
    waitLoginToolDefinition,
    loginWithBrowserToolDefinition,
    ensureLoginToolDefinition,
    authToolDefinitions,
    createAuthToolHandlers,
    getDefaultAuthTools,
    resetDefaultAuthTools,
} from './auth.js';

// 元数据工具
export {
    ListCaseTypesOutput,
    ListCourtLevelsOutput,
    MetadataTools,
    listCaseTypesToolDefinition,
    listCourtLevelsToolDefinition,
    metadataToolDefinitions,
    createMetadataToolHandlers,
    getDefaultMetadataTools,
} from './metadata.js';

// 搜索工具
export {
    SearchDocumentsInput,
    SearchDocumentsInputSchema,
    SearchDocumentsOutput,
    SearchTools,
    searchDocumentsToolDefinition,
    searchToolDefinitions,
    createSearchToolHandlers,
    getDefaultSearchTools,
    resetDefaultSearchTools,
} from './search.js';

// 文书详情工具
export {
    GetDocumentInput,
    GetDocumentInputSchema,
    GetDocumentOutput,
    DocumentTools,
    getDocumentToolDefinition,
    documentToolDefinitions,
    createDocumentToolHandlers,
    getDefaultDocumentTools,
    resetDefaultDocumentTools,
} from './document.js';

/**
 * 所有工具定义
 */
import { authToolDefinitions } from './auth.js';
import { metadataToolDefinitions } from './metadata.js';
import { searchToolDefinitions } from './search.js';
import { documentToolDefinitions } from './document.js';

export const allToolDefinitions = [
    ...authToolDefinitions,
    ...metadataToolDefinitions,
    ...searchToolDefinitions,
    ...documentToolDefinitions,
];

/**
 * 创建所有工具处理器
 */
import { AuthManager } from '../auth/index.js';
import { createAuthToolHandlers } from './auth.js';
import { createMetadataToolHandlers } from './metadata.js';
import { createSearchToolHandlers } from './search.js';
import { createDocumentToolHandlers } from './document.js';

export function createAllToolHandlers(authManager?: AuthManager) {
    return {
        ...createAuthToolHandlers(authManager),
        ...createMetadataToolHandlers(),
        ...createSearchToolHandlers(authManager),
        ...createDocumentToolHandlers(authManager),
    };
}

/**
 * 工具名称到处理器的映射类型
 */
export type ToolHandlers = ReturnType<typeof createAllToolHandlers>;

/**
 * 工具名称类型
 */
export type ToolName = keyof ToolHandlers;
