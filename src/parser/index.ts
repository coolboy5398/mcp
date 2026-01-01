/**
 * 页面解析模块导出
 * 需求: 1.2, 3.2
 */

// 搜索结果解析器
export {
    SearchResultParser,
    createSearchResultParser,
    parseSearchResultsFromHtml,
    SEARCH_RESULT_SELECTORS,
    type ParsedSearchResults,
    type ParsedPaginationInfo,
} from './search-result.js';

// 文书详情解析器
export {
    DocumentDetailParser,
    createDocumentDetailParser,
    parseDocumentDetailFromHtml,
    DOCUMENT_DETAIL_SELECTORS,
    PARTY_ROLES,
    type ParsedDocumentDetail,
} from './document-detail.js';
