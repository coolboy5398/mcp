/**
 * 数据模型导出
 */

// 案件类型
export {
    CaseType,
    CaseTypeInfo,
    CaseTypeMap,
    getAllCaseTypes,
    getCaseTypeByCode,
    isValidCaseType,
} from './case-type.js';

// 法院级别
export {
    CourtLevel,
    CourtLevelInfo,
    CourtLevelMap,
    getAllCourtLevels,
    getCourtLevelByCode,
    isValidCourtLevel,
} from './court-level.js';

// 文书数据模型
export {
    PartyInfo,
    DocumentSummary,
    DocumentDetail,
    PaginationInfo,
    SearchResponse,
    isValidDocumentSummary,
    isValidDocumentDetail,
    createEmptyDocumentSummary,
    createEmptyDocumentDetail,
} from './document.js';
