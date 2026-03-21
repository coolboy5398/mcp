/**
 * 页面解析辅助函数
 */

import { ElementHandle, Page } from 'playwright';
import {
    DocumentDetail,
    DocumentSummary,
    PartyInfo,
} from '../models/index.js';
import {
    AuthRequiredError,
    NotFoundError,
} from '../errors/index.js';
import { PAGE_SELECTORS } from './selectors.js';

const DETAIL_INVALID_HINTS = [
    '登录',
    '注册',
    '返回主站',
    '使用帮助',
    '欢迎您，',
    '扫码',
    '支付宝',
    '微信',
    '意见建议',
];

const DETAIL_AUTH_SURFACE_HINTS = [
    '请扫码登录',
    '请登录后查看',
    '登录后查看全文',
    '扫码查看全文',
    '支付宝扫码登录',
    '微信扫码登录',
    '用户登录',
    '去登录',
];

const DETAIL_PERMISSION_HINTS = [
    '暂无查看权限',
    '无权查看',
    '不可查看',
    '仅展示摘要',
    '仅支持查看摘要',
    '全文请登录后查看',
    '全文暂无法查看',
    '当前文书暂不支持查看全文',
    '当前文书仅提供摘要',
    '点击下载文书',
    '点击打印文书',
];

const DETAIL_SUMMARY_NOISE_HINTS = [
    '点击了解更多',
    '发布日期',
    '浏览次数',
    '点击下载文书',
    '点击打印文书',
    '公 告',
];

const MIN_VALID_DOCUMENT_TEXT_LENGTH = 120;

/**
 * 解析搜索结果
 */
export async function parseSearchResults(page: Page): Promise<DocumentSummary[]> {
    const results: DocumentSummary[] = [];

    console.error(`[DEBUG] parseSearchResults: 使用选择器 "${PAGE_SELECTORS.resultList}"`);
    const items = await page.$$(PAGE_SELECTORS.resultList);
    console.error(`[DEBUG] parseSearchResults: 找到 ${items.length} 个结果项`);

    for (const item of items) {
        const titleElement = await item.$(PAGE_SELECTORS.resultTitle);
        const courtElement = await item.$(PAGE_SELECTORS.resultCourt);
        const caseNoElement = await item.$(PAGE_SELECTORS.resultCaseNo);
        const dateElement = await item.$(PAGE_SELECTORS.resultDate);
        const typeElement = await item.$(PAGE_SELECTORS.resultType);
        const docIdInput = await item.$(PAGE_SELECTORS.resultDocIdInput);

        const 案件名称 = (await titleElement?.textContent())?.trim() ?? '';
        const 法院名称 = (await courtElement?.textContent())?.trim() ?? '';
        const 案号 = (await caseNoElement?.textContent())?.trim() ?? '';
        const 裁判日期 = (await dateElement?.textContent())?.trim() ?? '';
        const 案件类型 = (await typeElement?.textContent())?.trim() ?? '';

        const getDocId = async (): Promise<string> => {
            if (docIdInput) {
                const dataValue = await docIdInput.getAttribute('data-value');
                if (dataValue) {
                    console.error(`[DEBUG] parseResultItem: docId from data-value = ${dataValue.substring(0, 30)}...`);
                    return dataValue;
                }
            }

            const link = await item.$(PAGE_SELECTORS.resultTitle);
            if (link) {
                const href = await link.getAttribute('href');
                if (href) {
                    const docIdMatch = href.match(/docId=([^&]+)/);
                    if (docIdMatch && docIdMatch[1]) {
                        console.error(`[DEBUG] parseResultItem: docId from href = ${docIdMatch[1].substring(0, 30)}...`);
                        return docIdMatch[1];
                    }
                }
            }

            console.error('[DEBUG] parseResultItem: 使用临时 docId');
            return `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        };

        const 文书ID = await getDocId();

        if (!案件名称 && !案号) {
            console.error('[DEBUG] parseResultItem: 案件名称和案号都为空，返回 null');
            continue;
        }

        results.push({
            文书ID,
            案件名称: 案件名称 || '未知案件',
            案号: 案号 || '未知案号',
            法院名称: 法院名称 || '未知法院',
            裁判日期: 裁判日期 || '未知日期',
            案件类型: 案件类型 || '未知类型',
        });
    }

    return results;
}

/**
 * 解析文书详情
 */
export async function parseDocumentDetail(page: Page, docId: string): Promise<DocumentDetail> {
    const 案件名称 = await extractText(page, PAGE_SELECTORS.documentTitle);
    const 案号 = await extractText(page, PAGE_SELECTORS.documentCaseNo);
    const 法院名称 = await extractText(page, PAGE_SELECTORS.documentCourt);
    const 裁判日期 = await extractText(page, PAGE_SELECTORS.documentDate);
    const 案由 = await extractText(page, PAGE_SELECTORS.documentCause);
    const 文书全文 = await extractDocumentFullText(page);
    const bodyText = await extractBodyFallbackText(page);

    assertAccessibleDocumentPage({
        docId,
        案件名称,
        案号,
        法院名称,
        文书全文,
        bodyText,
    });

    if (!案件名称 && !案号 && !文书全文) {
        console.error('[ERROR] parseDocumentDetail: 文书内容为空');
        console.error(`[ERROR] parseDocumentDetail: docId = ${docId.substring(0, 50)}...`);

        let pageHint = '';
        if (bodyText) {
            pageHint = `\n页面内容: ${bodyText.substring(0, 200).replace(/\s+/g, ' ').trim()}`;
        }

        throw new NotFoundError(
            `文书内容为空，无法获取文书详情。\n`
            + `docId: ${docId.substring(0, 40)}...\n\n`
            + `可能原因：\n`
            + `1. docId 无效或格式错误\n`
            + `2. 该文书已被删除或下架\n`
            + `3. docId 已过期（裁判文书网的 docId 可能会定期更新）\n`
            + `4. 需要更高权限才能访问该文书\n\n`
            + `建议：使用 search_documents 重新搜索获取最新的 docId`
            + pageHint,
        );
    }

    const 当事人 = await parseParties(page);
    const 审判人员 = await parseJudges(page);
    const 法院级别 = inferCourtLevel(法院名称);
    const 案件类型 = inferCaseType(案号, 案件名称, 文书全文);
    const 清洗后裁判日期 = normalizeJudgmentDate(裁判日期, 文书全文);

    return {
        文书ID: docId,
        案件名称: 案件名称 || '未知案件',
        案号: 案号 || '未知案号',
        法院名称: 法院名称 || '未知法院',
        法院级别,
        裁判日期: 清洗后裁判日期 || '未知日期',
        案件类型,
        当事人,
        审判人员,
        文书全文: 文书全文 || '',
        案由: 案由 || inferCauseFromSummary(文书全文) || '未知案由',
    };
}

async function extractText(page: Page, selector: string): Promise<string> {
    try {
        const element = await page.$(selector);
        return (await element?.textContent())?.trim() ?? '';
    } catch {
        return '';
    }
}

async function extractDocumentFullText(page: Page): Promise<string> {
    const selectorCandidates = Array.from(new Set([
        ...PAGE_SELECTORS.documentFullText.split(',').map(selector => selector.trim()).filter(Boolean),
        ...PAGE_SELECTORS.documentContent.split(',').map(selector => selector.trim()).filter(Boolean),
        '.PDF_content',
        '.ws-text',
        '.document-body',
        '#contentText',
        '.PDF_box',
        '.ws-content',
        '.document-content',
        '#content',
        '.content',
    ]));

    let bestText = '';

    for (const selector of selectorCandidates) {
        const text = await extractBestTextFromSelector(page, selector);
        if (text.length > bestText.length) {
            bestText = text;
        }
    }

    if (bestText) {
        console.error(`[DEBUG] parseDocumentDetail: 文书全文提取成功，长度 = ${bestText.length}`);
        return bestText;
    }

    const bodyText = await extractBodyFallbackText(page);
    if (bodyText) {
        console.error(`[DEBUG] parseDocumentDetail: 使用 body 兜底提取正文，长度 = ${bodyText.length}`);
        return cleanDocumentText(bodyText);
    }

    return '';
}

async function extractBestTextFromSelector(page: Page, selector: string): Promise<string> {
    try {
        const elements = await page.$$(selector);
        if (elements.length === 0) {
            return '';
        }

        let bestText = '';
        for (const element of elements) {
            const text = await extractTextFromElement(element);
            if (text.length > bestText.length) {
                bestText = text;
            }
        }

        return bestText;
    } catch {
        return '';
    }
}

async function extractTextFromElement(element: ElementHandle): Promise<string> {
    try {
        const innerText = await element.evaluate((node) => {
            const text = 'innerText' in node ? node.innerText : '';
            return typeof text === 'string' ? text : '';
        });
        const normalizedInnerText = cleanDocumentText(innerText);
        if (normalizedInnerText) {
            return normalizedInnerText;
        }

        const textContent = await element.textContent();
        return cleanDocumentText(textContent);
    } catch {
        return '';
    }
}

async function extractBodyFallbackText(page: Page): Promise<string> {
    try {
        const bodyText = await page.$eval('body', (body) => {
            const text = body.innerText || '';
            return typeof text === 'string' ? text : '';
        });
        return normalizeExtractedText(bodyText);
    } catch {
        return '';
    }
}

function normalizeExtractedText(text: string | null | undefined): string {
    if (!text) {
        return '';
    }

    return text
        .replace(/\r/g, '')
        .replace(/[\t\f\v]+/g, ' ')
        .replace(/\u00a0/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ ]{2,}/g, ' ')
        .split('\n')
        .map(line => line.trim())
        .join('\n')
        .trim();
}

function cleanDocumentText(text: string | null | undefined): string {
    const normalized = normalizeExtractedText(text);
    if (!normalized) {
        return '';
    }

    const lines = normalized
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .filter(line => !DETAIL_SUMMARY_NOISE_HINTS.some(hint => line.includes(hint)));

    const joined = lines.join('\n').trim();
    return joined.replace(/\n{3,}/g, '\n\n').trim();
}

function assertAccessibleDocumentPage(params: {
    docId: string;
    案件名称: string;
    案号: string;
    法院名称: string;
    文书全文: string;
    bodyText: string;
}): void {
    const {
        docId,
        案件名称,
        案号,
        法院名称,
        文书全文,
        bodyText,
    } = params;

    const combined = `${案件名称}\n${案号}\n${法院名称}\n${文书全文}\n${bodyText}`;
    const normalizedCombined = combined.replace(/\s+/g, ' ').trim();
    const pageSnippet = normalizedCombined.substring(0, 220);

    const hasGenericAuthHint = DETAIL_INVALID_HINTS.some(hint => combined.includes(hint));
    const hasExplicitAuthSurface = DETAIL_AUTH_SURFACE_HINTS.some(hint => combined.includes(hint));
    const hasPermissionHint = DETAIL_PERMISSION_HINTS.some(hint => combined.includes(hint));
    const hasSummaryOnlyText = DETAIL_SUMMARY_NOISE_HINTS.some(hint => combined.includes(hint));
    const hasCoreMetadata = Boolean(案件名称 || 案号 || 法院名称);
    const hasDocumentBody = 文书全文.length >= MIN_VALID_DOCUMENT_TEXT_LENGTH;
    const hasJudgmentKeywords = /(判决书|裁定书|调解书|决定书|通知书)/.test(combined);
    const authHintDensity = DETAIL_INVALID_HINTS.filter(hint => combined.includes(hint)).length;
    const bodyLooksLikeAuthSurface = /(扫码登录|登录后查看|请登录后查看|支付宝扫码|微信扫码|用户登录)/.test(normalizedCombined);

    if ((hasExplicitAuthSurface || bodyLooksLikeAuthSurface || authHintDensity >= 3)
        && !hasPermissionHint
        && !hasCoreMetadata
        && !hasDocumentBody
        && !hasJudgmentKeywords) {
        throw new AuthRequiredError(
            '当前会话无法访问该文书详情，页面表现为登录/未授权入口，请重新登录后重试。'
            + (pageSnippet ? ` 页面片段：${pageSnippet}` : ''),
        );
    }

    if ((hasPermissionHint || hasSummaryOnlyText)
        && !hasDocumentBody
        && !hasJudgmentKeywords) {
        throw new NotFoundError(
            `当前账号无法获取该文书全文，页面可能仅返回摘要或权限提示。\n`
            + `docId: ${docId.substring(0, 40)}...\n`
            + (pageSnippet ? `页面片段：${pageSnippet}\n` : '')
            + '建议：请确认该账号是否具备查看该文书全文的权限，或重新调用 search_documents 获取最新 docId 后再试。',
        );
    }

    if (hasGenericAuthHint && !hasCoreMetadata && !hasDocumentBody && !hasJudgmentKeywords) {
        throw new NotFoundError(
            `当前文书详情页未返回可解析的正文内容。\n`
            + `docId: ${docId.substring(0, 40)}...\n`
            + (pageSnippet ? `页面片段：${pageSnippet}\n` : '')
            + '建议：请确认当前登录态与文书访问权限是否有效，或重新搜索后再试。',
        );
    }
}

function normalizeJudgmentDate(dateText: string, fullText: string): string {
    const normalizedDate = normalizeExtractedText(dateText);
    if (normalizedDate && !/星期[一二三四五六日天]/.test(normalizedDate)) {
        return normalizedDate;
    }

    const fullWidthDateMatch = fullText.match(/二[〇零Ｏ○][一二三四五六七八九十]{2}年[一二三四五六七八九十〇零Ｏ○]{1,3}月[一二三四五六七八九十〇零Ｏ○]{1,3}日/);
    if (fullWidthDateMatch?.[0]) {
        return fullWidthDateMatch[0];
    }

    const numericDateMatch = fullText.match(/20\d{2}[-年]\d{1,2}[-月]\d{1,2}日?/);
    if (numericDateMatch?.[0]) {
        return numericDateMatch[0];
    }

    return normalizedDate;
}

function inferCauseFromSummary(fullText: string): string {
    const firstLines = fullText
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .slice(0, 8);

    for (const line of firstLines) {
        if (line === '案 由' || line === '案由') {
            continue;
        }

        if (line.includes('纠纷') || line.includes('争议') || line.includes('案件')) {
            return line;
        }
    }

    return '';
}

async function parseParties(page: Page): Promise<PartyInfo[]> {
    const parties: PartyInfo[] = [];

    try {
        const partyElements = await page.$$(PAGE_SELECTORS.documentParties);
        for (const element of partyElements) {
            const text = await element.textContent();
            if (text) {
                const parsed = parsePartyText(text);
                if (parsed) {
                    parties.push(parsed);
                }
            }
        }
    } catch {
        // 解析失败时返回空数组
    }

    return parties;
}

function parsePartyText(text: string): PartyInfo | null {
    const rolePatterns = [
        /^(原告|被告|上诉人|被上诉人|申请人|被申请人|原审原告|原审被告)[：:]\s*(.+)$/,
        /^(.+?)[（(](原告|被告|上诉人|被上诉人|申请人|被申请人)[）)]$/,
    ];

    for (const pattern of rolePatterns) {
        const match = text.trim().match(pattern);
        if (match && match[1]) {
            const role = match[1].includes('原告') || match[1].includes('申请人') || match[1].includes('上诉人')
                ? match[1]
                : (match[2] ?? match[1]);
            const name = match[2] ?? match[1];
            return {
                角色: role,
                姓名: name,
            };
        }
    }

    if (text.trim()) {
        return {
            角色: '当事人',
            姓名: text.trim(),
        };
    }

    return null;
}

async function parseJudges(page: Page): Promise<string[]> {
    const judges: string[] = [];

    try {
        const judgeElements = await page.$$(PAGE_SELECTORS.documentJudges);
        for (const element of judgeElements) {
            const text = await element.textContent();
            if (text) {
                const names = text.split(/[,，、\s]+/).filter(name => name.trim());
                judges.push(...names);
            }
        }
    } catch {
        // 解析失败时返回空数组
    }

    return judges;
}

function inferCourtLevel(courtName: string): string {
    if (courtName.includes('最高人民法院')) {
        return '最高人民法院';
    }
    if (courtName.includes('高级人民法院')) {
        return '高级人民法院';
    }
    if (courtName.includes('中级人民法院')) {
        return '中级人民法院';
    }
    if (courtName.includes('人民法院')) {
        return '基层人民法院';
    }
    return '未知级别';
}

function inferCaseType(caseNo: string, caseName: string, fullText: string = ''): string {
    const combined = `${caseNo} ${caseName} ${fullText}`;

    if (combined.includes('刑') || combined.includes('刑事')) {
        return '刑事案件';
    }
    if (combined.includes('民') || combined.includes('民事')) {
        return '民事案件';
    }
    if (combined.includes('行') || combined.includes('行政')) {
        return '行政案件';
    }
    if (combined.includes('赔') || combined.includes('赔偿')) {
        return '赔偿案件';
    }
    if (combined.includes('执') || combined.includes('执行')) {
        return '执行案件';
    }

    return '未知类型';
}
