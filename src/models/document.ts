/**
 * 文书数据模型
 * 需求: 1.2, 3.2
 */

/**
 * 当事人信息接口
 * 用于描述案件中的当事人（原告、被告、上诉人等）
 */
export interface PartyInfo {
    /** 当事人姓名 */
    姓名: string;
    /** 当事人角色（原告/被告/上诉人等） */
    角色: string;
}

/**
 * 文书摘要接口
 * 用于搜索结果列表中的文书简要信息
 * 需求 1.2: 搜索结果应包含案件名称、案号、法院名称和裁判日期
 */
export interface DocumentSummary {
    /** 文书唯一标识 */
    文书ID: string;
    /** 案件名称 */
    案件名称: string;
    /** 案号 */
    案号: string;
    /** 法院名称 */
    法院名称: string;
    /** 裁判日期 (YYYY-MM-DD格式) */
    裁判日期: string;
    /** 案件类型 */
    案件类型: string;
}

/**
 * 文书详情接口
 * 用于获取文书完整内容和结构化元数据
 * 需求 3.2: 返回文书内容时应包含结构化的元数据
 */
export interface DocumentDetail {
    /** 文书唯一标识 */
    文书ID: string;
    /** 案件名称 */
    案件名称: string;
    /** 案号 */
    案号: string;
    /** 法院名称 */
    法院名称: string;
    /** 法院级别 */
    法院级别: string;
    /** 裁判日期 (YYYY-MM-DD格式) */
    裁判日期: string;
    /** 案件类型 */
    案件类型: string;
    /** 当事人列表 */
    当事人: PartyInfo[];
    /** 审判人员列表 */
    审判人员: string[];
    /** 文书全文内容 */
    文书全文: string;
    /** 案由 */
    案由: string;
}

/**
 * 分页信息接口
 * 用于分页响应中的分页元数据
 */
export interface PaginationInfo {
    /** 结果总数 */
    总数: number;
    /** 当前页码 */
    当前页: number;
    /** 每页数量 */
    每页数量: number;
    /** 总页数 */
    总页数: number;
}

/**
 * 搜索结果响应接口
 * 用于文书搜索的分页响应
 */
export interface SearchResponse {
    /** 结果总数 */
    total: number;
    /** 当前页码 */
    page: number;
    /** 每页数量 */
    pageSize: number;
    /** 文书摘要列表 */
    documents: DocumentSummary[];
}

/**
 * 验证文书摘要是否包含所有必需字段
 * Property 1: Search Results Structure Completeness
 */
export function isValidDocumentSummary(doc: Partial<DocumentSummary>): doc is DocumentSummary {
    return (
        typeof doc.文书ID === 'string' && doc.文书ID.length > 0 &&
        typeof doc.案件名称 === 'string' && doc.案件名称.length > 0 &&
        typeof doc.案号 === 'string' && doc.案号.length > 0 &&
        typeof doc.法院名称 === 'string' && doc.法院名称.length > 0 &&
        typeof doc.裁判日期 === 'string' && doc.裁判日期.length > 0 &&
        typeof doc.案件类型 === 'string' && doc.案件类型.length > 0
    );
}

/**
 * 验证文书详情是否包含所有必需字段
 * Property 3: Document Retrieval Completeness
 */
export function isValidDocumentDetail(doc: Partial<DocumentDetail>): doc is DocumentDetail {
    return (
        typeof doc.文书ID === 'string' && doc.文书ID.length > 0 &&
        typeof doc.案件名称 === 'string' && doc.案件名称.length > 0 &&
        typeof doc.案号 === 'string' && doc.案号.length > 0 &&
        typeof doc.法院名称 === 'string' && doc.法院名称.length > 0 &&
        typeof doc.法院级别 === 'string' && doc.法院级别.length > 0 &&
        typeof doc.裁判日期 === 'string' && doc.裁判日期.length > 0 &&
        typeof doc.案件类型 === 'string' && doc.案件类型.length > 0 &&
        Array.isArray(doc.当事人) &&
        Array.isArray(doc.审判人员) &&
        typeof doc.文书全文 === 'string' &&
        typeof doc.案由 === 'string'
    );
}

/**
 * 创建空的文书摘要对象
 */
export function createEmptyDocumentSummary(): DocumentSummary {
    return {
        文书ID: '',
        案件名称: '',
        案号: '',
        法院名称: '',
        裁判日期: '',
        案件类型: '',
    };
}

/**
 * 创建空的文书详情对象
 */
export function createEmptyDocumentDetail(): DocumentDetail {
    return {
        文书ID: '',
        案件名称: '',
        案号: '',
        法院名称: '',
        法院级别: '',
        裁判日期: '',
        案件类型: '',
        当事人: [],
        审判人员: [],
        文书全文: '',
        案由: '',
    };
}
